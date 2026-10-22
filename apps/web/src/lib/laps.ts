import { bestSectors, bigSectorEnds, bigSplits, sectorColour, sectorTimes, theoreticalBest, type LapProfile } from '@laptimer/timing';
import { getPost, getRun, routePosts, runsForRoute, sectorRecordsFrom } from './data';
import type { Post, Route, Run, SectorColourName } from './types';

/**
 * A lap that can be compared or raced against:
 *   run:<id>   one of your own laps
 *   post:<id>  anyone's posted lap
 *   best       your theoretical best (best sector each)
 *   record     the route record (sum of purple sectors)
 */
export type LapRef = string;

export interface ResolvedLap {
  ref: LapRef;
  label: string;
  sub: string;
  splitTimesMs: number[];
  totalMs: number;
  penaltyMs: number;
  profile: LapProfile | null;
  userId: string | null;
  username: string | null;
}

export function runToLap(run: Run, label = 'Your lap'): ResolvedLap {
  return {
    ref: `run:${run.id}`,
    label,
    sub: new Date(run.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    splitTimesMs: run.splitTimesMs,
    totalMs: run.totalMs,
    penaltyMs: run.penaltyMs,
    profile: run.profile,
    userId: null,
    username: null,
  };
}

export function postToLap(post: Post): ResolvedLap {
  return {
    ref: `post:${post.id}`,
    label: post.username,
    sub: post.caption ?? new Date(post.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    splitTimesMs: post.splitTimesMs,
    totalMs: post.totalMs,
    penaltyMs: post.penaltyMs,
    profile: post.profile,
    userId: post.userId,
    username: post.username,
  };
}

export async function resolveLap(ref: LapRef, uid: string, routeId: string): Promise<ResolvedLap | null> {
  if (ref.startsWith('run:')) {
    const run = await getRun(uid, ref.slice(4));
    return run ? runToLap(run) : null;
  }
  if (ref.startsWith('post:')) {
    const post = await getPost(ref.slice(5));
    return post ? postToLap(post) : null;
  }
  if (ref === 'best') {
    const runs = (await runsForRoute(uid, routeId)).filter((r) => r.valid);
    const splits = theoreticalBest(runs);
    if (!splits) return null;
    return {
      ref,
      label: 'Theoretical best',
      sub: 'Your best time in each sector',
      splitTimesMs: splits,
      totalMs: splits[splits.length - 1],
      penaltyMs: 0,
      profile: null,
      userId: null,
      username: null,
    };
  }
  if (ref === 'record') {
    const posts = await routePosts(routeId);
    if (!posts.length) return null;
    const rec = sectorRecordsFrom(posts, posts[0].splitTimesMs.length);
    if (rec.some((r) => r == null)) return null;
    let acc = 0;
    const splits = (rec as number[]).map((s) => (acc += s));
    return {
      ref,
      label: 'Route record',
      sub: 'Fastest posted time in each sector',
      splitTimesMs: splits,
      totalMs: acc,
      penaltyMs: 0,
      profile: null,
      userId: null,
      username: null,
    };
  }
  return null;
}

/**
 * Colour each sector of a lap (see sectorColour). records is null on private
 * routes; there purple is against your best sectors and green against the
 * lap you raced (refSplits).
 */
export function coloursFor(
  splits: number[],
  pbs: (number | null)[],
  records: (number | null)[] | null,
  refSplits: number[] | null = null,
): SectorColourName[] {
  const refSecs = refSplits ? sectorTimes(refSplits) : null;
  return sectorTimes(splits).map((s, i) => sectorColour(s, pbs[i] ?? null, records?.[i] ?? null, records != null, refSecs?.[i] ?? null));
}

/** Splits of the lap this run raced, when that was one of your own laps (others' posts need a fetch). */
export function racedSplits(run: Pick<Run, 'referenceRef'>, runs: Run[]): number[] | null {
  const id = run.referenceRef?.startsWith('run:') ? run.referenceRef.slice(4) : null;
  return (id && runs.find((r) => r.id === id)?.splitTimesMs) || null;
}

/**
 * The driver's best sectors from the laps before this one, so a saved lap
 * shows green where it was a personal best when it was driven.
 */
export function pbsBefore(runs: Run[], lap: Pick<Run, 'id' | 'startedAt' | 'splitTimesMs'>): (number | null)[] {
  return bestSectors(
    runs.filter((r) => r.valid && r.id !== lap.id && r.startedAt < lap.startedAt && r.splitTimesMs.length === lap.splitTimesMs.length),
  );
}

/**
 * Records excluding a given lap, so a lap is purple only when it beat the
 * fastest *other* time (otherwise every record holder's own lap reads as
 * merely equal).
 */
export function recordsExcluding(posts: Post[], sectorCount: number, excludeId?: string): (number | null)[] {
  return sectorRecordsFrom(
    posts.filter((p) => p.id !== excludeId),
    sectorCount,
  );
}

// ---------------------------------------------------------------- big sectors

/*
 * Routes are timed in minisectors (route.boundaries). On top of those every
 * route has 3 big sectors ending at the minisector ends closest to its thirds;
 * everything except lap detail shows only the big ones.
 */

/** Indices into route.boundaries where the 3 big sectors end. */
export const bigEnds = (route: Pick<Route, 'boundaries'>) => bigSectorEnds(route.boundaries);

/** The route cut into its 3 big sectors, for drawing (RouteShape, RouteMap). */
export function bigRoute<R extends Pick<Route, 'boundaries'>>(route: R): R {
  return { ...route, boundaries: bigSplits(route.boundaries, bigEnds(route)) };
}

/** Laps on the route's current minisectors, cut down to their big-sector splits. */
export function toBig<T extends { splitTimesMs: number[] }>(laps: T[], route: Pick<Route, 'boundaries'>): T[] {
  const ends = bigEnds(route);
  return laps
    .filter((l) => l.splitTimesMs.length === route.boundaries.length)
    .map((l) => ({ ...l, splitTimesMs: bigSplits(l.splitTimesMs, ends) }));
}

/** Big-sector records (fastest posted time per big sector). */
export function bigRecords(posts: Post[], route: Pick<Route, 'boundaries'>, excludeId?: string): (number | null)[] {
  return sectorRecordsFrom(toBig(posts.filter((p) => p.id !== excludeId), route), bigEnds(route).length);
}

/** Big-sector colours of a lap: coloursFor on the big splits. */
export function bigColoursFor(
  splits: number[],
  route: Pick<Route, 'boundaries'>,
  priorRuns: Run[],
  records: (number | null)[] | null,
  refSplits: number[] | null = null,
): SectorColourName[] {
  const ends = bigEnds(route);
  if (splits.length !== route.boundaries.length) return [];
  const pbs = bestSectors(toBig(priorRuns.filter((r) => r.valid), route));
  const ref = refSplits && refSplits.length === route.boundaries.length ? bigSplits(refSplits, ends) : null;
  return coloursFor(bigSplits(splits, ends), pbs, records, ref);
}

/**
 * A post's big-sector colours. Posts from before big sectors only stored
 * minisector colours, so those are summarised.
 * shortcut: approximate for old posts (all purple = purple, mostly yellow = yellow, else green); exact once reposted.
 */
export function postBigColours(post: Pick<Post, 'bigColours' | 'sectorColours'>, route: Pick<Route, 'boundaries'> | null | undefined): SectorColourName[] {
  if (post.bigColours?.length) return post.bigColours;
  if (!route || post.sectorColours.length !== route.boundaries.length) return [];
  let from = 0;
  return bigEnds(route).map((end) => {
    const group = post.sectorColours.slice(from, end + 1);
    from = end + 1;
    if (group.every((c) => c === 'purple')) return 'purple';
    return group.filter((c) => c === 'yellow').length * 2 > group.length ? 'yellow' : 'green';
  });
}

// ---------------------------------------------------------------- where a lap was

/** Position along the route at elapsed time t, from the profile or the splits. */
export function distanceAt(t: number, lap: Pick<ResolvedLap, 'penaltyMs' | 'splitTimesMs'>, boundaries: number[], profile: LapProfile | null): number {
  const pen = lap.penaltyMs;
  if (profile && profile.elapsedMs.length > 1) {
    const e = profile.elapsedMs;
    const tt = t - pen;
    if (tt <= 0) return 0;
    for (let i = 1; i < e.length; i++) {
      if (e[i] >= tt) {
        const f = (tt - e[i - 1]) / Math.max(1, e[i] - e[i - 1]);
        return (i - 1 + f) * profile.stepM;
      }
    }
    return boundaries[boundaries.length - 1];
  }
  const pts = [0, ...lap.splitTimesMs];
  const ds = [0, ...boundaries];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] >= t) return ds[i - 1] + ((t - pts[i - 1]) / Math.max(1, pts[i] - pts[i - 1])) * (ds[i] - ds[i - 1]);
  }
  return ds[ds.length - 1];
}

/** Elapsed time when a lap reached distance d (the inverse of distanceAt). */
export function timeAt(d: number, lap: Pick<ResolvedLap, 'penaltyMs' | 'splitTimesMs'>, boundaries: number[], profile: LapProfile | null): number {
  if (profile && profile.elapsedMs.length > 1) {
    const e = profile.elapsedMs;
    const x = d / profile.stepM;
    const i = Math.min(e.length - 2, Math.max(0, Math.floor(x)));
    return e[i] + (e[i + 1] - e[i]) * Math.min(1, x - i) + lap.penaltyMs;
  }
  const pts = [0, ...lap.splitTimesMs];
  const ds = [0, ...boundaries];
  for (let i = 1; i < ds.length; i++) {
    if (ds[i] >= d) return pts[i - 1] + ((d - ds[i - 1]) / Math.max(1, ds[i] - ds[i - 1])) * (pts[i] - pts[i - 1]);
  }
  return pts[pts.length - 1];
}
