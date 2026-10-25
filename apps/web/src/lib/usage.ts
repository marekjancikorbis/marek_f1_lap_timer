import { doc, getDoc, increment, runTransaction, setDoc } from 'firebase/firestore';
import { USAGE_CAP, USAGE_RESET_DAY } from './config';
import { db } from './firebase';

export type UsageKind = 'mapLoads' | 'directions' | 'staticMaps';

export class UsageLimitError extends Error {
  constructor(
    readonly kind: UsageKind,
    readonly resetsAt: Date,
  ) {
    super(`Monthly ${kind === 'directions' ? 'routing' : 'map'} limit reached`);
  }
}

/** Start of the usage period containing `now`, in UTC. */
export function periodStart(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, USAGE_RESET_DAY));
  return now >= thisMonth ? thisMonth : new Date(Date.UTC(y, m - 1, USAGE_RESET_DAY));
}

export function nextReset(now = new Date()): Date {
  const start = periodStart(now);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, USAGE_RESET_DAY));
}

export function periodKey(now = new Date()): string {
  const s = periodStart(now);
  const mm = String(s.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(USAGE_RESET_DAY).padStart(2, '0');
  return `${s.getUTCFullYear()}-${mm}-${dd}`;
}

export interface UsageState {
  mapLoads: number;
  directions: number;
  staticMaps: number;
  /** Only the live map and routing lock the app; out of card pictures, cards just go plain. */
  exhausted: Exclude<UsageKind, 'staticMaps'> | null;
  resetsAt: Date;
}

const listeners = new Set<(u: UsageState) => void>();
let last: UsageState | null = null;

export function onUsage(fn: (u: UsageState) => void): () => void {
  listeners.add(fn);
  if (last) fn(last);
  return () => {
    listeners.delete(fn);
  };
}

type Counts = Record<UsageKind, number>;

function counts(raw: Partial<Counts> | undefined): Counts {
  return { mapLoads: raw?.mapLoads ?? 0, directions: raw?.directions ?? 0, staticMaps: raw?.staticMaps ?? 0 };
}

function publish({ mapLoads, directions, staticMaps }: Counts) {
  const exhausted =
    mapLoads >= USAGE_CAP.mapLoads ? 'mapLoads' : directions >= USAGE_CAP.directions ? 'directions' : null;
  last = { mapLoads, directions, staticMaps, exhausted, resetsAt: nextReset() };
  listeners.forEach((l) => l(last!));
}

/** How many more this period allows, as last read; 0 while not read yet. */
export function roomLeft(kind: UsageKind): number {
  return last ? USAGE_CAP[kind] - last[kind] : 0;
}

export async function readUsage(): Promise<UsageState> {
  const snap = await getDoc(doc(db, 'usage', periodKey()));
  publish(counts(snap.data()));
  return last!;
}

/**
 * Count one Mapbox map load or Directions request before making it. Throws
 * UsageLimitError once the period's cap is reached. The security rules refuse
 * an increment past the cap, so a modified client cannot skip the count.
 */
export async function consume(kind: UsageKind): Promise<void> {
  const ref = doc(db, 'usage', periodKey());
  try {
    const next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        const fresh = { ...counts(undefined), [kind]: 1 };
        tx.set(ref, fresh);
        return fresh;
      }
      const d = counts(snap.data());
      if (d[kind] >= USAGE_CAP[kind]) throw new UsageLimitError(kind, nextReset());
      tx.update(ref, { [kind]: increment(1) });
      return { ...d, [kind]: d[kind] + 1 };
    });
    publish(next);
  } catch (e) {
    if (e instanceof UsageLimitError) {
      await readUsage().catch(() => undefined);
      throw e;
    }
    const code = (e as { code?: string }).code;
    if (code === 'permission-denied') {
      // The rules refused the increment: the cap is reached.
      await readUsage().catch(() => undefined);
      throw new UsageLimitError(kind, nextReset());
    }
    // Offline: transactions need the server. Queue a counted increment so the
    // cap still sees it, and let the map use cached tiles.
    if (code === 'unavailable' || !navigator.onLine) {
      void setDoc(ref, { [kind]: increment(1) }, { merge: true }).catch(() => undefined);
      return;
    }
    throw e;
  }
}
