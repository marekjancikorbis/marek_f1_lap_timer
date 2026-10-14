import type { Fix } from './engine';
import { PreparedRoute } from './route';

export interface SimOptions {
  /** Cruise speed, km/h. */
  speedKmh?: number;
  /** Fix interval, ms (1000 = 1 Hz). */
  intervalMs?: number;
  startT?: number;
  /** Start this many metres before the start gate (rolling) or at it (standing). */
  leadInM?: number;
  /** Seconds standing still at the start before moving. */
  holdS?: number;
  launchAccel?: number;
  /** Loop route: past the finish wraps back to the start. */
  loop?: boolean;
  /** Laps to drive (loop routes). */
  laps?: number;
  /** Per-sector speed multipliers, so sector colours vary. */
  sectorPace?: number[];
  sectorLengthM?: number;
  /** Seeded GPS position noise, metres. */
  noiseM?: number;
  seed?: number;
}

/**
 * Synthesise a drive along a route: GPS fixes with Doppler speed and heading.
 * Used by the unit tests and by the app's replay mode for desk testing.
 */
export function simulateDrive(route: PreparedRoute, opts: SimOptions = {}): Fix[] {
  const cruise = (opts.speedKmh ?? 80) / 3.6;
  const dt = opts.intervalMs ?? 1000;
  const t0 = opts.startT ?? 1_700_000_000_000;
  const accel = opts.launchAccel ?? 4;
  const laps = opts.laps ?? 1;
  const loop = opts.loop ?? laps > 1;
  const total = route.lengthM * laps;
  const leadIn = opts.leadInM ?? 0;
  const hold = (opts.holdS ?? 0) * 1000;
  const rand = mulberry32(opts.seed ?? 1);
  const noise = opts.noiseM ?? 0;
  const pace = opts.sectorPace;
  const secLen = opts.sectorLengthM ?? 500;

  const fixes: Fix[] = [];
  let s = -leadIn;
  let v = leadIn > 0 ? cruise : 0;
  let t = t0;
  do {
    fixes.push(makeFix(route, s, v, t, noise, rand, loop));
    t += dt;
  } while (t - t0 <= hold);
  while (s <= total + 30) {
    const lapS = ((s % route.lengthM) + route.lengthM) % route.lengthM;
    const mult = pace && s >= 0 ? pace[Math.floor(lapS / secLen) % pace.length] : 1;
    const target = cruise * mult;
    v = v < target ? Math.min(target, v + accel * (dt / 1000)) : target;
    s += v * (dt / 1000);
    fixes.push(makeFix(route, s, v, t, noise, rand, loop));
    t += dt;
  }
  return fixes;
}

