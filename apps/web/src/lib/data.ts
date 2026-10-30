import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { Timestamp } from 'firebase/firestore';
import type { AuditEntry, CreatorRequest, Notice, Post, Profile, Role, Route, Run } from './types';

function withId<T>(snap: DocumentSnapshot | QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
}

// ================================================================ session cache

/**
 * Reads from the last minute come straight from memory, so going back to a
 * screen needs no network; older ones (up to 10 minutes) too, refreshed behind.
 * Every write below forgets the keys it touches, so your own changes always show;
 * other people's show on the next visit.
 */
const cache = new Map<string, { at: number; value: Promise<unknown>; refreshing?: boolean }>();
const TTL_MS = 60_000;
/** Older than the TTL but within this, a read answers from memory at once and refreshes behind it. */
const STALE_MS = 10 * 60_000;
/** Keys read this session: only a key's first read may come from the phone's copy, never one after forget(). */
const seen = new Set<string>();

/**
 * disk: on a cold start (nothing in memory), answer from Firestore's copy on this phone
 * instead of waiting for the server; null when it has nothing. It counts as already stale,
 * so the next read refreshes it; a screen that must show fresh data now reloads with forget().
 */
function cached<T>(key: string, load: () => Promise<T>, disk?: () => Promise<T | null>): Promise<T> {
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < TTL_MS) return hit.value as Promise<T>;
  if (hit && age < STALE_MS) {
    // The fresh copy shows on the next visit. A write in between forgets the key, so it never lands over the write.
    if (!hit.refreshing) {
      hit.refreshing = true;
      load().then(
        (v) => cache.get(key) === hit && cache.set(key, { at: Date.now(), value: Promise.resolve(v) }),
        () => (hit.refreshing = false),
      );
    }
    return hit.value as Promise<T>;
  }
  const at = Date.now();
  if (seen.has(key)) disk = undefined;
  seen.add(key);
  const value = disk
    ? disk()
        .catch(() => null)
        .then((v) => {
          if (v != null) return v;
          const e = cache.get(key);
          if (e?.value === value) e.at = Date.now(); // came from the server after all: fresh
          return load();
        })
    : load();
  cache.set(key, { at: disk ? at - TTL_MS : at, value });
  value.catch(() => cache.get(key)?.value === value && cache.delete(key)); // never keep a failure
  return value;
}

/** Drop every cached read whose key starts with one of these. */
export function forget(...prefixes: string[]) {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
}

/** On sign-out or a user switch. */
export function clearCache() {
  cache.clear();
  seen.clear();
}

/**
 * Load documents by id in batches: everything asked for in one tick shares `in` queries of 30.
 * Missing documents resolve to null.
 */
