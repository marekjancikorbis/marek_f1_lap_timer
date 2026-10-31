import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import { useInstall } from '../lib/install';
import { Sheet, useToast } from './ui';

/**
 * "Add to home screen": the browser's own install dialog where there is one (Chrome, Edge),
 * otherwise a sheet with the steps for iOS or an Android browser without it.
 * Renders nothing once installed or where installing isn't possible.
 */
export function InstallButton({ className = 'btn block' }: { className?: string }) {
  const { way, install } = useInstall();
  const toast = useToast();
  const [help, setHelp] = useState(false);

  if (way === 'installed' || way === 'none') return null;

  async function tap() {
    if (way !== 'prompt') return setHelp(true);
    if (await install()) toast('Added to your home screen');
  }

  return (
    <>
      <button type="button" className={className} onClick={tap}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="2" width="12" height="20" rx="3" />
          <path d="M12 7v7M9 11l3 3 3-3" />
        </svg>
        Add to home screen
      </button>
      <Sheet open={help} onClose={() => setHelp(false)} label="Add to home screen">
        <div className="stack">
          <h2>Add to home screen</h2>
          <p className="mute">Purple Sector then opens full screen like an app, and keeps working with poor signal at the track.</p>
          {way === 'ios' ? (
            <ol className="install-steps">
              <li>
                Tap Share <ShareIcon /> in Safari's toolbar (in Chrome, it's in the address bar).
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong>.
              </li>
            </ol>
          ) : (
            <ol className="install-steps">
              <li>
                Open the browser menu <strong aria-label="three dots">⋮</strong>.
              </li>
              <li>
                Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </li>
            </ol>
          )}
          <p className="mute" style={{ fontSize: 14 }}>
            Don't see it? Open this page in {way === 'ios' ? 'Safari' : 'Chrome'} rather than inside another app.
          </p>
          <button type="button" className="btn primary block" onClick={() => setHelp(false)}>
            Got it
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** The newest Android app, built by CI (.github/workflows/android.yml) into a GitHub release. */
const APK_URL = 'https://github.com/marekjancikorbis/marek_f1_lap_timer/releases/latest/download/purple-sector.apk';

/** Download the Android app: shown on Android phones, but not inside the app itself. */
export function AndroidAppButton({ className = 'btn block' }: { className?: string }) {
  if (Capacitor.isNativePlatform() || !/Android/.test(navigator.userAgent)) return null;
  return (
    <a className={className} href={APK_URL}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Get the Android app
    </a>
  );
}

/** The iOS share symbol, so the step matches what's on screen. */
function ShareIcon() {
  return (
    <svg className="install-share" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="share icon">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M7 11H5v10h14V11h-2" />
    </svg>
  );
}
