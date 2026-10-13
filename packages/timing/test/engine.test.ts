import { describe, expect, it } from 'vitest';
import {
  Fix,
  LapTimer,
  LatLon,
  PreparedRoute,
  TimerEvent,
  compareLaps,
  computeSectorBoundaries,
  lapProfileFromTrace,
  offsetLatLon,
  sectorColour,
  simulateDrive,
  theoreticalBest,
} from '../src';

const ORIGIN: LatLon = { lat: 49.2, lon: 16.6 };
const T0 = 1_700_000_000_000;

function straight(lengthM: number, heading = 45): LatLon[] {
  return [ORIGIN, offsetLatLon(ORIGIN, lengthM, heading)];
}

function circle(radiusM: number, n = 72, centre = ORIGIN, clockwise = true): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((clockwise ? i : -i) / n) * 360;
    pts.push(offsetLatLon(centre, radiusM, 180 + a));
  }
  return pts;
}

function run(timer: LapTimer, fixes: Fix[]): TimerEvent[] {
  return fixes.flatMap((f) => timer.push(f));
}

const of = <T extends TimerEvent['type']>(events: TimerEvent[], type: T) =>
  events.filter((e): e is Extract<TimerEvent, { type: T }> => e.type === type);

describe('sector boundaries', () => {
  it('splits a route and keeps the final boundary at the length', () => {
    expect(computeSectorBoundaries(2300, 500)).toEqual([500, 1000, 1500, 2000, 2300]);
  });
  it('merges a short last sector into the previous one', () => {
    expect(computeSectorBoundaries(2200, 500)).toEqual([500, 1000, 1500, 2200]);
  });
  it('handles a route shorter than one sector', () => {
    expect(computeSectorBoundaries(320, 500)).toEqual([320]);
  });
  it('rejects sector lengths off the 50 m grid', () => {
    expect(() => computeSectorBoundaries(2000, 75)).toThrow();
    expect(() => computeSectorBoundaries(2000, 1050)).toThrow();
  });
});

describe('rolling start, point to point', () => {
  const route = new PreparedRoute(straight(2300));
  const boundaries = computeSectorBoundaries(route.lengthM, 500);

  it('interpolates gate crossings to well under 0.2 s at 1 Hz', () => {
    const v = 100 / 3.6;
    const fixes = simulateDrive(route, { speedKmh: 100, leadInM: 120, startT: T0 });
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const ev = run(timer, fixes);

    expect(of(ev, 'armed')).toHaveLength(1);
    const started = of(ev, 'started')[0];
    expect(Math.abs(started.t - (T0 + (120 / v) * 1000))).toBeLessThan(20);

    const sectors = of(ev, 'sector');
    expect(sectors).toHaveLength(5);
    sectors.forEach((s, k) => {
      expect(Math.abs(s.splitMs - (boundaries[k] / v) * 1000)).toBeLessThan(200);
    });
    expect(of(ev, 'finished')).toHaveLength(1);
    expect(timer.phase).toBe('finished');
  });

  it('stays within 0.2 s with GPS position noise', () => {
    const v = 90 / 3.6;
    const fixes = simulateDrive(route, { speedKmh: 90, leadInM: 120, noiseM: 2, seed: 7 });
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const result = of(run(timer, fixes), 'finished')[0].result;
    expect(Math.abs(result.totalMs - (route.lengthM / v) * 1000)).toBeLessThan(200);
  });

  it('does not arm when approaching against the route direction', () => {
    const fixes: Fix[] = [0, 1, 2, 3].map((i) => {
      const p = offsetLatLon(ORIGIN, -40 + i * 5, 45);
      return { ...p, t: T0 + i * 1000, accuracy: 4, speed: 10, heading: 225 };
    });
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    expect(of(run(timer, fixes), 'armed')).toHaveLength(0);
  });
});