function batched<T>(
  run: (ids: string[]) => Promise<{ docs: QueryDocumentSnapshot[] }>,
  pick: (d: QueryDocumentSnapshot) => T,
): (id: string) => Promise<T | null> {
  let queue: { id: string; resolve: (v: T | null) => void; reject: (e: unknown) => void }[] = [];
  const flush = async () => {
    const q = queue;
    queue = [];
    try {
      const found = new Map<string, T>();
      const snaps = await Promise.all(chunks([...new Set(q.map((x) => x.id))], 30).map(run));
      for (const s of snaps) s.docs.forEach((d) => found.set(d.id, pick(d)));
      q.forEach((x) => x.resolve(found.get(x.id) ?? null));
    } catch (e) {
      q.forEach((x) => x.reject(e));
    }
  };
  return (id) =>
    new Promise((resolve, reject) => {
      if (!queue.length) setTimeout(flush);
      queue.push({ id, resolve, reject });
    });
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ================================================================ profiles

export const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;

export async function usernameTaken(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return snap.exists();
}

export async function createProfile(uid: string, username: string): Promise<void> {
  const lower = username.toLowerCase();
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', lower), { uid });
  batch.set(doc(db, 'users', uid), {
    username,
    usernameLower: lower,
    displayName: username,
    displayNameLower: lower,
    createdAt: serverTimestamp(),
    publicRouteIds: [],
    avatarHue: Math.floor(Math.random() * 360),
  });
  await batch.commit();
}

export async function setHomeRoute(uid: string, routeId: string | null): Promise<void> {
  forget('profile');
  await updateDoc(doc(db, 'users', uid), { homeRouteId: routeId });
}

/** Users who picked this route as their home course. */
export function localsOf(routeId: string): Promise<Profile[]> {
  // Under 'profile' so setting a home course forgets it.
  return cached(`profile:locals:${routeId}`, async () => {
    const snap = await getDocs(query(collection(db, 'users'), where('homeRouteId', '==', routeId), limit(100)));
    return snap.docs.map((d) => withId<Profile>(d)).sort((a, b) => a.username.localeCompare(b.username));
  });
}

export async function updateMyProfile(uid: string, data: Partial<Pick<Profile, 'countdownS' | 'avatarHue'>> & { acceptedTermsAt?: unknown }) {
  forget('profile');
  await updateDoc(doc(db, 'users', uid), data);
}

/** Display names can change, so a post's name is looked up by its driver: a list's names share a few queries. */
const loadProfiles = batched((ids) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', ids))), (d) => withId<Profile>(d));

export function getProfile(uid: string): Promise<Profile | null> {
  return cached(`profile:${uid}`, () => loadProfiles(uid));
}

export const NAME_MAX = 30;

export async function setDisplayName(uid: string, name: string) {
  // Invisible and direction-flipping characters could disguise a name; the rules refuse them too.
  const displayName = name.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  if (!displayName) throw new Error('Enter a name.');
  forget('profile');
  await updateDoc(doc(db, 'users', uid), { displayName, displayNameLower: displayName.toLowerCase() });
}

// Photos live apart from profiles, so the many profile reads stay small. An `in` query only bills
// the photos that exist, so drivers without one cost nothing.
const loadPhotos = batched((ids) => getDocs(query(collection(db, 'avatars'), where(documentId(), 'in', ids))), (d) => d.data().photo as string);

export function getPhoto(uid: string): Promise<string | null> {
  return cached(`photo:${uid}`, () => loadPhotos(uid));
}

/** A square JPEG data URL (see squarePhoto), or null to go back to initials. */
export async function setPhoto(uid: string, photo: string | null) {
  forget(`photo:${uid}`);
  await (photo ? setDoc(doc(db, 'avatars', uid), { photo }) : deleteDoc(doc(db, 'avatars', uid)));
}

/**
 * Crop to the middle square and shrink to 160 px: about 10 KB, small enough to keep in Firestore.
 * Refuses photos the on-device check finds sexual; if the check can't run (offline), nothing is saved.
 */
export async function squarePhoto(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const crop = (size: number) => {
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas;
  };
  const { looksUnsafe } = await import('./photoCheck').catch(() => {
    throw new Error("Couldn't check the photo. Try again when you're online.");
  });
  // The model sees 224 px, the size it was trained on, of the same square that gets shown.
  if (await looksUnsafe(crop(224))) throw new Error("This photo can't be used. Pick a different one.");
  return crop(160).toDataURL('image/jpeg', 0.82);
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  // A username never moves to another driver, so the lookup caches like the profile.
  const uid = await cached(`profile:name:${username.toLowerCase()}`, async () => {
    const name = await getDoc(doc(db, 'usernames', username.toLowerCase()));
    return name.exists() ? (name.data().uid as string) : null;
  });
  return uid ? getProfile(uid) : null;
}

export function getProfiles(uids: string[]): Promise<Map<string, Profile>> {
  const ids = [...new Set(uids)].sort();
  return cached(`profiles:${ids.join(',')}`, async () => {
    const map = new Map<string, Profile>();
    for (const part of chunks(ids, 30)) {
      const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', part)));
      snap.forEach((d) => map.set(d.id, withId<Profile>(d)));
    }
    return map;
  });
}

/** Prefix search on the @handle and the display name, case-insensitive; "@..." searches handles only. At most 20. */
export async function searchUsers(q: string): Promise<Profile[]> {
  const handleOnly = q.trim().startsWith('@');
  const term = q.trim().replace(/^@/, '').toLowerCase();
  if (!term) return [];
  const by = (field: string) =>
    getDocs(query(collection(db, 'users'), where(field, '>=', term), where(field, '<', term + ''), orderBy(field), limit(20)));
  const snaps = await Promise.all(handleOnly ? [by('usernameLower')] : [by('usernameLower'), by('displayNameLower')]);
  const found = new Map<string, Profile>();
  for (const s of snaps) s.docs.forEach((d) => found.set(d.id, withId<Profile>(d)));
  return [...found.values()].slice(0, 20);
}

export function getRole(uid: string): Promise<Role> {
  return cached(`role:${uid}`, async () => {
    try {
      const snap = await getDoc(doc(db, 'roles', uid));
      return snap.exists() ? (snap.data().role as Role) : 'driver';
    } catch {
      // Other users' roles are admin-only reads.
      return 'driver';
    }
  });
}

// ================================================================ roles & admin

/** Creator requests go to admins; admin requests (from creators) go to the owner only. */
export type RequestKind = 'creator' | 'admin';
const REQUESTS: Record<RequestKind, string> = { creator: 'creatorRequests', admin: 'adminRequests' };

export async function requestCreatorAccess(uid: string, username: string, note: string, kind: RequestKind = 'creator'): Promise<void> {
  await setDoc(doc(db, REQUESTS[kind], uid), {
    username,
    note: note.trim().slice(0, 500),
    status: 'pending',
    createdAt: serverTimestamp(),
    decidedBy: null,
    decidedAt: null,
  });
}

export async function getMyRequest(uid: string, kind: RequestKind = 'creator'): Promise<CreatorRequest | null> {
  const snap = await getDoc(doc(db, REQUESTS[kind], uid));
  return snap.exists() ? withId<CreatorRequest>(snap) : null;
}

export async function listRequests(status: 'pending' | 'all' = 'pending', kind: RequestKind = 'creator'): Promise<CreatorRequest[]> {
  const base = collection(db, REQUESTS[kind]);
  const q = status === 'pending' ? query(base, where('status', '==', 'pending'), orderBy('createdAt', 'asc')) : query(base, limit(100));
  const snap = await getDocs(q);
  return snap.docs.map((d) => withId<CreatorRequest>(d));
}

export async function listRoleHolders(): Promise<{ id: string; role: Role }[]> {
  const snap = await getDocs(collection(db, 'roles'));
  return snap.docs.map((d) => ({ id: d.id, role: d.data().role as Role }));
}

/**
 * Grant or revoke creator in one batch with its audit entry, so every role
 * change is logged (the rules require the audit document to exist).
 */
export async function setCreator(
  actor: Profile,
  target: { id: string; username: string },
  grant: boolean,
  fromRequest?: 'approve' | 'reject',
): Promise<void> {
  forget('role');
  const batch = writeBatch(db);
  const audit = doc(collection(db, 'roleAudit'));
  const action = fromRequest === 'reject' ? 'reject_request' : fromRequest === 'approve' ? 'approve_request' : grant ? 'grant_creator' : 'revoke_creator';
  batch.set(audit, {
    actorId: actor.id,
    actorName: actor.username,
    targetUserId: target.id,
    targetName: target.username,
    action,
    createdAt: serverTimestamp(),
  });
  if (fromRequest !== 'reject') {
    if (grant) {
      batch.set(doc(db, 'roles', target.id), {
        role: 'creator',
        grantedBy: actor.id,
        grantedAt: serverTimestamp(),
        auditId: audit.id,
      });
    } else {
      batch.delete(doc(db, 'roles', target.id));
    }
  }
  if (fromRequest) {
    batch.update(doc(db, 'creatorRequests', target.id), {
      status: fromRequest === 'approve' ? 'approved' : 'rejected',
      decidedBy: actor.id,
      decidedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  void notify(target.id, actor, { type: 'access', action });
}

/**
 * Owner only: make a creator an admin (optionally deciding their request), or
 * take admin away again. A removed admin goes back to creator: their routes
 * lose the Official label and all but one public route become private.
 */
export async function setAdmin(
  actor: Profile,
  target: { id: string; username: string },
  grant: boolean,
  fromRequest?: 'approve' | 'reject',
): Promise<void> {
  forget('route', 'role');
  const batch = writeBatch(db);
  const audit = doc(collection(db, 'roleAudit'));
  const action = fromRequest ? `${fromRequest}_admin_request` : grant ? 'grant_admin' : 'revoke_admin';
  batch.set(audit, {
    actorId: actor.id,
    actorName: actor.username,
    targetUserId: target.id,
    targetName: target.username,
    action,
    createdAt: serverTimestamp(),
  });
  if (fromRequest !== 'reject') {
    batch.set(doc(db, 'roles', target.id), {
      role: grant ? 'admin' : 'creator',
      grantedBy: actor.id,
      grantedAt: serverTimestamp(),
      auditId: audit.id,
    });
  }
  if (!grant && !fromRequest) {
    const theirs = await myRoutes(target.id);
    let keep = 1;
    for (const r of theirs) {
      const change: { official: boolean; isPublic?: boolean } = { official: false };
      if (r.isPublic && keep-- <= 0) change.isPublic = false;
      batch.update(doc(db, 'routes', r.id), change);
    }
  }
  if (fromRequest) {
    batch.update(doc(db, 'adminRequests', target.id), {
      status: fromRequest === 'approve' ? 'approved' : 'rejected',
      decidedBy: actor.id,
      decidedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  void notify(target.id, actor, { type: 'access', action });
}

export async function listAudit(): Promise<AuditEntry[]> {
  const snap = await getDocs(query(collection(db, 'roleAudit'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map((d) => withId<AuditEntry>(d));
}

// ================================================================ routes

export type NewRoute = Omit<Route, 'id' | 'createdAt' | 'publishedAt' | 'isPublic' | 'hidden' | 'hasRuns'>;

export async function createRoute(data: NewRoute): Promise<string> {
  forget('route');
  const ref = doc(collection(db, 'routes'));
  await setDoc(ref, {
    ...data,
    isPublic: false,
    hidden: false,
    hasRuns: false,
    publishedAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function getRoute(id: string): Promise<Route | null> {
  return cached(
    `route:${id}`,
    async () => {
      try {
        const snap = await getDoc(doc(db, 'routes', id));
        return snap.exists() ? withId<Route>(snap) : null;
      } catch {
        return null; // private route of someone else, or hidden
      }
    },
    async () => {
      // The phone's copy is shared by everyone who signed in on it: only what the rules let this user read.
      const snap = await getDocFromCache(doc(db, 'routes', id));
      const r = snap.exists() ? withId<Route>(snap) : null;
      return r && (r.ownerId === auth.currentUser?.uid || (r.isPublic && !r.hidden)) ? r : null;
    },
  );
}

export async function getRoutes(ids: string[]): Promise<Map<string, Route>> {
  const map = new Map<string, Route>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const r = await getRoute(id);
      if (r) map.set(id, r);
    }),
  );
  return map;
}

export function myRoutes(uid: string): Promise<Route[]> {
  return cached(`routes:mine:${uid}`, async () => {
    const snap = await getDocs(query(collection(db, 'routes'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => withId<Route>(d));
  });
}

export function publicRoutes(): Promise<Route[]> {
  return cached('routes:public', async () => {
    const snap = await getDocs(query(collection(db, 'routes'), where('isPublic', '==', true), where('hidden', '==', false), limit(500)));
    return snap.docs.map((d) => withId<Route>(d));
  });
}

export function publicRoutesOf(uid: string): Promise<Route[]> {
  return cached(`routes:of:${uid}`, async () => {
    const snap = await getDocs(
      query(collection(db, 'routes'), where('ownerId', '==', uid), where('isPublic', '==', true), where('hidden', '==', false), limit(50)),
    );
    return snap.docs.map((d) => withId<Route>(d));
  });
}

/** How many routes a role may have public at once. */
export function publicLimit(role: Role): number {
  return role === 'owner' ? Infinity : role === 'admin' ? 5 : role === 'creator' ? 1 : 0;
}

export async function renameRoute(id: string, name: string) {
  forget('route');
  await updateDoc(doc(db, 'routes', id), { name: name.trim().slice(0, 60) });
}

async function deleteAll(refs: DocumentReference[]) {
  for (const part of chunks(refs, 400)) {
    const batch = writeBatch(db);
    part.forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Refs of your runs on a route and their details, for deleting. */
async function myRunsOn(uid: string, routeId: string): Promise<DocumentReference[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'runs'), where('routeId', '==', routeId)));
  return snap.docs.flatMap((d) => [d.ref, detailRef(uid, d.id)]);
}

/** Owner delete of a private route; the owner's own runs on it go too, as they'd have no route to show against. */
export async function deleteRoute(uid: string, id: string) {
  forget('route', 'run');
  await deleteDoc(doc(db, 'routes', id));
  await deleteAll(await myRunsOn(uid, id));
}

/**
 * Edit a route. A new shape, sectors or start makes laps timed on the old one
 * wrong, so the route's posted laps and the editor's own runs on it go.
 * Only a published route can have posts (and only admins edit those).
 */
export async function updateRoute(uid: string, route: Route, change: Partial<Route>, shapeChanged: boolean) {
  forget('route', 'run', 'post', 'feed');
  // A new shape on a published route deletes its posts (below), so its count starts again at 0.
  const recount = route.publishedAt ? { postCount: 0, postCountV: 1 } : {};
  await updateDoc(doc(db, 'routes', route.id), shapeChanged ? { ...change, ...recount, shapeVersion: (route.shapeVersion ?? 0) + 1 } : change);
  if (!shapeChanged) return;
  if (route.publishedAt) await deleteAll((await getDocs(query(collection(db, 'posts'), where('routeId', '==', route.id)))).docs.map((d) => d.ref));
  await deleteAll(await myRunsOn(uid, route.id));
}

/**
 * Make a route public or private, keeping the profile's publicRouteIds in step
 * (the rules check one against the other). A creator's single public route is
 * replaced; with more allowed, publishing past the limit is refused.
 */
export async function setRoutePublic(profile: Profile, role: Role, own: Route[], route: Route, makePublic: boolean): Promise<void> {
  forget('route', 'profile');
  const userRef = doc(db, 'users', profile.id);
  let ids = profile.publicRouteIds ?? [];
  // Drop ids of routes that are no longer public (e.g. unpublished by a moderator); the rules allow one per write.
  for (const stale of ids.filter((id) => id !== route.id && !own.some((r) => r.id === id && r.isPublic))) {
    ids = ids.filter((id) => id !== stale);
    await updateDoc(userRef, { publicRouteIds: ids });
  }
  const batch = writeBatch(db);
  if (makePublic) {
    const limitN = publicLimit(role);
    if (ids.length >= limitN) {
      if (limitN !== 1) throw new Error(`You can have ${limitN} public routes. Make one private first.`);
      batch.update(doc(db, 'routes', ids[0]), { isPublic: false });
      ids = [];
    }
    batch.update(doc(db, 'routes', route.id), {
      isPublic: true,
      official: !!route.official || role === 'admin' || role === 'owner', // keeps a label an admin gave
      publishedAt: route.publishedAt ?? serverTimestamp(),
    });
    batch.update(userRef, { publicRouteIds: [...ids.filter((id) => id !== route.id), route.id] });
  } else {
    batch.update(doc(db, 'routes', route.id), { isPublic: false });
    if (ids.includes(route.id)) batch.update(userRef, { publicRouteIds: ids.filter((id) => id !== route.id) });
  }
  await batch.commit();
}

export async function markRouteHasRuns(route: Route) {
  if (route.hasRuns) return;
  forget('route');
  await updateDoc(doc(db, 'routes', route.id), { hasRuns: true }).catch(() => undefined);
}

/** Admin moderation. Hiding a route also hides its posts from feeds and boards. */
export async function moderateRoute(actor: Profile, route: Route, change: { isPublic?: boolean; hidden?: boolean; official?: boolean }) {
  const routeId = route.id;
  forget('route', 'post', 'feed');
  await updateDoc(doc(db, 'routes', routeId), change);
  if (change.hidden !== undefined) {
    void notify(route.ownerId, actor, { type: 'route', routeId, routeName: route.name, action: change.hidden ? 'hidden' : 'restored' });
    const posts = await getDocs(query(collection(db, 'posts'), where('routeId', '==', routeId)));
    for (const part of chunks(posts.docs, 400)) {
      const batch = writeBatch(db);
      part.forEach((p) => batch.update(p.ref, { hidden: change.hidden }));
      await batch.commit();
    }
  }
}

/** Admin delete. The route goes first so a refused delete leaves its posts alone; then its posts, which would point nowhere. */
export async function adminDeleteRoute(actor: Profile, route: Route) {
  const routeId = route.id;
  forget('route', 'post', 'feed');
  await deleteDoc(doc(db, 'routes', routeId));
  void notify(route.ownerId, actor, { type: 'route', routeId, routeName: route.name, action: 'deleted' });
  await deleteAll((await getDocs(query(collection(db, 'posts'), where('routeId', '==', routeId)))).docs.map((d) => d.ref));
}

export async function adminAllPublicRoutes(): Promise<Route[]> {
  const [pub, hidden] = await Promise.all([
    getDocs(query(collection(db, 'routes'), where('isPublic', '==', true), limit(500))),
    getDocs(query(collection(db, 'routes'), where('hidden', '==', true), limit(500))),
  ]);
  const map = new Map<string, Route>();
  [...pub.docs, ...hidden.docs].forEach((d) => map.set(d.id, withId<Route>(d)));
  return [...map.values()];
}

// ================================================================ runs

export function newRunId(uid: string): string {
  return doc(collection(db, 'users', uid, 'runs')).id;
}

/**
 * A run's heavy part (GPS trace, distance profile, tens of KB) lives in its own
 * document, so lists of runs download only times and splits.
 */
function detailRef(uid: string, runId: string) {
  return doc(db, 'users', uid, 'runs', runId, 'detail', 'main');
}

export type RunDetail = Pick<Run, 'trace' | 'profile'>;

export async function saveRun(uid: string, run: Omit<Run, 'createdAt'>): Promise<void> {
  const { id, trace, profile, ...data } = run;
  forget('run', 'activity');
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'runs', id), { ...data, createdAt: serverTimestamp() });
  batch.set(detailRef(uid, id), { trace: trace ?? [], profile: profile ?? null });
  // Don't wait for the server: offline saves complete when signal returns.
  void batch.commit();
  // Its own write: a failed count must never cost the lap.
  if (!run.replay) void countActivity(uid, run.startedAt, 1);
}

/** A run with its trace and profile. Runs saved before the split still carry them themselves. */
export function getRun(uid: string, id: string): Promise<Run | null> {
  return cached(`run:${uid}:${id}`, async () => {
    const [snap, detail] = await Promise.all([getDoc(doc(db, 'users', uid, 'runs', id)), getDoc(detailRef(uid, id))]);
    return snap.exists() ? { ...withId<Run>(snap), ...(detail.data() as RunDetail | undefined) } : null;
  });
}

/** Runs without trace and profile (see getRun for those). */
function lightRuns(uid: string, docs: QueryDocumentSnapshot[]): Run[] {
  moveDetails(uid, docs);
  return docs.map((d) => {
    const { trace: _t, profile: _p, ...run } = withId<Run>(d);
    return run;
  });
}

/**
 * Moves the trace and profile of runs saved before the split into their detail
 * document. The owner's app does it as it lists them (no server on Spark); the
 * rules only let those two fields go once the detail exists.
 */
const moving = new Set<string>();
function moveDetails(uid: string, docs: QueryDocumentSnapshot[]) {
  // One run per commit (~70 KB, like saving a lap): a request too big for the
  // transport is retried forever and would hold up every later write.
  for (const d of docs.filter((d) => 'trace' in d.data() && !moving.has(d.id))) {
    moving.add(d.id); // a list opened before the commit lands must not queue it again
    const { trace, profile } = d.data();
    const batch = writeBatch(db);
    batch.set(detailRef(uid, d.id), { trace, profile: profile ?? null });
    batch.update(d.ref, { trace: deleteField(), profile: deleteField() });
    void batch.commit().catch(() => undefined); // tried again on the next list
  }
}

export function runsForRoute(uid: string, routeId: string): Promise<Run[]> {
  return cached(`runs:route:${uid}:${routeId}`, async () => {
    const snap = await getDocs(query(collection(db, 'users', uid, 'runs'), where('routeId', '==', routeId)));
    return lightRuns(uid, snap.docs).sort((a, b) => b.startedAt - a.startedAt);
  });
}

export function allMyRuns(uid: string): Promise<Run[]> {
  const q = query(collection(db, 'users', uid, 'runs'), orderBy('startedAt', 'desc'), limit(500));
  return cached(
    `runs:all:${uid}`,
    async () => lightRuns(uid, (await getDocs(q)).docs),
    async () => {
      if (uid !== auth.currentUser?.uid) return null; // only your own laps from the phone's copy
      const snap = await getDocsFromCache(q);
      // Not lightRuns: moving old laps' details waits for the server's copy.
      return snap.empty ? null : snap.docs.map((d) => {
        const { trace: _t, profile: _p, ...run } = withId<Run>(d);
        return run;
      });
    },
  );
}

export async function deleteRun(uid: string, run: Run) {
  forget('run', 'post', 'feed', 'activity', 'route');
  await withPostCount(async (count) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'runs', run.id));
    batch.delete(detailRef(uid, run.id));
    if (run.posted) {
      batch.delete(doc(db, 'posts', run.id));
      if (count) countPost(batch, run.routeId, run.id, -1);
    }
    await batch.commit();
  });
  if (!run.replay) void countActivity(uid, run.startedAt, -1);
}

// ================================================================ activity

/** Local calendar day of a timestamp: the key in a user's activity map. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Activity {
  /** Laps driven per day (simulated ones don't count). Public, unlike the runs themselves. */
  days: Record<string, number>;
  /** Set once the laps driven before activity was counted have been added. */
  backfilled?: boolean;
}

function countActivity(uid: string, startedAt: number, by: 1 | -1) {
  return setDoc(doc(db, 'activity', uid), { days: { [dayKey(startedAt)]: increment(by) } }, { merge: true }).catch(() => {});
}

export function getActivity(uid: string): Promise<Activity | null> {
  return cached(`activity:${uid}`, async () => {
    const snap = await getDoc(doc(db, 'activity', uid));
    return snap.exists() ? (snap.data() as Activity) : null;
  });
}

/** Recount every day from your own laps (runs are private, so only you can). */
// shortcut: counts the newest 500 laps (allMyRuns' cap); page through runs if someone drives more before first opening their profile.
export async function backfillActivity(uid: string): Promise<Activity> {
  const days: Record<string, number> = {};
  for (const r of await allMyRuns(uid)) if (!r.replay) days[dayKey(r.startedAt)] = (days[dayKey(r.startedAt)] ?? 0) + 1;
  const a = { days, backfilled: true };
  forget('activity');
  await setDoc(doc(db, 'activity', uid), a);
  return a;
}

// ================================================================ posts

/**
 * Posting or unposting a lap moves its route's postCount by one, in the same
 * batch as the post: the rules require the pair, both ways.
 */
function countPost(batch: WriteBatch, routeId: string, postId: string, by: 1 | -1) {
  batch.update(doc(db, 'routes', routeId), { postCount: increment(by), lastPostId: postId });
}

/** Write with the count; if that's refused (the route was deleted, or a moderator already removed the post), write without it, which the rules then allow. */
async function withPostCount(write: (count: boolean) => Promise<void>) {
  await write(true).catch(() => write(false));
}

/** Moderators: store a route's exact count, for routes from before counts were kept. */
export async function setPostCount(routeId: string, postCount: number) {
  forget('route');
  await updateDoc(doc(db, 'routes', routeId), { postCount, postCountV: 1 });
}

export async function postLap(
  profile: Profile,
  run: Run,
  route: Route,
  extra: Pick<Post, 'caption' | 'car' | 'sectorColours' | 'bigColours' | 'positionAtPost' | 'isPB'>,
): Promise<void> {
  forget('run', 'post', 'feed', 'route');
  const batch = writeBatch(db);
  batch.update(doc(db, 'routes', route.id), { postCount: increment(1), lastPostId: run.id });
  batch.set(doc(db, 'posts', run.id), {
    userId: profile.id,
    username: profile.username,
    avatarHue: profile.avatarHue ?? 200,
    routeId: route.id,
    routeName: route.name,
    totalMs: run.totalMs,
    splitTimesMs: run.splitTimesMs,
    penaltyMs: run.penaltyMs,
    jumpStart: run.jumpStart,
    caption: extra.caption?.trim() || null,
    car: extra.car?.trim() || null,
    createdAt: serverTimestamp(),
    startedAt: run.startedAt,
    hidden: false,
    // A run from a list has no profile; fetch it.
    profile: run.profile !== undefined ? run.profile : ((await getDoc(detailRef(profile.id, run.id))).data()?.profile ?? null),
    sectorColours: extra.sectorColours,
    bigColours: extra.bigColours,
    positionAtPost: extra.positionAtPost,
    isPB: extra.isPB,
  });
  batch.update(doc(db, 'users', profile.id, 'runs', run.id), { posted: true });
  await batch.commit();
}

export async function unpostLap(uid: string, runId: string, routeId: string) {
  forget('run', 'post', 'feed', 'route');
  await withPostCount(async (count) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', runId));
    batch.update(doc(db, 'users', uid, 'runs', runId), { posted: false });
    if (count) countPost(batch, routeId, runId, -1);
    await batch.commit();
  });
}

/** Moderators: take a post down; its driver is told. */
export async function removePost(actor: Profile, post: Pick<Post, 'id' | 'routeId' | 'userId' | 'routeName' | 'totalMs'>) {
  forget('post', 'feed', 'route');
  await withPostCount(async (count) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', post.id));
    if (count) countPost(batch, post.routeId, post.id, -1);
    await batch.commit();
  });
  void notify(post.userId, actor, { type: 'postRemoved', routeName: post.routeName, totalMs: post.totalMs });
}

export function getPost(id: string): Promise<Post | null> {
  return cached(`post:${id}`, async () => {
    try {
      const snap = await getDoc(doc(db, 'posts', id));
      return snap.exists() ? withId<Post>(snap) : null;
    } catch {
      return null;
    }
  });
}

export function routePosts(routeId: string, max = 300): Promise<Post[]> {
  return cached(`posts:route:${routeId}:${max}`, async () => {
    const snap = await getDocs(
      query(collection(db, 'posts'), where('routeId', '==', routeId), where('hidden', '==', false), orderBy('totalMs', 'asc'), limit(max)),
    );
    return snap.docs.map((d) => withId<Post>(d));
  });
}

export interface LeaderRow {
  rank: number;
  post: Post;
}

/** Best posted lap per user, ranked. */
export function leaderboardFrom(posts: Post[]): LeaderRow[] {
  const best = new Map<string, Post>();
  for (const p of posts) {
    const cur = best.get(p.userId);
    if (!cur || p.totalMs < cur.totalMs) best.set(p.userId, p);
  }
  return [...best.values()]
    .sort((a, b) => a.totalMs - b.totalMs)
    .map((post, i) => ({ rank: i + 1, post }));
}

/** Fastest posted time per sector (purple). */
export function sectorRecordsFrom(posts: Post[], sectorCount: number): (number | null)[] {
  const rec: (number | null)[] = Array(sectorCount).fill(null);
  for (const p of posts) {
    if (p.splitTimesMs.length !== sectorCount) continue;
    p.splitTimesMs.forEach((s, i) => {
      const sec = i === 0 ? s : s - p.splitTimesMs[i - 1];
      if (rec[i] == null || sec < (rec[i] as number)) rec[i] = sec;
    });
  }
  return rec;
}

export function userPosts(uid: string, max = 200): Promise<Post[]> {
  return cached(`posts:user:${uid}:${max}`, async () => {
    const snap = await getDocs(
      query(collection(db, 'posts'), where('userId', '==', uid), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(max)),
    );
    return snap.docs.map((d) => withId<Post>(d));
  });
}

export interface FeedPage {
  posts: Post[];
  cursor: { createdAtMs: number; id: string } | null;
}

/**
 * Feed of followed users' posts, newest first, keyset-paginated on
 * (createdAt, id). Firestore has no join, so each batch of 30 followees is
 * queried and the results are merged.
 */
export function feedPage(followeeIds: string[], cursor: FeedPage['cursor'], pageSize = 20): Promise<FeedPage> {
  // Only the first page is kept: it's what going back to the Feed shows.
  if (cursor) return loadFeedPage(followeeIds, cursor, pageSize);
  return cached(
    `feed:${followeeIds.join(',')}:${pageSize}`,
    () => loadFeedPage(followeeIds, null, pageSize),
    async () => {
      const page = await loadFeedPage(followeeIds, null, pageSize, getDocsFromCache);
      return page.posts.length ? page : null;
    },
  );
}

async function loadFeedPage(followeeIds: string[], cursor: FeedPage['cursor'], pageSize: number, get = getDocs): Promise<FeedPage> {
  if (!followeeIds.length) return { posts: [], cursor: null };
  const results = await Promise.all(
    chunks(followeeIds, 30).map(async (part) => {
      const constraints = [
        where('userId', 'in', part),
        where('hidden', '==', false),
        orderBy('createdAt', 'desc'),
        ...(cursor ? [startAfter(new Date(cursor.createdAtMs))] : []),
        limit(pageSize),
      ];
      const snap = await get(query(collection(db, 'posts'), ...constraints));
      return snap.docs.map((d) => withId<Post>(d));
    }),
  );
  const merged = results
    .flat()
    .filter((p) => p.createdAt)
    .sort((a, b) => b.createdAt!.toMillis() - a.createdAt!.toMillis() || (a.id < b.id ? 1 : -1))
    .slice(0, pageSize);
  const last = merged[merged.length - 1];
  return {
    posts: merged,
    cursor: merged.length === pageSize && last ? { createdAtMs: last.createdAt!.toMillis(), id: last.id } : null,
  };
}

export async function recentPostsForAdmin(): Promise<Post[]> {
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map((d) => withId<Post>(d));
}

export async function updatePostText(id: string, caption: string | null, car: string | null) {
  forget('post', 'feed');
  await updateDoc(doc(db, 'posts', id), { caption: caption?.trim() || null, car: car?.trim() || null });
}

// ================================================================ follows

export async function follow(me: Pick<Profile, 'id' | 'username'>, them: string) {
  forget('follow', 'feed');
  await setDoc(doc(db, 'follows', `${me.id}_${them}`), { followerId: me.id, followeeId: them, createdAt: serverTimestamp() });
  // One per follower ever: following again after an unfollow isn't news (the rules refuse the overwrite).
  void notify(them, me, { type: 'follow' }, `follow_${me.id}`);
}

export async function unfollow(me: string, them: string) {
  forget('follow', 'feed');
  await deleteDoc(doc(db, 'follows', `${me}_${them}`));
}

export function followingIds(uid: string): Promise<string[]> {
  const q = query(collection(db, 'follows'), where('followerId', '==', uid));
  const ids = (snap: { docs: QueryDocumentSnapshot[] }) => snap.docs.map((d) => d.data().followeeId as string);
  return cached(
    `following:${uid}`,
    async () => ids(await getDocs(q)),
    async () => {
      const snap = await getDocsFromCache(q);
      return snap.empty ? null : ids(snap);
    },
  );
}

export function followerIds(uid: string): Promise<string[]> {
  return cached(`followers:${uid}`, async () => {
    const snap = await getDocs(query(collection(db, 'follows'), where('followeeId', '==', uid)));
    return snap.docs.map((d) => d.data().followerId as string);
  });
}

export function followCounts(uid: string): Promise<{ followers: number; following: number }> {
  return cached(`follow:counts:${uid}`, async () => {
    const [a, b] = await Promise.all([
      getCountFromServer(query(collection(db, 'follows'), where('followeeId', '==', uid))),
      getCountFromServer(query(collection(db, 'follows'), where('followerId', '==', uid))),
    ]);
    return { followers: a.data().count, following: b.data().count };
  });
}

export async function postCount(uid: string): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, 'posts'), where('userId', '==', uid), where('hidden', '==', false)));
  return snap.data().count;
}

