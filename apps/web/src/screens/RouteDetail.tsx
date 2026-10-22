import { Play, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RouteMap } from '../components/RouteMap';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, Segmented, useToast } from '../components/ui';
import { adminDeleteRoute, deleteRoute, getRole, getRoute, leaderboardFrom, localsOf, renameRoute, routePosts, runsForRoute, setHomeRoute } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
import { bigRecords, bigRoute } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Profile, Role, Route, Run } from '../lib/types';

export default function RouteDetail() {
  const { routeId = '' } = useParams();
  const { profile, isAdmin, isOwner: amSiteOwner } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [locals, setLocals] = useState<Profile[]>([]);
  const [homeBusy, setHomeBusy] = useState(false);
  const [ownerRole, setOwnerRole] = useState<Role | null>(null);
  const [tab, setTab] = useState<'board' | 'mine' | 'locals'>('board');

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getRoute(routeId);
      if (!alive) return;
      setRoute(r);
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
      await (canOwnChange ? deleteRoute(profile.id, route.id) : adminDeleteRoute(route.id));
      toast('Route deleted');
      nav(isOwner ? '/times' : '/', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (route === undefined) return <Loading />;
  if (route === null)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Route not available">It's private, was unpublished, or has been removed.</Empty>
      </main>
    );

  const tabs = [
    ...(route.isPublic ? [{ value: 'board' as const, label: 'Leaderboard' }] : []),
    { value: 'mine' as const, label: `My laps${runs.length ? ` · ${runs.length}` : ''}` },
    ...(route.isPublic ? [{ value: 'locals' as const, label: 'Locals' }] : []),
  ];
  const shownTab = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  const recent = [...runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);

  return (
    <main className="screen with-cta">
      <section className="route-hero">
        <RouteMap route={bigRoute(route)} height={270} />
        <div className="route-hero-top">
          <ScreenHead back />
        </div>
        <div className="route-hero-over">
          <h1>{route.name}</h1>
          <p className="row wrap" style={{ gap: 6 }}>
            {route.official ? (
              <span className="badge purple">Official</span>
            ) : (
              <Link to={`/u/${route.ownerName}`} className="badge outline route-hero-by">
                by {route.ownerName}
              </Link>
            )}
            <span className="badge outline">{formatDistance(route.lengthM)}</span>
            <span className="badge outline">{route.startType === 'standing' ? 'Standing start' : 'Rolling start'}</span>
            <span className="badge outline">{route.isLoop ? 'Lap' : 'A to B'}</span>
            {!route.isPublic && <span className="badge outline">Private</span>}
          </p>
        </div>
      </section>

      {route.isPublic && (
        <button className={`btn block ${isHome ? '' : 'ghost'} home-toggle`} disabled={homeBusy} onClick={toggleHome} aria-pressed={isHome}>
          <Star size={17} fill={isHome ? 'currentColor' : 'none'} aria-hidden="true" />
          {isHome ? 'Your home course · remove' : 'Set as my home course'}
        </button>
      )}

      {tabs.length > 1 && <Segmented label="Show" value={shownTab} onChange={setTab} options={tabs} />}

      {shownTab === 'board' &&
        (board.length === 0 ? (
          <p className="mute route-empty">No posted laps yet. Drive it and post yours to take P1.</p>
        ) : (
          <>
            <div className="records" aria-label="Sector records">
              {records.map((r, i) => (
                <div key={i} className="record">
                  <span>S{i + 1} record</span>
                  <strong className="num">{r == null ? '–' : formatLap(r)}</strong>
                </div>
              ))}
            </div>
            <ol className="list board">
              {board.map(({ rank, post }) => (
                <li key={post.id} className={`board-row ${post.userId === profile.id ? 'me' : ''}`}>
                  <span className={`board-pos num ${rank === 1 ? 'p1' : ''}`}>{rank}</span>
                  <Link to={`/u/${post.username}`} className="row grow" style={{ gap: 10, textDecoration: 'none', minWidth: 0 }}>
                    <Avatar name={post.username} hue={post.avatarHue} size={32} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <strong className="ellipsis">{post.userId === profile.id ? 'You' : post.username}</strong>
                      {post.car && <span className="mute ellipsis small-text">{post.car}</span>}
                    </span>
                  </Link>
                  <Link to={`/lap/${post.id}`} className={`board-time num ${rank === 1 ? 'fastest' : ''}`}>
                    {formatLap(post.totalMs)}
                    {rank > 1 && <small>+{((post.totalMs - board[0].post.totalMs) / 1000).toFixed(3)}</small>}
                  </Link>
                  {post.userId !== profile.id && (
                    <div className="board-actions">
                      {runs.length > 0 && (
                        <Link className="btn sm" to={`/compare/${route.id}?a=best&b=post:${post.id}`}>
                          Compare
                        </Link>
                      )}
                      <Link className="btn sm primary" to={`/drive/${route.id}?ref=post:${post.id}`}>
                        Race
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        ))}

      {shownTab === 'mine' &&
        (runs.length === 0 ? (
          <p className="mute route-empty">You haven't driven this route yet.</p>
        ) : (
          <>
            {myBest && (
              <p className="statline">
                <span>
                  Your best <strong className="num">{formatLap(myBest.totalMs)}</strong>
                </span>
              </p>
            )}
            <div className="list">
              {recent.map((r) => (
                <Link key={r.id} to={`/run/${r.id}`} className="list-item">
                  <span className="grow">
                    <strong>{formatDate(r.startedAt)}</strong>
                    <span className="mute small-text">
                      {r.valid ? (r.id === myBest?.id ? 'Your best' : `Lap ${r.lap + 1}`) : 'Not valid'}
                      {r.posted && ' · posted'}
                      {r.replay && ' · simulated'}
                    </span>
                  </span>
                  <strong className="num logbook-time">{r.valid ? formatLap(r.totalMs) : '—'}</strong>
                </Link>
              ))}
            </div>
            <Link className="btn block" style={{ marginTop: 12 }} to={`/r/${route.id}/history`}>
              All my laps here
            </Link>
          </>
        ))}

      {shownTab === 'locals' &&
        (locals.length === 0 ? (
          <p className="mute route-empty">Nobody calls this their home course yet.</p>
        ) : (
          <div className="list">
            {locals.map((l) => (
              <Link key={l.id} to={`/u/${l.username}`} className="list-item">
                <Avatar name={l.username} hue={l.avatarHue} size={32} />
                <strong className="grow ellipsis">{l.username}</strong>
                {l.id === profile.id && <span className="badge outline">You</span>}
              </Link>
            ))}
          </div>
        ))}

      {(isOwner || canModChange) && (
        <>
          <h2 className="section-title">Manage</h2>
          <div className="row wrap">
            {isOwner && (
              <button className="btn" onClick={rename}>
                Rename
              </button>
            )}
            {(canOwnChange || canModChange) && (
              <Link className="btn" to={`/r/${route.id}/edit`}>
                Edit route
              </Link>
            )}
            {(canOwnChange || canModChange) && (
              <button className="btn danger" onClick={remove}>
                Delete route
              </button>
            )}
          </div>
          {isOwner && !canOwnChange && !canModChange && (
            <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>
              The shape and sectors are locked because this route has been published, so other drivers may have laps on it.
            </p>
          )}
        </>
      )}

      <div className="sticky-cta">
        <Link className="btn primary lg block" to={`/drive/${route.id}`}>
          <Play size={18} fill="currentColor" aria-hidden="true" /> Drive this route
        </Link>
      </div>
    </main>
  );
}