describe('delta and colours', () => {
  const route = new PreparedRoute(straight(2000));
  const boundaries = computeSectorBoundaries(route.lengthM, 500);

  it('reports negative delta and green sectors when faster than the reference', () => {
    const slow = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const ref = of(run(slow, simulateDrive(route, { speedKmh: 80, leadInM: 100 })), 'finished')[0].result;

    const timer = new LapTimer({
      route,
      boundaries,
      isLoop: false,
      startType: 'rolling',
      reference: ref.splitTimesMs,
      sectorRecords: [1, 1, 1, 1], // unbeatable: no purple
    });
    const sectors = of(run(timer, simulateDrive(route, { speedKmh: 100, leadInM: 100 })), 'sector');
    for (const s of sectors) {
      expect(s.deltaMs).toBeLessThan(0);
      expect(s.colour).toBe('green');
    }
  });

  it('purple beats the record, and overrides green', () => {
    expect(sectorColour(9000, 10000, 9500)).toBe('purple');
    expect(sectorColour(9600, 10000, 9500)).toBe('green');
    expect(sectorColour(10100, 10000, 9500)).toBe('yellow');
    expect(sectorColour(10100, 10000, null)).toBe('purple');
  });
});

describe('loops', () => {
  const route = new PreparedRoute(circle(300));
  const boundaries = computeSectorBoundaries(route.lengthM, 400);

  it('runs laps back to back, each lap starting where the last ended', () => {
    const v = 70 / 3.6;
    const fixes = simulateDrive(route, { speedKmh: 70, leadInM: 80, laps: 3 });
    const timer = new LapTimer({ route, boundaries, isLoop: true, startType: 'rolling' });
    const ev = run(timer, fixes);
    const laps = of(ev, 'lapComplete').map((e) => e.result);
    expect(laps.length).toBeGreaterThanOrEqual(3);
    for (const lap of laps.slice(0, 3)) {
      expect(Math.abs(lap.totalMs - (route.lengthM / v) * 1000)).toBeLessThan(200);
    }
    expect(laps[1].startT).toBeCloseTo(laps[0].startT + laps[0].totalMs, -1);
    timer.stop();
    expect(timer.phase).toBe('finished');
  });
});

describe('self-crossing route', () => {
  // Figure of eight: two circles touching at the origin.
  const top = circle(200, 72, offsetLatLon(ORIGIN, 200, 0), true);
  const bottom = circle(200, 72, offsetLatLon(ORIGIN, 200, 180), false);
  const route = new PreparedRoute([...top, ...bottom.slice(1)]);
  const boundaries = computeSectorBoundaries(route.lengthM, 250);

  it('keeps tracking the right branch where the route crosses itself', () => {
    const fixes = simulateDrive(route, { speedKmh: 60, leadInM: 60 });
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const ev = run(timer, fixes);
    expect(of(ev, 'sector')).toHaveLength(boundaries.length);
    expect(of(ev, 'invalidated')).toHaveLength(0);
  });
});

describe('invalidation', () => {
  const route = new PreparedRoute(straight(2000));
  const boundaries = computeSectorBoundaries(route.lengthM, 500);

  it('invalidates when the car leaves the route for more than a few seconds', () => {
    const fixes = simulateDrive(route, { speedKmh: 80, leadInM: 100 }).slice(0, 20);
    const last = fixes[fixes.length - 1];
    for (let i = 1; i <= 8; i++) {
      const p = offsetLatLon(last, 60 + i * 10, 135);
      fixes.push({ ...p, t: last.t + i * 1000, accuracy: 4, speed: 20, heading: 135 });
    }
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const inv = of(run(timer, fixes), 'invalidated');
    expect(inv[0]?.reason).toBe('off_route');
  });

  it('invalidates on a long GPS gap', () => {
    const fixes = simulateDrive(route, { speedKmh: 80, leadInM: 100 });
    const gapped = [...fixes.slice(0, 15), ...fixes.slice(30)];
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    expect(of(run(timer, gapped), 'invalidated')[0]?.reason).toBe('gps_gap');
  });
});

