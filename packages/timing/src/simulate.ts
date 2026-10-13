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
