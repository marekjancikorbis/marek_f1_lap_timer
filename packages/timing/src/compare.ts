import type { TracePoint } from './engine';
import { sectorTimes } from './sectors';

/**
 * Privacy-safe comparison data: elapsed time and speed sampled every stepM
 * metres of route distance, start gate to finish gate. No coordinates.
 */
export interface LapProfile {
  stepM: number;
  elapsedMs: number[];
  /** Speed in 0.1 m/s. */
  speedDms: number[];
}

export function lapProfileFromTrace(trace: TracePoint[], lengthM: number, stepM = 10): LapProfile {
  // Distance must be monotonic for interpolation; GPS noise can step backwards.
  const pts: TracePoint[] = [];
  let maxS = -Infinity;
  for (const p of [...trace].sort((a, b) => a.t - b.t)) {
    if (p.s > maxS) {
      pts.push(p);
      maxS = p.s;
    }
  }
  const elapsedMs: number[] = [];
  const speedDms: number[] = [];
  if (pts.length < 2) return { stepM, elapsedMs, speedDms };
  let j = 0;
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    while (j < pts.length - 2 && pts[j + 1].s < d) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const f = b.s === a.s ? 0 : Math.min(1, Math.max(0, (d - a.s) / (b.s - a.s)));
    elapsedMs.push(Math.max(0, Math.round(a.t + (b.t - a.t) * f)));
    speedDms.push(Math.max(0, Math.round((a.v + (b.v - a.v) * f) * 10)));
  }
  return { stepM, elapsedMs, speedDms };
}

export interface ComparableLap {
  splitTimesMs: number[];
  totalMs: number;
  penaltyMs?: number;
  reactionMs?: number | null;
  profile?: LapProfile | null;
}

export interface SectorComparison {
  k: number;
  aMs: number;
  bMs: number;
  /** a − b; negative means A was faster. */
  diffMs: number;
  faster: 'a' | 'b' | 'tie';
  /** True when that time is the route's record for the sector. */
  aRecord: boolean;
  bRecord: boolean;
}

export interface LapComparison {
  /** a − b total. */
  gapMs: number;
  sectors: SectorComparison[];
  /** Cumulative gap (a − b) against distance along the route. */
  delta: { d: number; ms: number }[];
  /** Overlaid speed traces in km/h, or null without profiles for both laps. */
  speed: { d: number; a: number; b: number }[] | null;
  /** True when the delta line comes from 10 m profiles rather than sector splits. */
  smooth: boolean;
}

/**
 * Compare two laps on the same route (same frozen boundaries). Used by the
 * app for every comparison view; boundaries give the delta graph its x axis
 * when either lap has no profile.
 */
export function compareLaps(
  a: ComparableLap,
  b: ComparableLap,
  boundaries: number[],
  sectorRecords: (number | null)[] = [],
): LapComparison {
  if (a.splitTimesMs.length !== b.splitTimesMs.length || a.splitTimesMs.length !== boundaries.length) {
    throw new Error('laps must be on the same route');
  }
  const sa = sectorTimes(a.splitTimesMs);
  const sb = sectorTimes(b.splitTimesMs);
  const sectors = sa.map((aMs, k) => {
    const bMs = sb[k];
    const rec = sectorRecords[k];
    return {
      k,
      aMs,
      bMs,
      diffMs: aMs - bMs,
      faster: (aMs < bMs ? 'a' : aMs > bMs ? 'b' : 'tie') as 'a' | 'b' | 'tie',
      aRecord: rec != null && aMs <= rec,
      bRecord: rec != null && bMs <= rec,
    };
  });

  const pa = a.profile;
  const pb = b.profile;
  const haveProfiles =
    pa && pb && pa.stepM === pb.stepM && pa.elapsedMs.length > 1 && pb.elapsedMs.length > 1;

  let delta: { d: number; ms: number }[];
  let speed: LapComparison['speed'] = null;
  if (haveProfiles) {
    const n = Math.min(pa.elapsedMs.length, pb.elapsedMs.length);
    // Penalties sit in sector 1 of the splits but not in the raw profile, so add them back.
    const penA = a.penaltyMs ?? 0;
    const penB = b.penaltyMs ?? 0;
    delta = [];
    speed = [];
    for (let i = 0; i < n; i++) {
      const d = i * pa.stepM;
      delta.push({ d, ms: pa.elapsedMs[i] + penA - (pb.elapsedMs[i] + penB) });
      speed.push({ d, a: (pa.speedDms[i] * 0.36), b: (pb.speedDms[i] * 0.36) });
    }
    // Make the line end exactly on the official gap.
    delta.push({ d: boundaries[boundaries.length - 1], ms: a.totalMs - b.totalMs });
  } else {
    delta = [{ d: 0, ms: 0 }, ...boundaries.map((d, k) => ({ d, ms: a.splitTimesMs[k] - b.splitTimesMs[k] }))];
  }

  return { gapMs: a.totalMs - b.totalMs, sectors, delta, speed, smooth: !!haveProfiles };
}