describe('standing start', () => {
  const route = new PreparedRoute(straight(1200, 90));
  const boundaries = computeSectorBoundaries(route.lengthM, 300);
  const heading = route.startHeading;

  /** Stationary fixes at the start with wandering position but zero Doppler speed. */
  function wander(from: number, to: number, wanderM = 6): Fix[] {
    const out: Fix[] = [];
    for (let t = from; t <= to; t += 1000) {
      const p = offsetLatLon(ORIGIN, wanderM * Math.sin(t / 1300), (t / 37) % 360);
      out.push({ ...p, t, accuracy: 8, speed: 0, heading: null });
    }
    return out;
  }

  /** Accelerate along the route from `fromT` with accel a, returning 1 Hz fixes until toT. */
  function launch(fromT: number, toT: number, a = 3, startS = 0): Fix[] {
    const out: Fix[] = [];
    for (let t = fromT + 1000; t <= toT; t += 1000) {
      const dt = (t - fromT) / 1000;
      const tTop = 30 / a;
      const v = Math.min(30, a * dt);
      const s = startS + (dt <= tTop ? 0.5 * a * dt * dt : 0.5 * a * tTop * tTop + 30 * (dt - tTop));
      // offsetLatLon keeps going straight past the finish, unlike pointAt which clamps.
      out.push({ ...offsetLatLon(ORIGIN, s, heading), t, accuracy: 4, speed: v, heading });
    }
    return out;
  }

  function accel(fromT: number, toT: number, ax: number): { t: number; x: number; y: number; z: number }[] {
    const out = [];
    for (let t = fromT; t <= toT; t += 20) out.push({ t, x: ax, y: 0, z: 9.81 });
    return out;
  }

  function setup(countdownS = 5) {
    const timer = new LapTimer({ route, boundaries, isLoop: false, startType: 'standing', countdownS });
    const ev = run(timer, wander(T0, T0 + 3000));
    expect(of(ev, 'ready')).toHaveLength(1);
    // Baseline: gravity only, while ready.
    for (const s of accel(T0 + 3000, T0 + 3500, 0)) timer.motion(s);
    const tap = T0 + 4000;
    const goT = timer.startCountdown(tap)!;
    expect(goT).toBe(tap + countdownS * 1000);
    return { timer, goT };
  }

  it('starts the timer exactly at GO and gives no penalty when the car waits', () => {
    const { timer, goT } = setup();
    const ev: TimerEvent[] = [];
    ev.push(...run(timer, wander(T0 + 5000, goT)));
    for (const s of accel(goT + 250, goT + 900, 3)) ev.push(...timer.motion(s));
    ev.push(...run(timer, launch(goT + 250, goT + 60_000)));
    expect(of(ev, 'started')[0].t).toBe(goT);
    expect(of(ev, 'jumpStart')).toHaveLength(0);
    const result = of(ev, 'finished')[0].result;
    expect(result.penaltyMs).toBe(0);
    expect(result.reactionMs).toBe(250);
    expect(result.countdownS).toBe(5);
  });

  it('ignores 6 m of position wander with zero Doppler speed (no false penalty)', () => {
    const { timer, goT } = setup();
    const ev = run(timer, wander(T0 + 5000, goT + 3000, 9));
    expect(of(ev, 'jumpStart')).toHaveLength(0);
  });

  it('penalises real forward movement of more than 10 m before GO', () => {
    const { timer, goT } = setup();
    const moveT = goT - 3000; // 3 s early at 3 m/s² ≈ 13.5 m by GO
    const ev: TimerEvent[] = [];
    ev.push(...run(timer, wander(T0 + 5000, moveT)));
    for (const s of accel(moveT, moveT + 1500, 3)) ev.push(...timer.motion(s));
    ev.push(...run(timer, launch(moveT, goT + 60_000)));
    const jump = of(ev, 'jumpStart')[0];
    expect(jump).toBeDefined();
    expect(jump.penaltyMs).toBe(5000);
    expect(jump.distanceM).toBeGreaterThan(10);
    const result = of(ev, 'finished')[0].result;
    expect(result.jumpStart).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.reactionMs).toBeLessThan(0);
    // Penalty is included in every split.
    const sectors = of(ev, 'sector');
    expect(sectors[0].splitMs).toBeGreaterThan(5000);
    expect(sectors[0].colour).not.toBe('purple');
    expect(result.totalMs).toBe(sectors[sectors.length - 1].splitMs);
  });

  it('does not penalise a creep under the threshold', () => {
    const { timer, goT } = setup();
    const moveT = goT - 2000; // 2 s at 3 m/s² = 6 m
    const ev: TimerEvent[] = [];
    ev.push(...run(timer, wander(T0 + 5000, moveT)));
    for (const s of accel(moveT, moveT + 1500, 3)) ev.push(...timer.motion(s));
    ev.push(...run(timer, launch(moveT, goT + 60_000)));
    expect(of(ev, 'jumpStart')).toHaveLength(0);
  });

  it('can cancel the countdown with no penalty', () => {
    const { timer } = setup();
    expect(of(timer.cancelCountdown(), 'countdownCancelled')).toHaveLength(1);
    expect(timer.phase).toBe('ready');
  });

  it('clamps the countdown to 3-10 s', () => {
    expect(new LapTimer({ route, boundaries, isLoop: false, startType: 'standing', countdownS: 1 }).cfg.countdownS).toBe(3);
    expect(new LapTimer({ route, boundaries, isLoop: false, startType: 'standing', countdownS: 20 }).cfg.countdownS).toBe(10);
  });
});

