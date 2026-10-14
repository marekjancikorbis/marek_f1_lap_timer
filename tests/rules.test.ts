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
    await assertFails(setDoc(doc(db('admin'), 'roles/admin'), { role: 'owner', grantedBy: 'admin', auditId: 'a' }));
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

  it('card map pictures have their own counter and cap', async () => {
    await seed({ 'usage/2026-10': { mapLoads: 3, directions: 5, staticMaps: 44_999 } });
    const u = doc(db('a'), 'usage/2026-10');
    await assertFails(updateDoc(u, { staticMaps: 45_000, mapLoads: 4 }));
    await assertSucceeds(updateDoc(u, { staticMaps: 45_000 }));
    await assertFails(updateDoc(u, { staticMaps: 45_001 }));
    await assertSucceeds(setDoc(doc(db('a'), 'usage/2026-11'), { mapLoads: 0, directions: 0, staticMaps: 1 }));
  });
});

describe('owner, admins and admin requests', () => {
  beforeEach(() =>
    seed({
      'roles/owner': { role: 'owner' },
      'roles/admin': { role: 'admin' },
      'roles/admin2': { role: 'admin' },
      'roles/creator': { role: 'creator' },
    }),
  );

  /** Role change with its audit entry, as the app writes it. */
  function grant(actor: string, target: string, role: string, auditId = `a-${actor}-${target}`) {
    const d = db(actor);
    const b = writeBatch(d);
    b.set(doc(d, `roleAudit/${auditId}`), { actorId: actor, action: role === 'admin' ? 'grant_admin' : 'grant_creator' });
    b.set(doc(d, `roles/${target}`), { role, grantedBy: actor, auditId });
    return b.commit();
  }

  it('only the owner makes admins', async () => {
    await assertFails(grant('admin', 'creator', 'admin'));
    await assertFails(grant('admin', 'driver', 'admin'));
    await assertSucceeds(grant('owner', 'creator', 'admin'));
  });

  it('admins cannot demote or remove other admins or the owner; the owner can remove admins', async () => {
    await assertFails(grant('admin', 'admin2', 'creator'));
    await assertFails(deleteDoc(doc(db('admin'), 'roles/admin2')));
    await assertFails(deleteDoc(doc(db('admin'), 'roles/owner')));
    await assertFails(grant('owner', 'owner', 'creator'));
    await assertSucceeds(grant('owner', 'admin2', 'creator'));
    await assertSucceeds(deleteDoc(doc(db('owner'), 'roles/admin')));
  });

  it('admins still handle creators', async () => {
    await assertSucceeds(grant('admin', 'driver', 'creator'));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'roles/creator')));
  });

  it('only creators can ask to be admin, and only the owner decides', async () => {
    const req = { username: 'x', note: '', status: 'pending', createdAt: null, decidedBy: null, decidedAt: null };
    await assertFails(setDoc(doc(db('driver'), 'adminRequests/driver'), req));
    await assertSucceeds(setDoc(doc(db('creator'), 'adminRequests/creator'), req));
    await assertFails(getDoc(doc(db('admin'), 'adminRequests/creator')));
    await assertFails(updateDoc(doc(db('admin'), 'adminRequests/creator'), { status: 'approved', decidedBy: 'admin', decidedAt: null }));
    await assertSucceeds(updateDoc(doc(db('owner'), 'adminRequests/creator'), { status: 'approved', decidedBy: 'owner', decidedAt: null }));
  });
});

