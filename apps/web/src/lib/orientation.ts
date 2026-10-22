// lock() is missing from TypeScript's DOM types and only works where the browser allows it
// (installed Android apps); elsewhere the phone's own rotation setting decides.
type Lockable = ScreenOrientation & { lock?: (o: 'portrait') => Promise<void> };

/** Keep the app upright, except where a screen unlocks it. */
export function lockPortrait() {
  (screen.orientation as Lockable | undefined)?.lock?.('portrait').catch(() => {});
}

export function unlockOrientation() {
  try {
    screen.orientation?.unlock();
  } catch {
    // Not supported: nothing was locked.
  }
}