describe('comparison', () => {
  const route = new PreparedRoute(straight(1500));
  const boundaries = computeSectorBoundaries(route.lengthM, 500);
  const lap = (kmh: number) => {
    const t = new LapTimer({ route, boundaries, isLoop: false, startType: 'rolling' });
    const r = of(run(t, simulateDrive(route, { speedKmh: kmh, leadInM: 100 })), 'finished')[0].result;
    return { ...r, profile: lapProfileFromTrace(r.trace, route.lengthM) };
  };

  it('compares two laps sector by sector with a smooth delta line', () => {
    const a = lap(100);
    const b = lap(90);
    const cmp = compareLaps(a, b, boundaries);
    expect(cmp.gapMs).toBe(a.totalMs - b.totalMs);
    expect(cmp.gapMs).toBeLessThan(0);
    expect(cmp.sectors.every((s) => s.faster === 'a')).toBe(true);
    expect(cmp.smooth).toBe(true);
    expect(cmp.delta[cmp.delta.length - 1].ms).toBe(cmp.gapMs);
    expect(cmp.speed![50].a).toBeCloseTo(100, 0);
  });

  it('falls back to sector splits without profiles', () => {
    const a = lap(100);
    const b = lap(90);
    const cmp = compareLaps({ ...a, profile: null }, b, boundaries);
    expect(cmp.smooth).toBe(false);
    expect(cmp.delta).toHaveLength(boundaries.length + 1);
  });

  it('builds a theoretical best from the best sectors', () => {
    expect(theoreticalBest([{ splitTimesMs: [10, 25, 40] }, { splitTimesMs: [12, 24, 36] }])).toEqual([10, 22, 34]);
  });

  it('builds a 10 m profile with monotonic elapsed time', () => {
    const p = lap(80).profile;
    expect(p.elapsedMs.length).toBe(Math.floor(route.lengthM / 10) + 1);
    for (let i = 1; i < p.elapsedMs.length; i++) expect(p.elapsedMs[i]).toBeGreaterThanOrEqual(p.elapsedMs[i - 1]);
  });
});
