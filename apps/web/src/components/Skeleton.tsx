import { useEffect, useState } from 'react';

const block = (w: number | string, h: number, r: number | string = 6) => (
  <i className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} />
);

/** Rows still loading, in the mockup's .rows layout: a round picture, two lines, an optional value at the end. */
export function SkeletonRows({ count = 6, pic = 36, end }: { count?: number; h?: number; pic?: number; square?: boolean; end?: boolean; rank?: boolean }) {
  return (
    <div className="rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          {block(pic, pic, '50%')}
          <span style={{ display: 'grid', gap: 6 }}>
            {block(`${70 - (i % 3) * 15}%`, 14, 4)}
            {block('35%', 12, 4)}
          </span>
          {end ? block(64, 20, 4) : <span />}
        </div>
      ))}
    </div>
  );
}

/**
 * A whole screen loading: the screen's own background straight away (so nothing flashes), and a spinner
 * only if it takes long enough to notice. Explore and the drive screen are full-screen and draw themselves.
 */
export function PageSkeleton({ path }: { path: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  const bare = path === '/explore' || /^\/drive\/[^/]+\/go/.test(path);
  return (
    <main className={bare ? 'ph fixed' : 'ph soft'} aria-busy="true">
      <span className="visually-hidden" role="status">
        Loading
      </span>
      {slow && !bare && (
        <div style={{ display: 'grid', placeItems: 'center', height: '60dvh' }}>
          <span className="spinner" aria-hidden="true" />
        </div>
      )}
    </main>
  );
}
