import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GpsLog, LapResult, PreparedRoute, computeSectorBoundaries, offsetLatLon, replayLog, simulateDrive } from '../src';

const ORIGIN = { lat: 49.2, lon: 16.6 };

function circle(radiusM: number, n = 72) {
  return Array.from({ length: n + 1 }, (_, i) => offsetLatLon(ORIGIN, radiusM, 180 + (i / n) * 360));
}

function sane(lap: LapResult, sectors: number) {
  expect(lap.splitTimesMs).toHaveLength(sectors);
  lap.splitTimesMs.forEach((s, i) => expect(s).toBeGreaterThan(i ? lap.splitTimesMs[i - 1] : 0));
  expect(lap.totalMs).toBe(lap.splitTimesMs[sectors - 1]);
}

describe('replayLog', () => {
  it('replays a recorded rolling loop session into the same laps', () => {
    const coords = circle(400);
    const route = new PreparedRoute(coords);
    const boundaries = computeSectorBoundaries(route.lengthM, 250);
    const fixes = simulateDrive(route, { speedKmh: 80, leadInM: 150, laps: 2, loop: true, startT: 1_700_000_000_000, noiseM: 1.5, seed: 7 });
    const log: GpsLog = {
      version: 1,
      recordedAt: 0,
      userAgent: 'test',
      route: { id: 'r', name: 'Ring', coords, isLoop: true, startType: 'rolling', boundaries },
      countdownS: 5,
      fixes,
      motion: [],
      controls: [],
    };
    const { laps } = replayLog(JSON.parse(JSON.stringify(log)));
    expect(laps).toHaveLength(2);
    for (const lap of laps) sane(lap, boundaries.length);
    // 2513 m at 80 km/h ≈ 113 s a lap.
    expect(laps[1].totalMs / 1000).toBeCloseTo(route.lengthM / (80 / 3.6), -1);
  });
});

// Real drives: drop logs downloaded from Settings → GPS logs into test/fixtures/.
const dir = join(__dirname, 'fixtures');
let files: string[] = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.json'));
} catch {
  /* no fixtures yet */
}

describe.skipIf(!files.length)('recorded GPS fixtures', () => {
  for (const f of files) {
    it(f, () => {
      const log: GpsLog = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const { laps, events, phase } = replayLog(log);
      for (const lap of laps) sane(lap, log.route.boundaries.length);
      const dt = log.fixes.slice(1).map((x, i) => x.t - log.fixes[i].t);
      console.log(
        `${f}: ${log.fixes.length} fixes, median interval ${dt.sort((a, b) => a - b)[dt.length >> 1] ?? '-'} ms, ` +
          `phase ${phase}, laps ${laps.map((l) => (l.totalMs / 1000).toFixed(2)).join(' / ') || 'none'}, ` +
          `invalid: ${events.filter((e) => e.type === 'invalidated').map((e) => (e as { reason: string }).reason).join(',') || 'no'}`,
      );
    });
  }
});
