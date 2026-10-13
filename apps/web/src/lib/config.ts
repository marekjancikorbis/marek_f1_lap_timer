export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBbPa-6GkJKEDadreaNRpT6iTSvprPmIFk',
  authDomain: 'marek-f1-lap-timer.firebaseapp.com',
  projectId: 'marek-f1-lap-timer',
  storageBucket: 'marek-f1-lap-timer.firebasestorage.app',
  messagingSenderId: '261253288488',
  appId: '1:261253288488:web:e55b27ea1871ebbb299b1d',
};

/** Public Mapbox token. Restrict it to the app's URL in the Mapbox dashboard. */
export const MAPBOX_TOKEN =
  'pk.eyJ1IjoibWFyZWtqYW5jaWsiLCJhIjoiY212NzM2djUzMDA1NDJ5c2gxaXJ5ODVpZCJ9.kmqLJARRI2la9K-hMZ1DVg';

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/dark-v11';

/**
 * Mapbox usage cap, just under the free tier. Keep in sync with
 * firestore.rules (usage/{period}).
 */
export const USAGE_CAP = {
  mapLoads: 45_000,
  directions: 90_000,
};

/** Day of the month (UTC) on which the usage period resets. */
export const USAGE_RESET_DAY = 1;

export const JUMP_START_PENALTY_MS = 5000;
export const DEFAULT_COUNTDOWN_S = 5;
