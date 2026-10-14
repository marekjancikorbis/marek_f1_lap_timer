import { describe, expect, it } from 'vitest';
import { LapTimer, LatLon, PreparedRoute, TimerEvent, computeSectorBoundaries, offsetLatLon, simulateTrackDrive } from '../src';

const ORIGIN: LatLon = { lat: 49.2, lon: 16.6 };

/** Polyline from (length m, turn deg) legs; turns spread over the leg at a constant radius. */
function legs(spec: [number, number][]): LatLon[] {
  let p = ORIGIN;
  let h = 90;
  const pts = [p];
  for (const [len, turn] of spec) {
    const steps = Math.max(1, Math.round(len / 4));
    for (let i = 0; i < steps; i++) {
      h += turn / steps;
      p = offsetLatLon(p, len / steps, h);
      pts.push(p);
    }
  }
  return pts;
}

/** Rally stage: hairpins, fast sweepers and short straights. */
const STAGE = legs([
  [300, 0], [60, 90], [180, 0], [45, -160], [120, 0], [150, 40], [90, -70], [400, 0],
  [35, 170], [200, 0], [110, -60], [70, 80], [250, 0], [50, -120], [160, 25], [300, 0],
]);

/** Circuit: 2 straights, two tight hairpins, a chicane. Closes on itself. */
const CIRCUIT = legs([
  [500, 0], [126, 180], [200, 0], [30, 45], [30, -90], [30, 45], [219.11, 0], [126, 180],
]);

interface Stats { n: number; rms: number; p95: number; max: number }

function measure(coords: LatLon[], loop: boolean, intervalMs: number, noiseM: number, seeds = 20): Stats {
  const route = new PreparedRoute(coords);
  const boundaries = computeSectorBoundaries(route.lengthM, 200);
  const errs: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const { fixes, timeAt } = simulateTrackDrive(route, {
      laps: loop ? 2 : 1, loop, intervalMs, jitterMs: 30, noiseM, speedNoise: noiseM ? 0.3 : 0, seed, vMaxKmh: 170,
    });
    const timer = new LapTimer({ route, boundaries, isLoop: loop, startType: 'rolling' });
    const ev: TimerEvent[] = fixes.flatMap((f) => timer.push(f));
    const started = ev.find((e) => e.type === 'started') as Extract<TimerEvent, { type: 'started' }>;
    errs.push(started.t - timeAt(0));
    for (const lap of timer.laps) {
      lap.splitTimesMs.forEach((split, k) => errs.push(lap.startT + split - timeAt(lap.lap * route.lengthM + boundaries[k])));
    }
    expect(timer.laps).toHaveLength(loop ? 2 : 1);
  }
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return {
    n: abs.length,
    rms: Math.round(Math.sqrt(abs.reduce((a, e) => a + e * e, 0) / abs.length)),
    p95: Math.round(abs[Math.floor(abs.length * 0.95)]),
    max: Math.round(abs[abs.length - 1]),
  };
}

const COURSES = [['rally stage', STAGE, false], ['circuit', CIRCUIT, true]] as const;

// Interpolation alone, with perfect GPS: what the engine itself contributes.
describe('gate accuracy with perfect GPS', () => {
  for (const [name, coords, loop] of COURSES) {
    it(`${name} at 1 Hz`, () => {
      const s = measure(coords, loop, 1000, 0);
      expect(s.max).toBeLessThan(60);
    });
  }
});

// Plan exit criterion (phase 1): gate error ~0.2 s. With a 2.5 m drifting position
// error the GPS, not the interpolation, dominates: 5 Hz is no better than 1 Hz,
// so smoother (e.g. Hermite) interpolation would not help. Only better fixes would.
describe('gate accuracy with phone-grade GPS (2.5 m drifting error)', () => {
  for (const [name, coords, loop] of COURSES) {
    for (const hz of [1, 5]) {
      it(`${name} at ${hz} Hz`, () => {
        const s = measure(coords, loop, 1000 / hz, 2.5);
        console.log(`${name} ${hz} Hz: ${s.n} gates, rms ${s.rms} ms, p95 ${s.p95} ms, max ${s.max} ms`);
        expect(s.rms).toBeLessThan(120);
        expect(s.p95).toBeLessThan(250);
      });
    }
  }
});
