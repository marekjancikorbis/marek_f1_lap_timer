// Security rules tests against the Firestore emulator. Run with `npm run test:rules`
// (needs Java 11+ on PATH for the emulator).
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-laptimer',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Write fixtures with the rules switched off. */
async function seed(docs: Record<string, object>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of Object.entries(docs)) await setDoc(doc(ctx.firestore(), path), data);
  });
}

const route = (ownerId: string, extra: object = {}) => ({
  ownerId,
  ownerName: ownerId,
  name: 'Stage 1',
  coords: [16.6, 49.2, 16.61, 49.2],
  lengthM: 730,
  isLoop: false,
  sectorLengthM: 250,
  boundaries: [250, 500, 730],
  startType: 'standing',
  isPublic: false,
  publishedAt: null,
  hidden: false,
  hasRuns: false,
  ...extra,
});

const run = (extra: object = {}) => ({
  routeId: 'pub',
  totalMs: 60_000,
  splitTimesMs: [20_000, 40_000, 60_000],
  penaltyMs: 0,
  jumpStart: false,
  valid: true,
  replay: false,
  posted: false,
  ...extra,
});

const post = (extra: object = {}) => ({
  userId: 'driver',
  routeId: 'pub',
  totalMs: 60_000,
  splitTimesMs: [20_000, 40_000, 60_000],
  penaltyMs: 0,
  jumpStart: false,
  hidden: false,
  caption: 'clean run',
  car: null,
  ...extra,
});

describe('route creation needs creator access (plan phase 2 exit criterion)', () => {
  beforeEach(() => seed({ 'roles/creator': { role: 'creator' }, 'roles/admin': { role: 'admin' } }));

  it('rejects a direct insert from a driver', async () => {
    await assertFails(setDoc(doc(db('driver'), 'routes/r1'), route('driver')));
  });

  it('accepts a creator and an admin', async () => {
    await assertSucceeds(setDoc(doc(db('creator'), 'routes/r1'), route('creator')));
    await assertSucceeds(setDoc(doc(db('admin'), 'routes/r2'), route('admin')));
  });

  it('rejects routes created already public, for someone else, or with bad sectors', async () => {
    const c = db('creator');
    await assertFails(setDoc(doc(c, 'routes/r1'), route('creator', { isPublic: true })));
    await assertFails(setDoc(doc(c, 'routes/r2'), route('someone-else')));
    await assertFails(setDoc(doc(c, 'routes/r3'), route('creator', { sectorLengthM: 30 })));
    await assertFails(setDoc(doc(c, 'routes/r4'), route('creator', { name: 'x'.repeat(61) })));
  });

  it('caps the name length on rename too', async () => {
    await seed({ 'routes/r1': route('creator') });
    await assertSucceeds(updateDoc(doc(db('creator'), 'routes/r1'), { name: 'Stage 2' }));
    await assertFails(updateDoc(doc(db('creator'), 'routes/r1'), { name: 'x'.repeat(61) }));
  });

  it('freezes geometry once a route has runs', async () => {
    await seed({ 'routes/r1': route('creator', { hasRuns: true }) });
    await assertFails(updateDoc(doc(db('creator'), 'routes/r1'), { boundaries: [100, 730] }));
    await assertFails(updateDoc(doc(db('creator'), 'routes/r1'), { hasRuns: false }));
  });
});

describe('roles', () => {
  beforeEach(() => seed({ 'roles/admin': { role: 'admin' }, 'roles/creator': { role: 'creator' } }));

  it('nobody grants themselves a role', async () => {
    await assertFails(setDoc(doc(db('driver'), 'roles/driver'), { role: 'creator', grantedBy: 'driver', auditId: 'a' }));
    await assertFails(updateDoc(doc(db('creator'), 'roles/creator'), { role: 'admin' }));
  });

  it('an admin grants creator, with an audit entry, and never admin', async () => {
    const a = db('admin');
    const ok = writeBatch(a);
    ok.set(doc(a, 'roleAudit/a1'), { actorId: 'admin', action: 'grant_creator', targetId: 'driver' });
    ok.set(doc(a, 'roles/driver'), { role: 'creator', grantedBy: 'admin', auditId: 'a1' });
    await assertSucceeds(ok.commit());

    const noAudit = setDoc(doc(a, 'roles/other'), { role: 'creator', grantedBy: 'admin', auditId: 'missing' });
    await assertFails(noAudit);

    const toAdmin = writeBatch(a);
    toAdmin.set(doc(a, 'roleAudit/a2'), { actorId: 'admin', action: 'grant_creator' });
    toAdmin.set(doc(a, 'roles/other'), { role: 'admin', grantedBy: 'admin', auditId: 'a2' });
    await assertFails(toAdmin.commit());
  });
});

