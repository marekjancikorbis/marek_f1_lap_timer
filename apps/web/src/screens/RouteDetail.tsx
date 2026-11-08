import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RouteMap } from '../components/RouteMap';
import { Empty, errorMessage, I, Loading, ScreenHead, Switch, UserName, useToast } from '../components/ui';
import { usePullSheet } from '../lib/pullSheet';
import { adminDeleteRoute, deleteRoute, followingIds, getRole, getRoute, leaderboardFrom, localsOf, renameRoute, routePosts, runsForRoute, setHomeRoute } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
import { bigRecords, bigRoute, notCounted } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Profile, Role, Route, Run } from '../lib/types';

export default function RouteDetail() {
  const { routeId = '' } = useParams();
  const { profile, isCreator, isAdmin, isOwner: amSiteOwner } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [locals, setLocals] = useState<Profile[]>([]);
  const [homeBusy, setHomeBusy] = useState(false);
  const [ownerRole, setOwnerRole] = useState<Role | null>(null);
  const [tab, setTab] = useState<'board' | 'mine' | 'locals'>('board');
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const pull = usePullSheet(sheetRef, open, setOpen, () => (sheetRef.current?.parentElement?.clientHeight ?? 800) - 126);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  useEffect(() => {
    followingIds(profile.id).then((ids) => setFollowing(new Set(ids)), () => undefined);
  }, [profile.id]);
  // The map fills the screen: fit the route into the part the sheet leaves free.
  const fitMap = useCallback((m: mapboxgl.Map) => {
    const fitNow = () => {
      const r = routeRef.current;
      const h = sheetRef.current?.offsetHeight ?? 300;
      if (r) m.fitBounds(r.bbox, { padding: { top: 130, bottom: h + 40, left: 40, right: 40 }, duration: 0, maxZoom: 15 });
    };
    fitNow();
    m.once('idle', fitNow);
  }, []);
  const routeRef = useRef<Route | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getRoute(routeId);
      if (!alive) return;
      setRoute(r);
      routeRef.current = r;
      if (!r) return;
      const [p, mine, loc] = await Promise.all([
        r.isPublic ? routePosts(r.id).catch(() => []) : Promise.resolve([] as Post[]),
        runsForRoute(profile.id, r.id).catch(() => []),
        r.isPublic ? localsOf(r.id).catch(() => []) : Promise.resolve([] as Profile[]),
      ]);
      if (!alive) return;
      setPosts(p);
      setRuns(mine);
      setLocals(loc);
    })();
    return () => {
      alive = false;
    };
  }, [routeId, profile.id]);

  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const records = useMemo(() => (route ? bigRecords(posts, route) : []), [posts, route]);
  const myBest = useMemo(() => runs.filter((r) => r.valid).sort((a, b) => a.totalMs - b.totalMs)[0], [runs]);
  const isOwner = route?.ownerId === profile.id;
  // Mirrors the rules: owners edit and delete routes that were never published.
  const canOwnChange = isOwner && !!route && !route.isPublic && !route.publishedAt;
  // A published route can be renamed only while its owner may publish; losing creator access locks it.
  const canRename = canOwnChange || (isOwner && isCreator);
  // Mirrors the moderation rules: admins reach driver and creator routes, the site owner reaches all.
  const canModChange = isAdmin && (amSiteOwner || (ownerRole !== null && ownerRole !== 'admin' && ownerRole !== 'owner'));

  useEffect(() => {
    if (isAdmin && !amSiteOwner && route) getRole(route.ownerId).then(setOwnerRole);
  }, [isAdmin, amSiteOwner, route?.ownerId]);

  const isHome = profile.homeRouteId === route?.id;

  async function toggleHome() {
    if (!route) return;
    setHomeBusy(true);
    try {
      await setHomeRoute(profile.id, isHome ? null : route.id);
      // The profile updates live; keep the locals list in step without refetching.
      // Replace rather than append: the initial load may already include this change.
      setLocals((ls) => {
        const others = ls.filter((l) => l.id !== profile.id);
        return isHome ? others : [...others, { ...profile, homeRouteId: route.id }].sort((a, b) => a.username.localeCompare(b.username));
      });
      toast(isHome ? 'Home course removed' : `${route.name} is your home course`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setHomeBusy(false);
    }
  }

  async function rename() {
    if (!route) return;
    const name = prompt('Route name', route.name)?.trim();
    if (!name || name === route.name) return;
    try {
      await renameRoute(route.id, name);
      setRoute({ ...route, name });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!route) return;
    if (!confirm(`Delete “${route.name}”${canOwnChange ? (runs.length ? ' and your laps on it' : '') : ' and all its posted laps'}? This can't be undone.`)) return;
    try {
      await (canOwnChange ? deleteRoute(profile.id, route.id) : adminDeleteRoute(profile, route));
      toast('Route deleted');
      nav(isOwner ? '/routes' : '/', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (route === undefined) return <Loading />;
  if (route === null)
    return (
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back />
        <Empty title="Route not available">It&rsquo;s private, was unpublished, or has been removed.</Empty>
      </main>
    );

  const top = board[0];
  const mine = board.find((b) => b.post.userId === profile.id);
  // Collapsed: P2, P3 and you. Pulled up: the whole board, then the drivers you follow.
  const shortBoard = board.slice(1, 3).concat(mine && mine.rank > 3 ? [mine] : []);
  const followed = board.filter((b) => following.has(b.post.userId));
  const row = ({ rank, post }: (typeof board)[number]) => {
    const me = post.userId === profile.id;
    return (
      <Link key={post.id} to={`/lap/${post.id}`} style={{ gridTemplateColumns: '20px 1fr auto', ...(me ? { color: 'var(--main-hi)' } : null) }}>
        <span className="lbl" style={me ? { color: 'inherit' } : undefined}>{rank}</span>
        {me ? <b>You</b> : <span className="ellipsis"><UserName uid={post.userId} fallback={post.username} /></span>}
        <span className="t" style={{ fontSize: 19 }}>{formatLap(post.totalMs)}</span>
      </Link>
    );
  };
  const share = () => {
    const url = `${location.origin}/r/${route.id}`;
    if (navigator.share) navigator.share({ title: route.name, url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => undefined);
  };
  const kind = route.isLoop ? 'lap' : route.startType;

  return (
    <main className="ph fixed route-page">
      <div className="map">
        <RouteMap route={bigRoute(route)} height="100%" extra={fitMap} />
      </div>
      <div className="edge" />
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between' }}>
        <button className="glass ib" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/explore'))}>
          <I n="back" />
        </button>
        <button className="glass ib" aria-label="Share" onClick={share}>
          <I n="share" />
        </button>
      </div>
      <section ref={sheetRef} className={`glass sheet sheet-b rs ${open ? 'open' : ''}`} aria-label={route.name}>
        <button className="xs-pull" aria-expanded={open} aria-label={open ? 'Show less' : 'Show the whole leaderboard'} {...pull} onPointerCancel={pull.onPointerUp}>
          <span className="grab" />
        </button>
        <div className="xs-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h1 className="ellipsis" style={{ fontSize: 22, letterSpacing: '-.02em', fontWeight: 700 }}>{route.name}</h1>
            <span className="lbl" style={{ flex: 'none' }}>
              {formatDistance(route.lengthM)} · {kind}
            </span>
          </div>
          {route.isPublic ? (
            top ? (
              <>
                <Link to={`/lap/${top.post.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: open ? 12 : 14 }}>
                  <span className="t acc" style={{ fontSize: open ? 44 : 52 }}>{formatLap(top.post.totalMs)}</span>
                  <span className="lbl">{top.post.userId === profile.id ? 'You' : top.post.username}</span>
                </Link>
                {open && <div className="lbl" style={{ marginTop: 14 }}>Leaderboard</div>}
                <div className="rows" style={{ marginTop: open ? 0 : 10 }}>{(open ? board.slice(1) : shortBoard).map(row)}</div>
                {open && followed.length > 0 && (
                  <>
                    <div className="lbl" style={{ marginTop: 14 }}>Following</div>
                    <div className="rows">{followed.map(row)}</div>
                  </>
                )}
              </>
            ) : (
              <p className="lbl" style={{ marginTop: 12 }}>No posted laps yet. Drive it and post yours to take P1.</p>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14 }}>
              <span className="t acc" style={{ fontSize: 52 }}>{myBest ? formatLap(myBest.totalMs) : '–'}</span>
              <span className="lbl">{myBest ? 'Your best · private route' : 'Private route · not driven yet'}</span>
            </div>
          )}
          {open && (
            <>
              <div className="lbl" style={{ marginTop: 14 }}>This route</div>
              <div className="rows">
                <Link to={`/r/${route.id}/history`} style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <b>My laps</b>
                    <div className="lbl">
                      {runs.length ? `${runs.length} ${runs.length === 1 ? 'lap' : 'laps'}${myBest ? ` · best ${formatLap(myBest.totalMs)}` : ''}` : 'Not driven yet'}
                    </div>
                  </div>
                  <I n="fwd" style={{ color: 'var(--ink-2)' }} />
                </Link>
                {route.isPublic && (
                  <div style={{ gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <b>Home course</b>
                      <div className="lbl">{locals.length ? `${locals.length} ${locals.length === 1 ? 'driver calls' : 'drivers call'} it home` : 'Shown on your Home'}</div>
                    </div>
                    <Switch checked={isHome} disabled={homeBusy} onChange={() => void toggleHome()} label="Home course" />
                  </div>
                )}
                {!route.official && (
                  <Link to={`/u/${route.ownerName}`} style={{ gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <b>Built by {route.ownerName}</b>
                      <div className="lbl">{route.startType === 'standing' ? 'Standing start' : 'Rolling start'}</div>
                    </div>
                    <I n="fwd" style={{ color: 'var(--ink-2)' }} />
                  </Link>
                )}
              </div>
              {(isOwner || canModChange) && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {canRename && (
                      <button className="chip" style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }} onClick={rename}>
                        Rename
                      </button>
                    )}
                    {(canOwnChange || canModChange) && (
                      <Link className="chip" style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }} to={`/r/${route.id}/edit`}>
                        Edit route
                      </Link>
                    )}
                    {(canOwnChange || canModChange) && (
                      <button className="chip" style={{ background: 'color-mix(in srgb, #ff5a5f 20%, transparent)', color: '#ff9a9d' }} onClick={remove}>
                        Delete route
                      </button>
                    )}
                  </div>
                  {isOwner && !canOwnChange && !canModChange && (
                    <p className="lbl" style={{ marginTop: 8 }}>
                      {canRename
                        ? 'The shape and sectors are locked because this route has been published, so other drivers may have laps on it.'
                        : 'This route has been published and you no longer have creator access, so it is locked.'}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <Link className="solid" style={{ marginTop: 12, flex: 'none' }} to={`/drive/${route.id}`}>
          Drive
        </Link>
      </section>
    </main>
  );
}
