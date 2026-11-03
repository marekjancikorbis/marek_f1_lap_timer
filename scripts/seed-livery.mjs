// Seeds the local emulators with the sample data the Livery mockups show (apps/web/design/livery),
// so the app can be compared screen by screen. Run seed-perf.mjs first: it makes perf@test.dev.
// Usage (emulators running): node scripts/seed-livery.mjs
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const app = initializeApp({ apiKey: 'fake', projectId: 'marek-f1-lap-timer' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const me = (await signInWithEmailAndPassword(auth, 'perf@test.dev', 'perfperf')).user.uid;

const drivers = [
  { id: 'petra', username: 'petra_r', hue: 20 },
  { id: 'jan', username: 'jan.k', hue: 175 },
  { id: 'ondra', username: 'ondra_m', hue: 222 },
];

function line(lng, lat, n, step, wiggle) {
  const c = [];
  for (let i = 0; i <= n; i++) c.push(lng + i * step, lat + Math.sin(i / 6) * wiggle);
  return c;
}
function loop(lng, lat, r, n) {
  const c = [];
  for (let i = 0; i <= n; i++) c.push(lng + Math.cos((i / n) * 2 * Math.PI) * r * 1.5, lat + Math.sin((i / n) * 2 * Math.PI) * r);
  return c;
}
const routes = [
  { id: 'ecce', name: 'Ecce Homo hill-climb', coords: line(17.27, 49.75, 60, 0.0008, 0.003), lengthM: 3420, isLoop: false, startType: 'standing' },
  { id: 'most', name: 'Autodrom Most', coords: loop(13.6, 50.52, 0.006, 60), lengthM: 4212, isLoop: true, startType: 'rolling' },
  { id: 'kart', name: 'Kart Vysoké Mýto', coords: loop(16.16, 49.95, 0.0015, 40), lengthM: 1010, isLoop: true, startType: 'rolling' },
];

const H = 3600_000;
const now = Date.now();
// [post id, user, route, total ms, three splits, big colours, isPB, age]
const posts = [
  ['p-petra-ecce', 'petra', 'ecce', 131470, [43800, 88100, 131470], ['purple', 'purple', 'green'], false, 2 * H],
  ['p-jan-most', 'jan', 'most', 98902, [32100, 66400, 98902], ['green', 'yellow', 'green'], true, 26 * H],
  ['p-ondra-kart', 'ondra', 'kart', 48115, [16200, 32300, 48115], ['yellow', 'green', 'yellow'], false, 60 * H],
  ['p-jan-ecce', 'jan', 'ecce', 133900, [44500, 89300, 133900], ['green', 'yellow', 'green'], false, 50 * H],
  ['p-ondra-ecce', 'ondra', 'ecce', 136210, [45100, 90800, 136210], ['yellow', 'green', 'yellow'], false, 80 * H],
  ['p-me-ecce', me, 'ecce', 134830, [44200, 89600, 134830], ['green', 'green', 'yellow'], true, 30 * H],
];

const env = await initializeTestEnvironment({ projectId: 'marek-f1-lap-timer', firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const b = writeBatch(db);
  for (const d of drivers) {
    b.set(doc(db, 'usernames', d.username), { uid: d.id });
    b.set(doc(db, 'users', d.id), {
      username: d.username, usernameLower: d.username, createdAt: serverTimestamp(), publicRouteIds: [], avatarHue: d.hue, acceptedTermsAt: serverTimestamp(),
    });
    b.set(doc(db, 'follows', `${me}_${d.id}`), { followerId: me, followeeId: d.id, createdAt: serverTimestamp() });
  }
  b.set(doc(db, 'follows', `petra_${me}`), { followerId: 'petra', followeeId: me, createdAt: serverTimestamp() });
  for (const r of routes) {
    const lngs = r.coords.filter((_, i) => i % 2 === 0);
    const lats = r.coords.filter((_, i) => i % 2 === 1);
    const s = r.lengthM / 3;
    b.set(doc(db, 'routes', r.id), {
      ownerId: 'petra', ownerName: 'petra_r', name: r.name, coords: r.coords, lengthM: r.lengthM, isLoop: r.isLoop, sectorLengthM: s,
      boundaries: [s, 2 * s, r.lengthM], startType: r.startType, isPublic: true, publishedAt: serverTimestamp(), hidden: false, hasRuns: true,
      createdAt: serverTimestamp(), start: [r.coords[0], r.coords[1]], bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      shapeVersion: 0, postCount: posts.filter((p) => p[2] === r.id).length, postCountV: 1,
    });
  }
  const profile = { stepM: 10, elapsedMs: Array.from({ length: 342 }, (_, i) => i * 393), speedDms: Array.from({ length: 342 }, (_, i) => 200 + Math.round(60 * Math.sin(i / 20))) };
  for (const [id, uid, routeId, totalMs, splits, big, isPB, age] of posts) {
    const d = drivers.find((x) => x.id === uid);
    const startedAt = now - age;
    const route = routes.find((r) => r.id === routeId);
    b.set(doc(db, 'posts', id), {
      userId: uid, username: d ? d.username : 'perf', avatarHue: d ? d.hue : 120, routeId, routeName: route.name, totalMs, splitTimesMs: splits,
      penaltyMs: 0, jumpStart: false, caption: null, car: null, createdAt: Timestamp.fromMillis(startedAt), startedAt, hidden: false, profile,
      sectorColours: [], bigColours: big, positionAtPost: id === 'p-petra-ecce' ? 1 : null, isPB,
    });
    if (uid === me)
      b.set(doc(db, 'users', me, 'runs', id), {
        routeId, shapeVersion: 0, routeName: route.name, sessionId: 'sl1', lap: 1, startedAt, totalMs, splitTimesMs: splits, penaltyMs: 0,
        jumpStart: false, jumpDistanceM: null, countdownS: 5, valid: true, gpsAvgAccuracyM: 3, gpsRateHz: 10, profile, trace: [], posted: true,
        replay: false, referenceRef: null, createdAt: serverTimestamp(),
      });
  }
  b.update(doc(db, 'users', me), { homeRouteId: 'ecce', displayName: 'Tomáš Kolář', displayNameLower: 'tomáš kolář' });
  b.set(doc(db, 'users', me, 'stats', 'routes'), { routes: { ecce: { laps: 1, last: now - 30 * H, pb: 134830, posted: 1 } } }, { merge: true });
  const n = (id, data, age) => b.set(doc(db, 'notifications', me, 'items', id), { ...data, createdAt: Timestamp.fromMillis(now - age) });
  n('beaten_p-petra-ecce', { type: 'beaten', fromId: 'petra', fromName: 'petra_r', postId: 'p-petra-ecce', theirPostId: 'p-me-ecce', routeId: 'ecce', routeName: 'Ecce Homo hill-climb', totalMs: 131470, theirMs: 134830 }, 2 * H);
  n('follow_petra', { type: 'follow', fromId: 'petra', fromName: 'petra_r' }, 3 * H);
  n('follow_jan', { type: 'follow', fromId: 'jan', fromName: 'jan.k' }, 40 * H);
  b.set(doc(db, 'notifications', me), { seenAt: Timestamp.fromMillis(now - 20 * H) });
  await b.commit();
});
console.log('seeded the Livery sample data for perf@test.dev');
process.exit(0);
