import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { FIREBASE_CONFIG } from './config';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// Offline-first: reads come from the local cache when there is no signal and
// writes (finished runs) queue until the phone is back online.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});
