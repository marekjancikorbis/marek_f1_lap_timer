import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeCourse } from '../components/HomeCourse';
import { LapCard } from '../components/LapCard';
import { Avatar, Empty, errorMessage, Spinner, useToast } from '../components/ui';
import { allMyRuns, feedPage, follow, followingIds, forget, getRoute, getRoutes, type FeedPage } from '../lib/data';
import { db } from '../lib/firebase';
import { useMe } from '../lib/session';
import type { Post, Route } from '../lib/types';

export function Feed() {
  const { profile } = useMe();
  const toast = useToast();
  const [follows, setFollows] = useState<string[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<FeedPage['cursor']>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map());
  const [driven, setDriven] = useState<Set<string>>(new Set());
  const [home, setHome] = useState<{ route: Route; pb: number | null } | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadRoutes = useCallback(async (list: Post[]) => {
    const missing = list.map((p) => p.routeId).filter((id) => !routes.has(id));
    if (!missing.length) return;
    const got = await getRoutes(missing);
    setRoutes((prev) => new Map([...prev, ...got]));
  }, [routes]);

  /** fresh: skip the session cache (pull to refresh, the new-laps pill). */
  const loadFirst = useCallback(async (fresh = false) => {
    if (fresh) forget('follow', 'feed');
    setError(null);
    try {
      const ids = await followingIds(profile.id);
      setFollows(ids);
      const page = await feedPage(ids, null);
      setPosts(page.posts);
      setCursor(page.cursor);
      setNewCount(0);
      void loadRoutes(page.posts);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => {
    void loadFirst();
    const homeId = profile.homeRouteId;
    Promise.all([allMyRuns(profile.id), homeId ? getRoute(homeId) : null])
      .then(([runs, route]) => {
        setDriven(new Set(runs.map((r) => r.routeId)));
        const best = runs.filter((r) => r.valid && r.routeId === homeId).reduce<number | null>((m, r) => (m == null || r.totalMs < m ? r.totalMs : m), null);
        setHome(route && route.isPublic && !route.hidden ? { route, pb: best } : null);
      })
      .catch(() => undefined);
  }, [loadFirst, profile.id, profile.homeRouteId]);

  // Live "new laps" pill: watch for posts newer than the top of the feed.
  const newest = posts[0]?.createdAt;
  useEffect(() => {
    if (!follows?.length || !newest) return;
    const q = query(
      collection(db, 'posts'),
      where('userId', 'in', follows.slice(0, 30)),
      where('hidden', '==', false),
      where('createdAt', '>', newest),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) => setNewCount(snap.size),
      () => undefined,
    );
  }, [follows, newest]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || !follows) return;
    setLoadingMore(true);
    try {
      const page = await feedPage(follows, cursor);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.cursor);
      void loadRoutes(page.posts);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, follows, loadingMore, loadRoutes, toast]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && void loadMore(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  usePullToRefresh(() => loadFirst(true));

  return (
    <main className="screen feed">
      <header className="screen-head">
        <h1 className="wordmark small">
          Purple <span>Sector</span>
        </h1>
        <Link to="/me" aria-label="Your profile">
          <Avatar name={profile.username} hue={profile.avatarHue} size={36} />
        </Link>
      </header>

      {newCount > 0 && (
        <button className="new-pill" onClick={() => void loadFirst(true)}>
          {newCount} new {newCount === 1 ? 'lap' : 'laps'} ↑
        </button>
      )}

      {error && <p className="notice error">{error}</p>}

      {home && <HomeCourse route={home.route} pb={home.pb} />}
      {home && <h2 className="section-title">Following</h2>}

      {loading ? (
        <div className="stack">
          <div className="skeleton" style={{ height: 300 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      ) : follows && follows.length === 0 ? (
        <FeedEmpty onFollowed={loadFirst} />
      ) : posts.length === 0 ? (
        <Empty title="No laps yet" action={<Link className="btn" to="/explore">Find more drivers</Link>}>
          The drivers you follow haven't posted a lap yet. New posts show up here, newest first.
        </Empty>
      ) : (
        <div className="stack-lg">
          {posts.map((p) => (
            <LapCard key={p.id} post={p} route={routes.get(p.routeId)} canCompare={driven.has(p.routeId)} />
          ))}
          <div ref={sentinel} className="center-fill" style={{ minHeight: 80 }}>
            {loadingMore ? <Spinner /> : !cursor && <span className="mute">You're all caught up.</span>}
          </div>
        </div>
      )}
    </main>
  );
}

/** Not following anyone: offer search and the drivers currently leading public routes. */
function FeedEmpty({ onFollowed }: { onFollowed: () => void }) {
  const { profile } = useMe();
  const toast = useToast();
  const [suggested, setSuggested] = useState<{ id: string; username: string; hue?: number; note: string }[] | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Leaders: the fastest recent posted lap per route, then their authors.
    getDocs(query(collection(db, 'posts'), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(100)))
      .then((snap) => {
        const byRoute = new Map<string, Post>();
        snap.docs.forEach((d) => {
          const p = { id: d.id, ...d.data() } as Post;
          const cur = byRoute.get(p.routeId);
          if (!cur || p.totalMs < cur.totalMs) byRoute.set(p.routeId, p);
        });
        const seen = new Set<string>([profile.id]);
        const out: { id: string; username: string; hue?: number; note: string }[] = [];
        for (const p of byRoute.values()) {
          if (seen.has(p.userId)) continue;
          seen.add(p.userId);
          out.push({ id: p.userId, username: p.username, hue: p.avatarHue, note: `Leads ${p.routeName}` });
        }
        setSuggested(out.slice(0, 8));
      })
      .catch(() => setSuggested([]));
  }, [profile.id]);

  async function doFollow(id: string) {
    try {
      await follow(profile.id, id);
      setFollowed((s) => new Set(s).add(id));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div>
      <Empty title="Follow some drivers" action={<Link className="btn primary lg" to="/explore">Find drivers</Link>}>
        Your feed shows laps posted by people you follow, newest at the top.
      </Empty>
      {suggested && suggested.length > 0 && (
        <>
          <h2 className="section-title">Leading public routes</h2>
          <div className="list">
            {suggested.map((s) => (
              <div key={s.id} className="list-item">
                <Link to={`/u/${s.username}`} className="row grow" style={{ textDecoration: 'none', gap: 12 }}>
                  <Avatar name={s.username} hue={s.hue} />
                  <span className="grow">
                    <strong>{s.username}</strong>
                    <br />
                    <span className="mute" style={{ fontSize: 14 }}>
                      {s.note}
                    </span>
                  </span>
                </Link>
                {followed.has(s.id) ? (
                  <span className="badge outline">Following</span>
                ) : (
                  <button className="btn sm primary" onClick={() => doFollow(s.id)}>
                    Follow
                  </button>
                )}
              </div>
            ))}
          </div>
          {followed.size > 0 && (
            <button className="btn block" style={{ marginTop: 16 }} onClick={onFollowed}>
              Show my feed
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Minimal pull-to-refresh at the top of the page. */
function usePullToRefresh(refresh: () => Promise<void> | void) {
  useEffect(() => {
    let startY: number | null = null;
    let pulled = 0;
    const indicator = document.createElement('div');
    indicator.className = 'ptr';
    document.body.appendChild(indicator);
    const onStart = (e: TouchEvent) => {
      startY = window.scrollY <= 0 ? e.touches[0].clientY : null;
      pulled = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      pulled = Math.max(0, e.touches[0].clientY - startY);
      // Rubber-band: the further you pull, the less it follows.
      const shown = (pulled * 80 * 0.55) / (80 + 0.55 * pulled);
      indicator.style.transform = `translate(-50%, ${shown}px)`;
      indicator.style.opacity = String(Math.min(1, pulled / 90));
    };
    const onEnd = async () => {
      if (startY == null) return;
      startY = null;
      indicator.style.transition = 'transform 300ms var(--ease-out), opacity 300ms';
      if (pulled > 90) {
        indicator.classList.add('spinning');
        await refresh();
        indicator.classList.remove('spinning');
      }
      indicator.style.transform = 'translate(-50%, 0)';
      indicator.style.opacity = '0';
      window.setTimeout(() => (indicator.style.transition = ''), 300);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      indicator.remove();
    };
  }, [refresh]);
}
