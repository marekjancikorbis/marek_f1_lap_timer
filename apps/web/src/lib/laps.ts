import { bestSectors, sectorColour, sectorTimes, theoreticalBest, type LapProfile } from '@laptimer/timing';
import { getPost, getRun, routePosts, runsForRoute, sectorRecordsFrom } from './data';
import type { Post, Run, SectorColourName } from './types';

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
  reactionMs: number | null;
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
    reactionMs: run.reactionMs,
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
    reactionMs: post.reactionMs,
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
      reactionMs: null,
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
      reactionMs: null,
      profile: null,
      userId: null,
      username: null,
    };
  }
  return null;
}

/**
 * Colour each sector of a lap: purple vs the route records (null on private
 * routes: no purple), green vs the driver's personal bests.
 */
export function coloursFor(splits: number[], pbs: (number | null)[], records: (number | null)[] | null): SectorColourName[] {
  return sectorTimes(splits).map((s, i) => sectorColour(s, pbs[i] ?? null, records?.[i] ?? null, records != null));
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
