import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { FIREBASE_CONFIG } from './config';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// Offline-first: reads come from the local cache when there is no signal and
// writes (finished runs) queue until the phone is back online.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

// Local testing against `firebase emulators:start`: run the dev server with VITE_EMULATORS=1.
if (import.meta.env.VITE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
