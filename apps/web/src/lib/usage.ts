import { doc, getDoc, increment, runTransaction, setDoc } from 'firebase/firestore';
import { USAGE_CAP, USAGE_RESET_DAY } from './config';
import { db } from './firebase';

export type UsageKind = 'mapLoads' | 'directions';

export class UsageLimitError extends Error {
  constructor(
    readonly kind: UsageKind,
    readonly resetsAt: Date,
  ) {
    super(`Monthly ${kind === 'mapLoads' ? 'map' : 'routing'} limit reached`);
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
  exhausted: UsageKind | null;
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

function publish(mapLoads: number, directions: number) {
  const exhausted: UsageKind | null =
    mapLoads >= USAGE_CAP.mapLoads ? 'mapLoads' : directions >= USAGE_CAP.directions ? 'directions' : null;
  last = { mapLoads, directions, exhausted, resetsAt: nextReset() };
  listeners.forEach((l) => l(last!));
}

export async function readUsage(): Promise<UsageState> {
  const snap = await getDoc(doc(db, 'usage', periodKey()));
  const d = snap.data() ?? { mapLoads: 0, directions: 0 };
  publish(d.mapLoads ?? 0, d.directions ?? 0);
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
        const fresh = { mapLoads: kind === 'mapLoads' ? 1 : 0, directions: kind === 'directions' ? 1 : 0 };
        tx.set(ref, fresh);
        return fresh;
      }
      const raw = snap.data();
      const d = { mapLoads: (raw.mapLoads as number) ?? 0, directions: (raw.directions as number) ?? 0 };
      if (d[kind] >= USAGE_CAP[kind]) throw new UsageLimitError(kind, nextReset());
      tx.update(ref, { [kind]: increment(1) });
      return { ...d, [kind]: d[kind] + 1 };
    });
    publish(next.mapLoads, next.directions);
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
