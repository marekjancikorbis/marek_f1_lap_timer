// Seeds the local emulators with a driver who has many laps, for measuring screen loads.
// Usage (emulators running): node scripts/seed-perf.mjs [laps=200]
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const N = Number(process.argv[2] ?? 200);
const app = initializeApp({ apiKey: 'fake', projectId: 'marek-f1-lap-timer' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const email = 'perf@test.dev';
const cred = await createUserWithEmailAndPassword(auth, email, 'perfperf').catch(() => signInWithEmailAndPassword(auth, email, 'perfperf'));
const uid = cred.user.uid;
// Rules off: the seed makes a creator's route without going through role grants.
const env = await initializeTestEnvironment({ projectId: 'marek-f1-lap-timer', firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // A 3 km out-and-back near Brno.
  const coords = [];
  for (let i = 0; i <= 60; i++) coords.push(16.6 + i * 0.0006, 49.2 + Math.sin(i / 8) * 0.002);
  let b = writeBatch(db);
  b.set(doc(db, 'usernames', 'perf'), { uid });
  b.set(doc(db, 'users', uid), { username: 'perf', usernameLower: 'perf', createdAt: serverTimestamp(), publicRouteIds: [], avatarHue: 120, acceptedTermsAt: serverTimestamp() });
  b.set(doc(db, 'routes', 'perfroute'), {
    ownerId: uid, ownerName: 'perf', name: 'Perf Hill', coords, lengthM: 3000, isLoop: false, sectorLengthM: 1000, boundaries: [1000, 2000, 3000],
    startType: 'standing', isPublic: false, publishedAt: null, hidden: false, hasRuns: true, createdAt: serverTimestamp(),
    start: [coords[0], coords[1]], bbox: [16.6, 49.198, 16.636, 49.202], shapeVersion: 0,
  });
  await b.commit();

  // 120 s lap at 10 Hz: 1200 points x 5 numbers, like the real compact trace.
  const trace = [];
  for (let i = 0; i < 1200; i++) trace.push(i * 100, Math.round(i * 2.5 * 10) / 10, 25.37, 49.2 + i * 1e-6, 16.6 + i * 3e-5);
  const profile = { stepM: 10, elapsedMs: Array.from({ length: 300 }, (_, i) => i * 400), speedDms: Array.from({ length: 300 }, () => 250) };
  const now = Date.now();
  for (let i = 0; i < N; i += 20) {
    b = writeBatch(db);
    for (let j = i; j < Math.min(N, i + 20); j++) {
      b.set(doc(db, 'users', uid, 'runs', `run${String(j).padStart(4, '0')}`), {
        routeId: 'perfroute', shapeVersion: 0, routeName: 'Perf Hill', sessionId: `s${Math.floor(j / 5)}`, lap: (j % 5) + 1,
        startedAt: now - j * 3600_000, totalMs: 120000 + j * 37, splitTimesMs: [40000, 80000, 120000 + j * 37], penaltyMs: 0,
        jumpStart: false, jumpDistanceM: null, countdownS: null, valid: true, gpsAvgAccuracyM: 4, gpsRateHz: 10,
        profile, trace, posted: false, replay: false, referenceRef: null, createdAt: serverTimestamp(),
      });
  }
  await b.commit();
}
});
console.log(`seeded ${N} laps for ${email} / perfperf (uid ${uid})`);
process.exit(0);