describe('public route limits and the Official label', () => {
  beforeEach(() => seed({ 'roles/owner': { role: 'owner' }, 'roles/admin': { role: 'admin' }, 'roles/creator': { role: 'creator' } }));

  /** Publish one more route the way the app does: route public + id added to the profile, in one batch. */
  async function publish(uid: string, n: number) {
    const ids = Array.from({ length: n }, (_, i) => `${uid}-r${i}`);
    const docs: Record<string, object> = { [`users/${uid}`]: { username: uid, publicRouteIds: ids.slice(0, -1) } };
    for (const id of ids) docs[`routes/${id}`] = route(uid, { isPublic: ids.indexOf(id) < n - 1 });
    await seed(docs);
    const d = db(uid);
    const b = writeBatch(d);
    b.update(doc(d, `routes/${ids[n - 1]}`), { isPublic: true });
    b.update(doc(d, `users/${uid}`), { publicRouteIds: ids });
    return b.commit();
  }

  it('creator 1, admin 5, owner unlimited', async () => {
    await assertSucceeds(publish('creator', 1));
    await assertFails(publish('creator', 2));
    await assertSucceeds(publish('admin', 5));
    await assertFails(publish('admin', 6));
    await assertSucceeds(publish('owner', 20));
  });

  it('a route is public only if it is listed on its owner profile', async () => {
    await seed({ 'users/creator': { username: 'creator', publicRouteIds: [] }, 'routes/c1': route('creator') });
    await assertFails(updateDoc(doc(db('creator'), 'routes/c1'), { isPublic: true }));
  });

  it('only admins and the owner can label a route Official', async () => {
    await assertFails(setDoc(doc(db('creator'), 'routes/c1'), route('creator', { official: true })));
    await assertSucceeds(setDoc(doc(db('admin'), 'routes/a1'), route('admin', { official: true })));
    await assertSucceeds(setDoc(doc(db('owner'), 'routes/o1'), route('owner', { official: true })));
  });

  it('admins can make a published creator route Official, and the creator can still edit it', async () => {
    await seed({ 'users/creator': { username: 'creator', publicRouteIds: ['c1'] }, 'routes/c1': route('creator', { isPublic: true }), 'routes/c2': route('creator') });
    await assertFails(updateDoc(doc(db('creator'), 'routes/c1'), { official: true }));
    await assertFails(updateDoc(doc(db('admin'), 'routes/c2'), { official: true })); // not published
    await assertSucceeds(updateDoc(doc(db('admin'), 'routes/c1'), { official: true }));
    await assertSucceeds(updateDoc(doc(db('creator'), 'routes/c1'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db('creator'), 'routes/c1'), { official: false }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'routes/c1'), { official: false }));
  });

  it('admins cannot moderate admin or owner routes; the owner can', async () => {
    await seed({ 'routes/o1': route('owner', { isPublic: true, official: true }), 'routes/a1': route('admin', { isPublic: true, official: true }) });
    await assertFails(updateDoc(doc(db('admin'), 'routes/o1'), { hidden: true }));
    await assertSucceeds(updateDoc(doc(db('owner'), 'routes/a1'), { official: false, isPublic: false }));
  });
});

describe('limits after losing admin', () => {
  it('a removed admin cannot republish routes still listed on their profile', async () => {
    const ids = ['x0', 'x1', 'x2', 'x3', 'x4'];
    const docs: Record<string, object> = { 'roles/ex': { role: 'creator' }, 'users/ex': { username: 'ex', publicRouteIds: ids } };
    ids.forEach((id, i) => (docs[`routes/${id}`] = route('ex', { isPublic: i === 0 })));
    await seed(docs);
    await assertFails(updateDoc(doc(db('ex'), 'routes/x1'), { isPublic: true }));
    // Their remaining public route still works normally.
    await assertSucceeds(updateDoc(doc(db('ex'), 'routes/x0'), { name: 'Renamed' }));
  });
});

describe('home course', () => {
  beforeEach(() =>
    seed({
      'users/me': { username: 'me', publicRouteIds: [] },
      'users/other': { username: 'other', publicRouteIds: [] },
      'routes/pub': route('creator', { isPublic: true }),
      'routes/priv': route('creator'),
      'routes/hid': route('creator', { isPublic: true, hidden: true }),
    }),
  );

  it('can be a public route, or cleared', async () => {
    await assertSucceeds(updateDoc(doc(db('me'), 'users/me'), { homeRouteId: 'pub' }));
    await assertSucceeds(updateDoc(doc(db('me'), 'users/me'), { homeRouteId: null }));
  });

  it('cannot be a private, hidden or missing route, or set on someone else', async () => {
    await assertFails(updateDoc(doc(db('me'), 'users/me'), { homeRouteId: 'priv' }));
    await assertFails(updateDoc(doc(db('me'), 'users/me'), { homeRouteId: 'hid' }));
    await assertFails(updateDoc(doc(db('me'), 'users/me'), { homeRouteId: 'nope' }));
    await assertFails(updateDoc(doc(db('me'), 'users/other'), { homeRouteId: 'pub' }));
  });

  it('a removed admin over the limit can still edit the rest of their profile', async () => {
    await seed({ 'roles/ex': { role: 'creator' }, 'users/ex': { username: 'ex', publicRouteIds: ['a', 'b', 'c'] } });
    await assertSucceeds(updateDoc(doc(db('ex'), 'users/ex'), { countdownS: 7 }));
    await assertSucceeds(updateDoc(doc(db('ex'), 'users/ex'), { homeRouteId: 'pub' }));
  });
});
