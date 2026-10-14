import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RouteMap } from '../components/RouteMap';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { deleteRoute, getRoute, leaderboardFrom, renameRoute, routePosts, runsForRoute, sectorRecordsFrom } from '../lib/data';
import { formatDistance, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { Post, Route, Run } from '../lib/types';

export default function RouteDetail() {
  const { routeId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getRoute(routeId);
      if (!alive) return;
      setRoute(r);
      if (!r) return;
      const [p, mine] = await Promise.all([
        r.isPublic ? routePosts(r.id).catch(() => []) : Promise.resolve([] as Post[]),
        runsForRoute(profile.id, r.id).catch(() => []),
      ]);
      if (!alive) return;
      setPosts(p);
      setRuns(mine);
    })();
    return () => {
      alive = false;
    };
  }, [routeId, profile.id]);

  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const records = useMemo(() => (route ? sectorRecordsFrom(posts, route.boundaries.length) : []), [posts, route]);
  const myBest = useMemo(() => runs.filter((r) => r.valid).sort((a, b) => a.totalMs - b.totalMs)[0], [runs]);
  const isOwner = route?.ownerId === profile.id;

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
    if (!route || !confirm(`Delete “${route.name}”? This can't be undone.`)) return;
    try {
      await deleteRoute(route.id);
      toast('Route deleted');
      nav('/routes', { replace: true });
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

  return (
    <main className="screen">
      <ScreenHead back title={route.name} />
      <div className="map-card">
        <RouteMap route={route} height={240} />
      </div>
      <div className="facts">
        <Fact label="Length" value={formatDistance(route.lengthM)} />
        <Fact label="Sectors" value={String(route.boundaries.length)} />
        <Fact label="Start" value={route.startType === 'standing' ? 'Standing' : 'Rolling'} />
        <Fact label="Type" value={route.isLoop ? 'Lap' : 'A to B'} />
      </div>
      <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>
        {route.official ? <span className="badge purple">Official</span> : <>By <Link to={`/u/${route.ownerName}`}>{route.ownerName}</Link></>}
        {!route.isPublic && ' · Private'}
      </p>

      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        <Link className="btn primary lg grow" to={`/drive/${route.id}`}>
          Drive this route
        </Link>
        {runs.length > 0 && (
          <Link className="btn lg" to={`/r/${route.id}/history`}>
            My laps ({runs.length})
          </Link>
        )}
      </div>
      {myBest && (
        <p className="mute" style={{ marginTop: 10, fontSize: 14 }}>
          Your best: <span className="num" style={{ color: 'var(--ink)', fontSize: 17 }}>{formatLap(myBest.totalMs)}</span>
        </p>
      )}

      {route.isPublic && (
        <>
          <h2 className="section-title">Leaderboard</h2>
          {board.length === 0 ? (
            <p className="mute">No posted laps yet. Drive it and post yours to take P1.</p>
          ) : (
            <>
              <div className="records" aria-label="Sector records">
                {records.map((r, i) => (
                  <div key={i} className="record">
                    <span>S{i + 1}</span>
                    <strong className="num">{r == null ? '–' : (r / 1000).toFixed(2)}</strong>
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
                        <strong className="ellipsis">{post.username}</strong>
                        {post.car && <span className="mute ellipsis" style={{ display: 'block', fontSize: 13 }}>{post.car}</span>}
                      </span>
                    </Link>
                    <Link to={`/lap/${post.id}`} className="board-time num">
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
          )}
        </>
      )}

      {isOwner && (
        <>
          <h2 className="section-title">Manage</h2>
          <div className="row wrap">
            <button className="btn" onClick={rename}>
              Rename
            </button>
            {!route.hasRuns && !route.isPublic && (
              <button className="btn danger" onClick={remove}>
                Delete route
              </button>
            )}
          </div>
          {(route.hasRuns || route.publishedAt) && (
            <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>
              The shape and sectors are locked because this route has been driven{route.publishedAt ? ' or published' : ''}.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong className="num">{value}</strong>
    </div>
  );
}
