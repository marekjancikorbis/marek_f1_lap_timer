import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { AuditEntry, CreatorRequest, Post, Profile, Role, Route, Run } from './types';

function withId<T>(snap: DocumentSnapshot | QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
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
    createdAt: serverTimestamp(),
    publicRouteIds: [],
    avatarHue: Math.floor(Math.random() * 360),
  });
  await batch.commit();
}

export async function setHomeRoute(uid: string, routeId: string | null): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { homeRouteId: routeId });
}

/** Users who picked this route as their home course. */
export async function localsOf(routeId: string): Promise<Profile[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('homeRouteId', '==', routeId), limit(100)));
  return snap.docs.map((d) => withId<Profile>(d)).sort((a, b) => a.username.localeCompare(b.username));
}

export async function updateMyProfile(uid: string, data: Partial<Pick<Profile, 'countdownS' | 'avatarHue'>> & { acceptedTermsAt?: unknown }) {
  await updateDoc(doc(db, 'users', uid), data);
}

export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? withId<Profile>(snap) : null;
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const name = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  if (!name.exists()) return null;
  return getProfile(name.data().uid as string);
}

export async function getProfiles(uids: string[]): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  for (const part of chunks([...new Set(uids)], 30)) {
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', part)));
    snap.forEach((d) => map.set(d.id, withId<Profile>(d)));
  }
  return map;
}

/** Username prefix search, case-insensitive, at most 20 results. */
export async function searchUsers(q: string): Promise<Profile[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('usernameLower', '>=', term),
      where('usernameLower', '<', term + ''),
      orderBy('usernameLower'),
      limit(20),
    ),
  );
  return snap.docs.map((d) => withId<Profile>(d));
}

export async function getRole(uid: string): Promise<Role> {
  try {
    const snap = await getDoc(doc(db, 'roles', uid));
    return snap.exists() ? (snap.data().role as Role) : 'driver';
  } catch {
    // Other users' roles are admin-only reads.
    return 'driver';
  }
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
}

export async function listAudit(): Promise<AuditEntry[]> {
  const snap = await getDocs(query(collection(db, 'roleAudit'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map((d) => withId<AuditEntry>(d));
}

// ================================================================ routes

export type NewRoute = Omit<Route, 'id' | 'createdAt' | 'publishedAt' | 'isPublic' | 'hidden' | 'hasRuns'>;

export async function createRoute(data: NewRoute): Promise<string> {
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

export async function getRoute(id: string): Promise<Route | null> {
  try {
    const snap = await getDoc(doc(db, 'routes', id));
    return snap.exists() ? withId<Route>(snap) : null;
  } catch {
    return null; // private route of someone else, or hidden
  }
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

export async function myRoutes(uid: string): Promise<Route[]> {
  const snap = await getDocs(query(collection(db, 'routes'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => withId<Route>(d));
}

export async function publicRoutes(): Promise<Route[]> {
  const snap = await getDocs(query(collection(db, 'routes'), where('isPublic', '==', true), where('hidden', '==', false), limit(500)));
  return snap.docs.map((d) => withId<Route>(d));
}

export async function publicRoutesOf(uid: string): Promise<Route[]> {
  const snap = await getDocs(
    query(collection(db, 'routes'), where('ownerId', '==', uid), where('isPublic', '==', true), where('hidden', '==', false), limit(50)),
  );
  return snap.docs.map((d) => withId<Route>(d));
}

/** How many routes a role may have public at once. */
export function publicLimit(role: Role): number {
  return role === 'owner' ? Infinity : role === 'admin' ? 5 : role === 'creator' ? 1 : 0;
}

export async function renameRoute(id: string, name: string) {
  await updateDoc(doc(db, 'routes', id), { name: name.trim().slice(0, 60) });
}

async function deleteAll(docs: QueryDocumentSnapshot[]) {
  for (const part of chunks(docs, 400)) {
    const batch = writeBatch(db);
    part.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

function myRunsOn(uid: string, routeId: string) {
  return getDocs(query(collection(db, 'users', uid, 'runs'), where('routeId', '==', routeId)));
}

/** Owner delete of a private route; the owner's own runs on it go too, as they'd have no route to show against. */
export async function deleteRoute(uid: string, id: string) {
  await deleteDoc(doc(db, 'routes', id));
  await deleteAll((await myRunsOn(uid, id)).docs);
}

/**
 * Edit a route. A new shape, sectors or start makes laps timed on the old one
 * wrong, so the route's posted laps and the editor's own runs on it go.
 * Only a published route can have posts (and only admins edit those).
 */
export async function updateRoute(uid: string, route: Route, change: Partial<Route>, shapeChanged: boolean) {
  await updateDoc(doc(db, 'routes', route.id), shapeChanged ? { ...change, shapeVersion: (route.shapeVersion ?? 0) + 1 } : change);
  if (!shapeChanged) return;
  if (route.publishedAt) await deleteAll((await getDocs(query(collection(db, 'posts'), where('routeId', '==', route.id)))).docs);
  await deleteAll((await myRunsOn(uid, route.id)).docs);
}

/**
 * Make a route public or private, keeping the profile's publicRouteIds in step
 * (the rules check one against the other). A creator's single public route is
 * replaced; with more allowed, publishing past the limit is refused.
 */
export async function setRoutePublic(profile: Profile, role: Role, own: Route[], route: Route, makePublic: boolean): Promise<void> {
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
  await updateDoc(doc(db, 'routes', route.id), { hasRuns: true }).catch(() => undefined);
}

/** Admin moderation. Hiding a route also hides its posts from feeds and boards. */
export async function moderateRoute(routeId: string, change: { isPublic?: boolean; hidden?: boolean; official?: boolean }) {
  await updateDoc(doc(db, 'routes', routeId), change);
  if (change.hidden !== undefined) {
    const posts = await getDocs(query(collection(db, 'posts'), where('routeId', '==', routeId)));
    for (const part of chunks(posts.docs, 400)) {
      const batch = writeBatch(db);
      part.forEach((p) => batch.update(p.ref, { hidden: change.hidden }));
      await batch.commit();
    }
  }
}

/** Admin delete. The route goes first so a refused delete leaves its posts alone; then its posts, which would point nowhere. */
export async function adminDeleteRoute(routeId: string) {
  await deleteDoc(doc(db, 'routes', routeId));
  await deleteAll((await getDocs(query(collection(db, 'posts'), where('routeId', '==', routeId)))).docs);
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

export async function saveRun(uid: string, run: Omit<Run, 'createdAt'>): Promise<void> {
  const { id, ...data } = run;
  // Don't wait for the server: offline saves complete when signal returns.
  void setDoc(doc(db, 'users', uid, 'runs', id), { ...data, createdAt: serverTimestamp() });
}

export async function getRun(uid: string, id: string): Promise<Run | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'runs', id));
  return snap.exists() ? withId<Run>(snap) : null;
}

export async function runsForRoute(uid: string, routeId: string): Promise<Run[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'runs'), where('routeId', '==', routeId)));
  return snap.docs.map((d) => withId<Run>(d)).sort((a, b) => b.startedAt - a.startedAt);
}

export async function allMyRuns(uid: string): Promise<Run[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'runs'), orderBy('startedAt', 'desc'), limit(500)));
  return snap.docs.map((d) => withId<Run>(d));
}

export async function deleteRun(uid: string, run: Run) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'runs', run.id));
  if (run.posted) batch.delete(doc(db, 'posts', run.id));
  await batch.commit();
}