describe('privacy', () => {
  beforeEach(() =>
    seed({
      'routes/priv': route('creator'),
      'routes/pub': route('creator', { isPublic: true }),
      'routes/hid': route('creator', { isPublic: true, hidden: true }),
      'users/driver/runs/run1': run(),
    }),
  );

  it('private and hidden routes are owner-only; public ones are readable', async () => {
    await assertFails(getDoc(doc(db('stranger'), 'routes/priv')));
    await assertFails(getDoc(doc(db('stranger'), 'routes/hid')));
    await assertSucceeds(getDoc(doc(db('stranger'), 'routes/pub')));
    await assertSucceeds(getDoc(doc(db('creator'), 'routes/priv')));
    await assertFails(getDoc(doc(anon(), 'routes/pub')));
  });

  it('runs (with raw traces) are owner-only', async () => {
    await assertSucceeds(getDoc(doc(db('driver'), 'users/driver/runs/run1')));
    await assertFails(getDoc(doc(db('stranger'), 'users/driver/runs/run1')));
    await assertFails(setDoc(doc(db('stranger'), 'users/driver/runs/run2'), run()));
  });

  it('lap results are immutable once saved', async () => {
    await assertFails(updateDoc(doc(db('driver'), 'users/driver/runs/run1'), { totalMs: 50_000 }));
    await assertSucceeds(updateDoc(doc(db('driver'), 'users/driver/runs/run1'), { posted: true }));
  });
});

describe('posting laps', () => {
  beforeEach(() =>
    seed({
      'routes/pub': route('creator', { isPublic: true }),
      'routes/priv': route('creator'),
      'users/driver/runs/run1': run(),
      'users/driver/runs/sim': run({ replay: true }),
      'users/driver/runs/privrun': run({ routeId: 'priv' }),
    }),
  );

  it('accepts a post that matches its run exactly', async () => {
    await assertSucceeds(setDoc(doc(db('driver'), 'posts/run1'), post()));
  });

  it('rejects doctored times, simulated laps, private routes and other people', async () => {
    const d = db('driver');
    await assertFails(setDoc(doc(d, 'posts/run1'), post({ totalMs: 50_000, splitTimesMs: [15_000, 30_000, 50_000] })));
    await assertFails(setDoc(doc(d, 'posts/sim'), post()));
    await assertFails(setDoc(doc(d, 'posts/privrun'), post({ routeId: 'priv' })));
    await assertFails(setDoc(doc(db('stranger'), 'posts/run1'), post({ userId: 'stranger' })));
  });

  it('caps caption and car length on edit as well as on create', async () => {
    await seed({ 'posts/run1': post() });
    await assertSucceeds(updateDoc(doc(db('driver'), 'posts/run1'), { caption: 'new caption' }));
    await assertFails(updateDoc(doc(db('driver'), 'posts/run1'), { caption: 'x'.repeat(281) }));
    await assertFails(updateDoc(doc(db('driver'), 'posts/run1'), { car: 'x'.repeat(41) }));
    await assertFails(updateDoc(doc(db('driver'), 'posts/run1'), { totalMs: 1 }));
  });

  it('only the author or an admin removes a post', async () => {
    await seed({ 'posts/run1': post(), 'roles/admin': { role: 'admin' } });
    await assertFails(deleteDoc(doc(db('stranger'), 'posts/run1')));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'posts/run1')));
  });
});

describe('follows and the Mapbox usage cap', () => {
  it('follows are made by the follower, under their own id', async () => {
    await assertSucceeds(setDoc(doc(db('a'), 'follows/a_b'), { followerId: 'a', followeeId: 'b' }));
    await assertFails(setDoc(doc(db('a'), 'follows/b_c'), { followerId: 'b', followeeId: 'c' }));
    await assertFails(setDoc(doc(db('a'), 'follows/a_a'), { followerId: 'a', followeeId: 'a' }));
  });

  it('counters only go up by one and stop at the cap', async () => {
    await seed({ 'usage/2026-10': { mapLoads: 44_999, directions: 5 } });
    const u = doc(db('a'), 'usage/2026-10');
    await assertFails(updateDoc(u, { mapLoads: 0 }));
    await assertFails(updateDoc(u, { mapLoads: 45_001 }));
    await assertSucceeds(updateDoc(u, { mapLoads: 45_000 }));
    await assertFails(updateDoc(u, { mapLoads: 45_001 }));
  });
});
