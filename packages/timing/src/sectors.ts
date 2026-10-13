export type SectorColour = 'purple' | 'green' | 'yellow';

/** Sector times from cumulative splits. */
export function sectorTimes(splitTimesMs: number[]): number[] {
  return splitTimesMs.map((s, i) => (i === 0 ? s : s - splitTimesMs[i - 1]));
}

/** Cumulative splits from sector times. */
export function splitsFromSectors(sectorMs: number[]): number[] {
  let acc = 0;
  return sectorMs.map((s) => (acc += s));
}

/**
 * Purple beats the fastest time anyone has set for that sector (a missing
 * record means nobody has set one yet, so any time is the fastest). Green
 * beats the reference lap's sector. Yellow otherwise. Purple overrides green.
 */
export function sectorColour(
  sectorMs: number,
  refSectorMs: number | null | undefined,
  recordMs: number | null | undefined,
): SectorColour {
  if (recordMs == null || sectorMs < recordMs) return 'purple';
  if (refSectorMs != null && sectorMs < refSectorMs) return 'green';
  return 'yellow';
}

/** Best time per sector across laps (all laps must share the route's boundaries). */
export function bestSectors(laps: { splitTimesMs: number[] }[]): (number | null)[] {
  if (!laps.length) return [];
  const n = laps[0].splitTimesMs.length;
  const best: (number | null)[] = Array(n).fill(null);
  for (const lap of laps) {
    if (lap.splitTimesMs.length !== n) continue;
    sectorTimes(lap.splitTimesMs).forEach((t, i) => {
      if (best[i] == null || t < (best[i] as number)) best[i] = t;
    });
  }
  return best;
}

/** Theoretical best lap: the sum of the best time in each sector. */
export function theoreticalBest(laps: { splitTimesMs: number[] }[]): number[] | null {
  const best = bestSectors(laps);
  if (!best.length || best.some((b) => b == null)) return null;
  return splitsFromSectors(best as number[]);
}