// ================================================================ posts

export async function postLap(
  profile: Profile,
  run: Run,
  route: Route,
  extra: Pick<Post, 'caption' | 'car' | 'sectorColours' | 'positionAtPost' | 'isPB'>,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'posts', run.id), {
    userId: profile.id,
    username: profile.username,
    avatarHue: profile.avatarHue ?? 200,
    routeId: route.id,
    routeName: route.name,
    totalMs: run.totalMs,
    splitTimesMs: run.splitTimesMs,
    penaltyMs: run.penaltyMs,
    reactionMs: run.reactionMs,
    jumpStart: run.jumpStart,
    caption: extra.caption?.trim() || null,
    car: extra.car?.trim() || null,
    createdAt: serverTimestamp(),
    startedAt: run.startedAt,
    hidden: false,
    profile: run.profile,
    sectorColours: extra.sectorColours,
    positionAtPost: extra.positionAtPost,
    isPB: extra.isPB,
  });
  batch.update(doc(db, 'users', profile.id, 'runs', run.id), { posted: true });
  await batch.commit();
}

export async function unpostLap(uid: string, runId: string) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'posts', runId));
  batch.update(doc(db, 'users', uid, 'runs', runId), { posted: false });
  await batch.commit();
}

export async function removePost(postId: string) {
  await deleteDoc(doc(db, 'posts', postId));
}

export async function getPost(id: string): Promise<Post | null> {
  try {
    const snap = await getDoc(doc(db, 'posts', id));
    return snap.exists() ? withId<Post>(snap) : null;
  } catch {
    return null;
  }
}

export async function routePosts(routeId: string, max = 300): Promise<Post[]> {
  const snap = await getDocs(
    query(collection(db, 'posts'), where('routeId', '==', routeId), where('hidden', '==', false), orderBy('totalMs', 'asc'), limit(max)),
  );
  return snap.docs.map((d) => withId<Post>(d));
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

export async function userPosts(uid: string, max = 200): Promise<Post[]> {
  const snap = await getDocs(
    query(collection(db, 'posts'), where('userId', '==', uid), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(max)),
  );
  return snap.docs.map((d) => withId<Post>(d));
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
export async function feedPage(followeeIds: string[], cursor: FeedPage['cursor'], pageSize = 20): Promise<FeedPage> {
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
      const snap = await getDocs(query(collection(db, 'posts'), ...constraints));
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
  await updateDoc(doc(db, 'posts', id), { caption: caption?.trim() || null, car: car?.trim() || null });
}

// ================================================================ follows

export async function follow(me: string, them: string) {
  await setDoc(doc(db, 'follows', `${me}_${them}`), { followerId: me, followeeId: them, createdAt: serverTimestamp() });
}

export async function unfollow(me: string, them: string) {
  await deleteDoc(doc(db, 'follows', `${me}_${them}`));
}

export async function followingIds(uid: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'follows'), where('followerId', '==', uid)));
  return snap.docs.map((d) => d.data().followeeId as string);
}

export async function followerIds(uid: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'follows'), where('followeeId', '==', uid)));
  return snap.docs.map((d) => d.data().followerId as string);
}

export async function followCounts(uid: string): Promise<{ followers: number; following: number }> {
  const [a, b] = await Promise.all([
    getCountFromServer(query(collection(db, 'follows'), where('followeeId', '==', uid))),
    getCountFromServer(query(collection(db, 'follows'), where('followerId', '==', uid))),
  ]);
  return { followers: a.data().count, following: b.data().count };
}

export async function postCount(uid: string): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, 'posts'), where('userId', '==', uid), where('hidden', '==', false)));
  return snap.data().count;
}
