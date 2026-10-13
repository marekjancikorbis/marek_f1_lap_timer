import type { DriveConfig } from './controller';

/** Pre-drive hands its choices to the drive screen in memory (not the URL). */
let pending: DriveConfig | null = null;

export function setPendingDrive(cfg: DriveConfig) {
  pending = cfg;
}

export function takePendingDrive(routeId: string): DriveConfig | null {
  const cfg = pending && pending.route.id === routeId ? pending : null;
  return cfg;
}

export function clearPendingDrive() {
  pending = null;
}

const PREF_KEY = 'drive-prefs';

export interface DrivePrefs {
  mode: 'hud' | 'delta';
  voice: boolean;
}

export function loadPrefs(): DrivePrefs {
  try {
    return { mode: 'hud', voice: false, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return { mode: 'hud', voice: false };
  }
}

export function savePrefs(p: DrivePrefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* private mode: preferences just won't persist */
  }
}
