import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate, useNavigationType, type NavigateFunction } from 'react-router-dom';

/**
 * The app's own view of the history stack. Two detail screens that link to each other (a lap and its route,
 * a lap and its driver) used to stack up endlessly, so Back bounced between them. Now a link to a screen that
 * is already further down the stack goes back to it instead of pushing a copy, like popping to it in a native
 * navigation stack, and Back from the first screen of a visit goes to the given parent instead of leaving.
 */
const entries: { key: string; path: string }[] = [];
let index = -1;

export function NavTracker() {
  const loc = useLocation();
  const type = useNavigationType();
  // Before paint, so the new screen's entrance already knows its direction.
  useLayoutEffect(() => {
    const at = entries.findIndex((e) => e.key === loc.key);
    // Which way the new screen arrives from (tiles.css): forward slides in from the right, back from the left.
    document.documentElement.dataset.nav = type === 'POP' && at >= 0 && at < index ? 'back' : type === 'REPLACE' ? 'swap' : 'forward';
    if (type === 'POP' && at >= 0) index = at;
    else if (type === 'REPLACE' && index >= 0) entries[index] = { key: loc.key, path: loc.pathname };
    else {
      entries.splice(index + 1, entries.length, { key: loc.key, path: loc.pathname });
      index = entries.length - 1;
    }
  }, [loc.key, loc.pathname, type]);

  // Any in-app link to a screen already below this one: go back down to it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target || a.origin !== location.origin) return;
      const steps = stepsBackTo(a.pathname);
      if (steps > 0 && !a.search) {
        e.preventDefault();
        e.stopPropagation();
        history.go(-steps);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}

/** How many steps back the nearest earlier visit to this path is, or 0 when it isn't below the current screen. */
function stepsBackTo(path: string) {
  for (let i = index - 1; i >= 0; i--) if (entries[i].path === path) return index - i;
  return 0;
}

/** Back: the previous screen of this visit, else (opened from a link or after a reload) the screen's parent. */
export function goBack(nav: NavigateFunction, parent = '/') {
  if (index > 0) nav(-1);
  else nav(parent, { replace: true });
}

export function useBack(parent = '/') {
  const nav = useNavigate();
  return () => goBack(nav, parent);
}
