import { useState } from 'react';
import { THEMES, type ThemeId } from './themes';

const KEY = 'ps-theme';
const DEFAULT: ThemeId = 'mono';

function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function storedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : DEFAULT;
  } catch {
    return DEFAULT; // private mode or blocked storage: the default theme still works
  }
}

function paint(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  // The status bar takes the colour at the very top of the page.
  const page = THEMES.find((t) => t.id === id)!.page;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
  // Open maps recolour themselves in the new palette (see mapTint).
  window.dispatchEvent(new Event('ps-theme'));
}

/** Apply a theme. With `animate`, the whole screen cross-fades into it instead of snapping. */
export function applyTheme(id: ThemeId, animate = false) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // not saved: it still applies for this visit
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && doc.startViewTransition && !still) doc.startViewTransition(() => paint(id));
  else paint(id);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  return [
    theme,
    (id: ThemeId) => {
      setTheme(id);
      applyTheme(id, true);
    },
  ] as const;
}
