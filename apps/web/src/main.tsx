import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lockPortrait } from './lib/orientation';
import './styles/global.css';
import './styles/screens.css';

// Deploys install in the background, but an open app keeps running the old code
// until it reloads. Reload as soon as the new version takes over, except
// mid-drive (that would end the run): then wait until the drive screen is left.
if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // first install, not an update
      return;
    }
    const reloadWhenSafe = () => {
      if (/\/drive\/[^/]+\/go/.test(location.pathname)) window.setTimeout(reloadWhenSafe, 5000);
      else location.reload();
    };
    reloadWhenSafe();
  });
  // An installed app can sit in the background for days: look for a new version when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void navigator.serviceWorker.getRegistration().then((r) => r?.update());
  });
}

lockPortrait();
// iOS ignores user-scalable=no: block its pinch-zoom of the page (maps still pinch, they use touch events).
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
