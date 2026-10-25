// lock() is missing from TypeScript's DOM types and only works where the browser allows it
// (installed Android apps); elsewhere the phone's own rotation setting decides.
type Lockable = ScreenOrientation & { lock?: (o: 'portrait') => Promise<void> };

/** Keep the app upright; the drive screen turns its own content from gravity. */
export function lockPortrait() {
  (screen.orientation as Lockable | undefined)?.lock?.('portrait').catch(() => {});
}

