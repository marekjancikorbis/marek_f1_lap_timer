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
 * Sector colours. Purple overrides green; a missing baseline means nobody has
 * set one yet, so this time does.
 *   Public routes:  purple beats the route record (fastest posted sector) and your
 *                   own best too, so with nothing posted yet it means a new PB;
 *                   green beats your personal best for the sector.
 *   Private routes: purple beats your personal best (your theoretical-best sector),
 *                   green beats the same sector of the lap you're racing.
 */
export function sectorColour(
  sectorMs: number,
  pbMs: number | null | undefined,
  recordMs: number | null | undefined,
  isPublic = true,
  refMs?: number | null,
): SectorColour {
  if (isPublic) {
    const beatsPb = pbMs == null || sectorMs < pbMs;
    if (beatsPb && (recordMs == null || sectorMs < recordMs)) return 'purple';
    return beatsPb ? 'green' : 'yellow';
  }
  if (pbMs == null || sectorMs < pbMs) return 'purple';
  return refMs != null && sectorMs < refMs ? 'green' : 'yellow';
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
