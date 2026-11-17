import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { goBack } from '../lib/navStack';
import { RouteMap } from '../components/RouteMap';
import { Empty, errorMessage, I, Loading, ScreenHead, Segmented, Switch, UserName, useToast } from '../components/ui';
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
  const [who, setWho] = useState<'all' | 'following'>('all');
  const [shown, setShown] = useState(5);
  const [localShown, setLocalShown] = useState(5);
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const pull = usePullSheet(sheetRef, open, setOpen);
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
  // Locals: drivers who call this route home, ranked among themselves.
  const localIds = new Set(locals.map((l) => l.id));
  const localBoard = board.filter((b) => localIds.has(b.post.userId)).map((b, i) => ({ ...b, rank: i + 1 }));
  /** Top `shown`, your row pinned under them when you are further down, then Show more. */
  const Board = ({ list, shown: n, more }: { list: typeof board; shown: number; more: () => void }) => {
    const me = list.find((b) => b.post.userId === profile.id);
    return (
      <>
        <div className="rows tight" style={{ marginTop: 4 }}>
          {list.slice(0, n).map((b) => row(b))}
          {me && list.indexOf(me) >= n && row(me, false, true)}
        </div>
        {list.length > n && (
          <button className="more" onClick={more}>
            Show more
            <I n="fwd" sm style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {!list.length && <p className="sub" style={{ padding: '10px 0' }}>Nobody you follow has a lap here yet.</p>}
      </>
    );
  };
  const row = ({ rank, post }: (typeof board)[number], peek = false, pin = false) => {
    const me = post.userId === profile.id;
    return (
      <Link
        key={post.id}
        to={`/lap/${post.id}`}
        data-peek={peek || undefined}
        className={[me ? 'me' : rank === 1 ? 'rec' : '', pin ? 'pin' : ''].join(' ').trim() || undefined}
        style={{ gridTemplateColumns: '22px 1fr auto' }}
      >
        <span className="rank">{rank}</span>
        {me ? <b>You</b> : <span className="ellipsis"><UserName uid={post.userId} fallback={post.username} /></span>}
        <span className="t t4">{formatLap(post.totalMs)}</span>
      </Link>
    );
  };
  const share = () => {
    const url = `${location.origin}/r/${route.id}`;
    if (navigator.share) navigator.share({ title: route.name, url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => undefined);
  };
  const kind = route.isLoop ? 'Lap' : route.startType[0].toUpperCase() + route.startType.slice(1);

  return (
    <main className="ph fixed route-page">
      <div className="map">
        <RouteMap route={bigRoute(route)} height="100%" extra={fitMap} />
      </div>
      <div className="edge" />
      <div className="sb" />
      <div style={{ minHeight: 52, padding: '4px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="glass ib" aria-label="Back" onClick={() => goBack(nav, '/explore')}>
          <I n="back" />
        </button>
        <button className="glass ib" aria-label="Share" onClick={share}>
          <I n="share" />
        </button>
      </div>
      <section ref={pull.ref} className={`glass sheet sheet-b rs ${open ? 'open' : ''}`} aria-label={route.name}>
        <button className="xs-pull" aria-expanded={open} aria-label={open ? 'Show less' : 'Show the whole leaderboard'} onClick={pull.onClick}>
          <span className="grab" />
        </button>
        <div className="xs-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h1 className="h1 ellipsis" style={{ fontSize: 26 }}>{route.name}</h1>
            <span className="sub" style={{ flex: 'none' }}>
              {formatDistance(route.lengthM)} · {kind}
            </span>
          </div>
          {route.isPublic ? (
            top ? (
              <>
                {!open ? (
                  <>
                    {/* Shut: the record, P2 and P3, and your place when you are further down. */}
                    <div className="k" style={{ marginTop: 14 }}>Record</div>
                    <Link to={`/lap/${top.post.id}`} data-peek={board.length < 2 || undefined} style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
                      <span className="t t2" style={{ color: 'var(--s-p)' }}>{formatLap(top.post.totalMs)}</span>
                      <span className="sub">
                        <span style={{ color: 'var(--s-p)' }}>{top.post.userId === profile.id ? 'You' : top.post.username}</span>
                        {top.post.createdAt && ` · ${formatDate(top.post.createdAt.toDate())}`}
                      </span>
                    </Link>
                    {board.length > 1 && (
                      <div className="rows" style={{ marginTop: 8 }}>
                        {board.slice(1, 3).map((b, i, xs) => row(b, i === xs.length - 1 && !(mine && mine.rank > 3)))}
                        {mine && mine.rank > 3 && row(mine, true)}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginTop: 8 }}>
                      <Segmented
                        label="Leaderboard"
                        value={who}
                        onChange={(v) => {
                          setWho(v);
                          setShown(5);
                        }}
                        options={[
                          { value: 'all', label: 'Everyone' },
                          { value: 'following', label: 'Following' },
                        ]}
                      />
                    </div>
                    <Board list={who === 'all' ? board : board.filter((b) => following.has(b.post.userId) || b.post.userId === profile.id)} shown={shown} more={() => setShown((n) => n + 10)} />
                    {localBoard.length > 0 && (
                      <>
                        <div className="between" style={{ marginTop: 22 }}>
                          <span className="k">Locals</span>
                          <span className="sub">
                            {locals.length} {locals.length === 1 ? 'driver calls' : 'drivers call'} it home
                          </span>
                        </div>
                        <Board list={localBoard} shown={localShown} more={() => setLocalShown((n) => n + 10)} />
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="sub" data-peek style={{ marginTop: 12 }}>No posted laps yet. Drive it and post yours to take P1.</p>
            )
          ) : (
            <div data-peek style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14 }}>
              <span className="t t2" style={myBest ? { color: 'var(--s-p)' } : undefined}>{myBest ? formatLap(myBest.totalMs) : '–'}</span>
              <span className="sub">{myBest ? 'Your best · private route' : 'Private route · not driven yet'}</span>
            </div>
          )}
          {(
            <>
              <div className="k" style={{ marginTop: 22 }}>This route</div>
              <div className="rows">
                <Link to={`/r/${route.id}/history`} style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <div className="h2">My laps</div>
                    <div className="sub">
                      {runs.length ? `${runs.length} ${runs.length === 1 ? 'lap' : 'laps'}${myBest ? ` · best ${formatLap(myBest.totalMs)}` : ''}` : 'Not driven yet'}
                    </div>
                  </div>
                  <I n="fwd" style={{ color: 'var(--ink-2)' }} />
                </Link>
                {route.isPublic && (
                  <div style={{ gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <div className="h2">Home course</div>
                      <div className="sub">{locals.length ? `${locals.length} ${locals.length === 1 ? 'driver calls' : 'drivers call'} it home` : 'Shown on your Home'}</div>
                    </div>
                    <Switch checked={isHome} disabled={homeBusy} onChange={() => void toggleHome()} label="Home course" />
                  </div>
                )}
                {!route.official && (
                  <Link to={`/u/${route.ownerName}`} style={{ gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <div className="h2">Built by {route.ownerName}</div>
                      <div className="sub">{route.startType === 'standing' ? 'Standing start' : 'Rolling start'}</div>
                    </div>
                    <I n="fwd" style={{ color: 'var(--ink-2)' }} />
                  </Link>
                )}
              </div>
              {(isOwner || canModChange) && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {canRename && (
                      <button className="chip" style={{ minHeight: 44 }} onClick={rename}>
                        Rename
                      </button>
                    )}
                    {(canOwnChange || canModChange) && (
                      <Link className="chip" style={{ minHeight: 44 }} to={`/r/${route.id}/edit`}>
                        Edit route
                      </Link>
                    )}
                    {(canOwnChange || canModChange) && (
                      <button className="chip" style={{ minHeight: 44, background: 'color-mix(in srgb, #ff5a5f 20%, transparent)', color: '#ff9a9d' }} onClick={remove}>
                        Delete route
                      </button>
                    )}
                  </div>
                  {isOwner && !canOwnChange && !canModChange && (
                    <p className="sub" style={{ marginTop: 8 }}>
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
      </section>
      {/* Pinned over the sheet's foot, so it stays put while the sheet slides under it. */}
      <div className="rs-foot">
        <Link className="solid" to={`/drive/${route.id}`}>
          <I n="flag" sm />
          Drive this route
        </Link>
      </div>
    </main>
  );
}
