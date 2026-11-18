import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RouteGlyph } from '../components/RouteShape';
import { Avatar, errorMessage, I, Spinner, useToast } from '../components/ui';
import { dayKey, feedPage, followingIds, forget, getActivity, getRoute, getRoutes, routePosts, routeStats, unreadNotices, type FeedPage } from '../lib/data';
import { db } from '../lib/firebase';
import { formatDelta, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { Post, Route } from '../lib/types';

/**
 * Who has seen the Feed this session. The first time, it shows the phone's copy at once
 * (an app start needs no network wait) and then reloads it from the server.
 */
const opened = new Set<string>();

export function Feed() {
  const { profile } = useMe();
  const toast = useToast();
  const [follows, setFollows] = useState<string[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<FeedPage['cursor']>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map());
  const [pbs, setPbs] = useState<Record<string, number | null>>({});
  const [home, setHome] = useState<{ route: Route; pb: number | null; record: number | null; holder: string | null } | null>(null);
  const [days, setDays] = useState<Record<string, number>>({});
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
    if (opened.has(profile.id)) void loadFirst();
    else {
      opened.add(profile.id);
      void loadFirst().then(() => loadFirst(true));
    }
    const homeId = profile.homeRouteId;
    Promise.all([routeStats(profile.id), homeId ? getRoute(homeId) : null, homeId ? routePosts(homeId, 1).catch(() => []) : []])
      .then(([stats, route, top]) => {
        setPbs(Object.fromEntries(Object.entries(stats).map(([id, st]) => [id, st.pb])));
        setHome(
          route && route.isPublic && !route.hidden
            ? { route, pb: homeId ? (stats[homeId]?.pb ?? null) : null, record: top[0]?.totalMs ?? null, holder: top[0]?.username ?? null }
            : null,
        );
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

  useEffect(() => {
    getActivity(profile.id).then((a) => a && setDays(a.days), () => undefined);
  }, [profile.id]);
  // This week, Monday first: laps per day, today in the action colour.
  const week = (() => {
    const now = new Date();
    const today = (now.getDay() + 6) % 7;
    const list = Array.from({ length: 7 }, (_, d) => {
      const day = new Date(now);
      day.setDate(now.getDate() - today + d);
      return Math.max(0, days[dayKey(day.getTime())] ?? 0);
    });
    return { days: list, today, total: list.reduce((a, b) => a + b, 0), max: Math.max(1, ...list) };
  })();

  const [unread, setUnread] = useState(0);
  useEffect(() => {
    unreadNotices(profile.id).then(setUnread, () => undefined);
  }, [profile.id]);

  return (
    <main className="ph sl docked">
      <div className="sb" />
      <div className="top-r">
        <div>
          <h1 className="wm">Purple Sector</h1>
        </div>
        <Link to="/notifications" className={`glass ib${unread ? ' ndot' : ''}`} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
          <I n="bell" />
        </Link>
      </div>
      <div className="bento">
        {home ? (
          <div className="glass hot tl w2" style={{ padding: '18px 18px 16px' }}>
            <div className="between">
              <span className="k ellipsis">Home course · {home.route.name}</span>
              <span className="k" style={{ flex: 'none' }}>Your best</span>
            </div>
            <div className={`t ${home.pb != null ? 't1' : 't2'}`} style={{ marginTop: 12, position: 'relative', zIndex: 1, ...(home.pb != null ? { fontSize: 'min(84px, 18vw)' } : null) }}>
              {home.pb != null ? formatLap(home.pb) : 'Not driven'}
            </div>
            {home.pb != null && home.record != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <span className="dl">{formatDelta(home.pb - home.record)}</span>
                <span className="sub" style={{ color: 'inherit', opacity: 0.8 }}>to the record</span>
              </div>
            )}
            <Link
              to={`/r/${home.route.id}`}
              aria-label={`${home.route.name}, route`}
              style={{ position: 'absolute', right: 24, top: 50, width: 78, height: 122, display: 'grid', placeItems: 'center', color: 'var(--on-go)', opacity: 0.9 }}
            >
              <RouteGlyph route={home.route} strokeWidth={56} style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </Link>
            <Link className="solid inv" style={{ marginTop: 16 }} to={`/drive/${home.route.id}`}>
              <I n="flag" sm />
              Drive
            </Link>
          </div>
        ) : (
          <div className="glass hot tl w2" style={{ padding: '18px 18px 16px' }}>
            <div className="k">Your home course</div>
            <div className="h1" style={{ marginTop: 12 }}>Pick the route you drive most</div>
            <Link className="solid inv" style={{ marginTop: 16 }} to="/explore">
              Find a route
            </Link>
          </div>
        )}
        <Link className="glass tl" to={home ? `/r/${home.route.id}` : '/explore'}>
          <div className="k">Record</div>
          <div className="t t3" style={{ marginTop: 12 }}>{home?.record != null ? formatLap(home.record) : '–'}</div>
          <div className="sub ellipsis" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            {home?.holder && <I n="trophy" size={15} />}
            {home?.holder ?? (home ? 'No laps yet' : 'No route')}
          </div>
        </Link>
        <Link className="glass tl" to="/routes">
          <div className="between" style={{ whiteSpace: 'nowrap' }}>
            <span className="k">Week</span>
            <span className="k" style={{ color: 'var(--ink)' }}>
              {week.total} {week.total === 1 ? 'lap' : 'laps'}
            </span>
          </div>
          <div className="week" aria-label="Laps per day this week">
            {week.days.map((n, d) => (
              <i key={d} className={d === week.today ? 'now' : undefined} style={{ height: `${(n / week.max) * 100}%` }} />
            ))}
          </div>
          <div className="days" aria-hidden="true">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, d) => (
              <span key={d} style={d === week.today ? { color: 'var(--ink)' } : undefined}>{l}</span>
            ))}
          </div>
        </Link>
        {newCount > 0 && (
          <button className="glass tl w2" style={{ textAlign: 'center', padding: 12 }} onClick={() => void loadFirst(true)}>
            <span className="k">
              {newCount} new {newCount === 1 ? 'lap' : 'laps'} ↑
            </span>
          </button>
        )}
        {error && (
          <p className="glass tl w2 err" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <>
            <div className="glass tl w2 skeleton" style={{ height: 150 }} />
            <div className="glass tl w2 skeleton" style={{ height: 150 }} />
          </>
        ) : follows && follows.length === 0 ? (
          <div className="glass tl w2">
            <div className="k">Following</div>
            <p className="sub" style={{ marginTop: 8, color: 'var(--ink)' }}>Follow drivers and their posted laps show up here, ready to race against.</p>
            <Link className="solid" style={{ height: 46, marginTop: 12 }} to="/explore">
              Find drivers
            </Link>
          </div>
        ) : !posts.length ? (
          <div className="glass tl w2">
            <div className="k">Following</div>
            <p className="sub" style={{ marginTop: 8, color: 'var(--ink)' }}>The drivers you follow haven&rsquo;t posted a lap yet. New laps show up here, newest first.</p>
          </div>
        ) : (
          <>
            {posts.map((p) => {
              const route = routes.get(p.routeId);
              const mine = pbs[p.routeId];
              const gap = mine != null && p.userId !== profile.id ? mine - p.totalMs : null;
              return (
                <div key={p.id} className="glass tl w2" style={{ padding: '14px 16px' }}>
                  <div style={{ position: 'relative', minWidth: 0, paddingRight: route ? 86 : 0 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 12, alignItems: 'center' }}>
                      <Link to={`/u/${p.username}`} aria-label={p.username}>
                        <Avatar name={p.username} hue={p.avatarHue} uid={p.userId} size={40} />
                      </Link>
                      <div style={{ minWidth: 0 }}>
                        <div className="sub ellipsis">
                          {p.username} · {dayMonth(p.createdAt?.toDate() ?? new Date(p.startedAt))}
                        </div>
                        <div className="sub ellipsis" style={{ fontSize: 13, marginTop: 2 }}>{p.routeName}</div>
                      </div>
                    </div>
                    <Link
                      to={`/lap/${p.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}
                      aria-label={`${p.username}, ${p.routeName}, ${formatLap(p.totalMs)}`}
                    >
                      <span className="t t3">{formatLap(p.totalMs)}</span>
                      {gap != null && <span className={`dl ${gap > 0 ? 'loss' : 'gain'}`}>{formatDelta(gap)}</span>}
                    </Link>
                    {p.caption && (
                      <p className="sub" style={{ marginTop: 10, color: 'var(--ink)' }}>
                        {p.caption}
                      </p>
                    )}
                    {route && (
                      <Link to={`/r/${p.routeId}`} className="thumb" aria-label={`${p.routeName}, route`}>
                        <RouteGlyph route={route} strokeWidth={36} style={{ width: '100%', height: '74%' }} />
                      </Link>
                    )}
                  </div>
                  <Link className="solid" style={{ height: 46, marginTop: 12 }} to={`/drive/${p.routeId}?ref=post:${p.id}`}>
                    <I n="flag" sm />
                    Race
                  </Link>
                </div>
              );
            })}
            <div ref={sentinel} className="w2" style={{ minHeight: 48, display: 'grid', placeItems: 'center' }}>
              {loadingMore ? <Spinner /> : !cursor && <span className="k">You&rsquo;re all caught up</span>}
            </div>
          </>
        )}
      </div>
      <div className="foot-fade" />
    </main>
  );
}

/** 9 Nov */
function dayMonth(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
