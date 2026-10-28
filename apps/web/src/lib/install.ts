import { useEffect, useState } from 'react';

// Adding the app to the home screen. Chrome and Edge (Android, desktop) offer their own install
// dialog through `beforeinstallprompt`; iOS has none, so there we show how to do it by hand.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** How this browser can install the app, or 'installed' when it already runs from the home screen. */
export type InstallWay = 'installed' | 'prompt' | 'ios' | 'android' | 'none';

let deferred: InstallPrompt | null = null;
let installed = isStandalone();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

// The event can fire before React mounts, so this module is imported first thing in main.tsx.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it for our button instead of the browser's own banner
  deferred = e as InstallPrompt;
  changed();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  installed = true;
  changed();
});

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function currentWay(): InstallWay {
  if (installed) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  if (/Android/.test(navigator.userAgent)) return 'android';
  return 'none';
}

export function useInstall(): { way: InstallWay; install: () => Promise<boolean> } {
  const [way, setWay] = useState(currentWay);
  useEffect(() => {
    const update = () => setWay(currentWay());
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return { way, install };
}

/** Opens the browser's install dialog; true when the user accepted. A prompt can be used only once. */
async function install(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  changed();
  return outcome === 'accepted';
}