function makeFix(
  route: PreparedRoute,
  s: number,
  v: number,
  t: number,
  noise: number,
  rand: () => number,
  loop: boolean,
): Fix {
  const L = route.lengthM;
  let p;
  let heading: number;
  if (s < 0) {
    // Before the start: extend backwards along the first segment.
    const h = route.startHeading;
    const start = route.pointAt(0);
    const xy = route.proj.toXY(start);
    const r = (h * Math.PI) / 180;
    p = route.proj.toLatLon({ x: xy.x + Math.sin(r) * s, y: xy.y + Math.cos(r) * s });
    heading = h;
  } else if (s > L && !loop) {
    // Past the finish of a point-to-point route: extend along the last segment.
    const h = route.headingAt(L);
    const xy = route.proj.toXY(route.pointAt(L));
    const r = (h * Math.PI) / 180;
    p = route.proj.toLatLon({ x: xy.x + Math.sin(r) * (s - L), y: xy.y + Math.cos(r) * (s - L) });
    heading = h;
  } else {
    const lapS = s % L;
    p = route.pointAt(lapS);
    heading = route.headingAt(lapS);
  }
  if (noise > 0) {
    const xy = route.proj.toXY(p);
    p = route.proj.toLatLon({ x: xy.x + (rand() - 0.5) * 2 * noise, y: xy.y + (rand() - 0.5) * 2 * noise });
  }
  return { lat: p.lat, lon: p.lon, t, accuracy: Math.max(3, noise), speed: v, heading: v > 0.5 ? heading : null };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrackSimOptions {
  /** Top speed on straights, km/h. */
  vMaxKmh?: number;
  /** Cornering grip, m/s² (≈ 1 g on a track car, less on gravel). */
  latAccel?: number;
  /** Braking, m/s². */
  brake?: number;
  /** Acceleration, m/s². */
  accel?: number;
  /** Fix interval, ms. */
  intervalMs?: number;
  /** ± random jitter on each fix timestamp spacing, ms. */
  jitterMs?: number;
  /** Std-dev of the slowly drifting position error, metres. */
  noiseM?: number;
  /** Std-dev of Doppler speed error, m/s. */
  speedNoise?: number;
  startT?: number;
  laps?: number;
  loop?: boolean;
  /** Rolling run-up before the start gate, metres. */
  leadInM?: number;
  seed?: number;
}

const GRID_M = 2;

/**
 * Physically plausible drive for accuracy tests: corner speed limited by grip,
 * braking into and accelerating out of corners, correlated GPS position error
 * and noisy Doppler. Returns the true time at any distance so gate errors can
 * be measured exactly. Distance is absolute: lap n's gate b is at n·L + b.
 */
export function simulateTrackDrive(route: PreparedRoute, opts: TrackSimOptions = {}): { fixes: Fix[]; timeAt: (s: number) => number } {
  const vMax = (opts.vMaxKmh ?? 160) / 3.6;
  const aLat = opts.latAccel ?? 9;
  const brake = opts.brake ?? 8;
  const accel = opts.accel ?? 4;
  const L = route.lengthM;
  const laps = opts.laps ?? 1;
  const loop = opts.loop ?? laps > 1;
  const leadIn = opts.leadInM ?? 150;
  const rand = mulberry32(opts.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());

  // Speed limit from curvature, measured over ±10 m of heading change.
  const sStart = -leadIn;
  const sEnd = L * laps + 60;
  const n = Math.ceil((sEnd - sStart) / GRID_M) + 1;
  const sAt = (i: number) => sStart + i * GRID_M;
  const lapS = (s: number) => (loop ? ((s % L) + L) % L : s);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = sAt(i);
    if (s < 0 || (!loop && s > L)) {
      v[i] = vMax;
      continue;
    }
    const d = Math.abs(((route.headingAt(lapS(s + 10)) - route.headingAt(lapS(s - 10)) + 540) % 360) - 180);
    const kappa = (d * Math.PI) / 180 / 20;
    v[i] = Math.min(vMax, kappa > 1e-6 ? Math.sqrt(aLat / kappa) : vMax);
  }
  // Rolling start: arrive at the run-up at the speed the start allows.
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * GRID_M));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brake * GRID_M));

  const t0 = opts.startT ?? 1_700_000_000_000;
  const T = new Float64Array(n);
  T[0] = t0;
  for (let i = 1; i < n; i++) T[i] = T[i - 1] + (2 * GRID_M * 1000) / (v[i - 1] + v[i]);

  const timeAt = (s: number) => {
    const x = Math.max(0, Math.min(n - 1.000001, (s - sStart) / GRID_M));
    const i = Math.floor(x);
    return T[i] + (T[i + 1] - T[i]) * (x - i);
  };

  const dt = opts.intervalMs ?? 1000;
  const jitter = opts.jitterMs ?? 0;
  const sigma = opts.noiseM ?? 0;
  const speedNoise = opts.speedNoise ?? 0;
  // AR(1) per axis with ~10 s correlation: GPS error drifts rather than jumps.
  const phi = Math.exp(-dt / 10_000);
  let ex = gauss() * sigma;
  let ey = gauss() * sigma;
  const fixes: Fix[] = [];
  let i = 0;
  for (let t = t0; t <= T[n - 1]; t += dt + (rand() - 0.5) * 2 * jitter) {
    while (i < n - 2 && T[i + 1] < t) i++;
    const f = (t - T[i]) / (T[i + 1] - T[i]);
    const s = sAt(i) + f * GRID_M;
    const speed = v[i] + (v[i + 1] - v[i]) * f;
    ex = phi * ex + Math.sqrt(1 - phi * phi) * sigma * gauss();
    ey = phi * ey + Math.sqrt(1 - phi * phi) * sigma * gauss();
    const fix = makeFix(route, s, speed, Math.round(t), 0, rand, loop);
    const xy = route.proj.toXY(fix);
    const p = route.proj.toLatLon({ x: xy.x + ex, y: xy.y + ey });
    fixes.push({ ...fix, lat: p.lat, lon: p.lon, accuracy: Math.max(3, sigma * 2), speed: Math.max(0, speed + gauss() * speedNoise) });
  }
  return { fixes, timeAt };
}