// ================================================================ notifications

const notices = (uid: string) => collection(db, 'notifications', uid, 'items');

type NoticeData = Notice extends infer N ? (N extends Notice ? Omit<N, 'id' | 'createdAt' | 'fromId' | 'fromName'> : never) : never;

/** Best effort, after the thing it's about: a notification that can't be sent never fails that. */
function notify(to: string, from: Pick<Profile, 'id' | 'username'>, data: NoticeData, id?: string): Promise<void> {
  if (to === from.id) return Promise.resolve();
  const ref = id ? doc(notices(to), id) : doc(notices(to));
  return setDoc(ref, { ...data, fromId: from.id, fromName: from.username, createdAt: serverTimestamp() }).catch(() => undefined);
}

/**
 * Tell the drivers a new lap overtook on the board.
 * shortcut: only the 10 placed highest are told; fan out in batches if boards get long.
 */
export function notifyOvertaken(me: Profile, post: Pick<Post, 'id' | 'routeId' | 'routeName' | 'totalMs'>, overtaken: Post[]) {
  return Promise.all(
    overtaken.slice(0, 10).map((p) =>
      notify(
        p.userId,
        me,
        { type: 'beaten', postId: post.id, theirPostId: p.id, routeId: post.routeId, routeName: post.routeName, totalMs: post.totalMs, theirMs: p.totalMs },
        `beaten_${post.id}`,
      ),
    ),
  );
}

/** The newest 50; older ones just drop off the list. */
export async function listNotices(uid: string): Promise<{ notices: Notice[]; seenAt: Timestamp | null }> {
  const [snap, seen] = await Promise.all([
    getDocs(query(notices(uid), orderBy('createdAt', 'desc'), limit(50))),
    getDoc(doc(db, 'notifications', uid)),
  ]);
  return { notices: snap.docs.map((d) => withId<Notice>(d)), seenAt: seen.data()?.seenAt ?? null };
}

/** How many arrived since the page was last opened. */
export function unreadNotices(uid: string): Promise<number> {
  return cached(`notif:${uid}`, async () => {
    const seenAt = (await getDoc(doc(db, 'notifications', uid))).data()?.seenAt;
    const snap = await getCountFromServer(seenAt ? query(notices(uid), where('createdAt', '>', seenAt)) : notices(uid));
    return snap.data().count;
  });
}

export async function markNoticesSeen(uid: string) {
  forget('notif');
  await setDoc(doc(db, 'notifications', uid), { seenAt: serverTimestamp() });
}
