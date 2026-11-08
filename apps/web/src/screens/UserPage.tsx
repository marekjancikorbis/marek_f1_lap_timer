import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { RouteGlyph, RouteShape } from '../components/RouteShape';
import { postBigColours } from '../lib/laps';
import { Avatar, Empty, errorMessage, I, Loading, ScreenHead, SectorStrip, useToast } from '../components/ui';
import {
  allMyRuns,
  backfillActivity,
  followCounts,
  getActivity,
  getProfileByUsername,
  getRole,
  getRoute,
  getRoutes,
  leaderboardFrom,
  publicRoutesOf,
  routePosts,
  routeStats,
  userPosts,
} from '../lib/data';
import { formatDate, formatDistance, formatLap, nameOf, ROLE_LABEL } from '../lib/format';
import { historyColours } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Profile, Role, Route, Run } from '../lib/types';

type Tab = 'posts' | 'routes' | 'laps';

export default function UserPage() {
  const { username = '' } = useParams();
  const { profile: me, isAdmin } = useMe();
  const toast = useToast();
  const [user, setUser] = useState<Profile | null | undefined>(undefined);
  const [role, setRole] = useState<Role>('driver');
  const [posts, setPosts] = useState<Post[]>([]);
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);
  const [publicRoutes, setPublicRoutes] = useState<Route[]>([]);
  const [home, setHome] = useState<Route | null>(null);
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map());
  const [ranks, setRanks] = useState<Map<string, number>>(new Map());
  const [wins, setWins] = useState(0);
  const isMe = user?.id === me.id;
  const [activity, setActivity] = useState<Record<string, number> | null>(null);
  /** Routes you've driven: a post on one of them gets Compare, as in the Feed. */
  const [driven, setDriven] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('posts');
  /** Your own laps by route, loaded when the Laps tab first opens. */
  const [laps, setLaps] = useState<{ route: Route; runs: Run[] }[] | null>(null);
  /** Everything loaded: the skeleton stays until then, so the page never fills in piece by piece. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setUser(undefined);
    setReady(false);
    setTab('posts');
    setLaps(null);
    (async () => {
      try {
        const p = await getProfileByUsername(username);
        if (!alive) return;
        setUser(p);
        if (!p) return;
        const days = getActivity(p.id)
          .then((a) => (p.id === me.id && !a?.backfilled ? backfillActivity(p.id) : a))
          .then((a) => a?.days ?? {})
          .catch(() => ({}));
        // Unpublished or hidden since? Then getRoute returns null and nothing shows.
        const homeRoute = p.homeRouteId ? getRoute(p.homeRouteId) : null;
        const [ps, c, pr, r] = await Promise.all([userPosts(p.id), followCounts(p.id), publicRoutesOf(p.id), getRole(p.id)]);
        // Everything else needs only the posts, so it loads side by side.
        const routeIds = [...new Set(ps.map((x) => x.routeId))];
        const [home, routeMap, boards, activityDays, myStats] = await Promise.all([
          homeRoute,
          getRoutes(routeIds),
          Promise.all(routeIds.map((rid) => routePosts(rid))),
          days,
          routeStats(me.id).catch(() => ({})),
        ]);
        if (!alive) return;
        setPosts(ps);
        setCounts(c);
        setPublicRoutes(pr);
        setHome(home);
        setRole(r);
        setRoutes(routeMap);
        // Current leaderboard position on each route they've posted on.
        const rankMap = new Map<string, number>();
        let firsts = 0;
        for (const board of boards) {
          const row = leaderboardFrom(board).find((b) => b.post.userId === p.id);
          if (row) {
            rankMap.set(row.post.id, row.rank);
            if (row.rank === 1) firsts++;
          }
        }
        setRanks(rankMap);
        setWins(firsts);
        setActivity(activityDays);
        setDriven(new Set(Object.keys(myStats)));
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        // On a failure, show what did load rather than a skeleton forever.
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username, toast]);

  // Laps are private: only your own profile has the tab, and it loads on first open.
  useEffect(() => {
    if (tab !== 'laps' || laps || !isMe) return;
    (async () => {
      const runs = await allMyRuns(me.id);
      const byRoute = new Map<string, Run[]>();
      for (const r of runs) byRoute.set(r.routeId, [...(byRoute.get(r.routeId) ?? []), r]);
      const found = await getRoutes([...byRoute.keys()]);
      // Most recently driven route first; its runs come newest first.
      setLaps(
        [...byRoute]
          .flatMap(([id, rs]) => {
            const route = found.get(id);
            return route ? [{ route, runs: rs }] : [];
          })
          .sort((a, b) => b.runs[0].startedAt - a.runs[0].startedAt),
      );
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setLaps([]);
    });
  }, [tab, laps, isMe, me.id, toast]);

  // Best posted lap per route, best positions first.
  const best = useMemo(() => {
    const m = new Map<string, Post>();
    for (const p of posts) if (!m.has(p.routeId) || p.totalMs < m.get(p.routeId)!.totalMs) m.set(p.routeId, p);
    return [...m.values()]
      .map((pb) => ({ pb, rank: ranks.get(pb.id), count: posts.filter((p) => p.routeId === pb.routeId).length }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }, [posts, ranks]);

  const homeBest = home ? best.find((b) => b.pb.routeId === home.id)?.pb : undefined;

  const newest = useMemo(() => [...posts].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)), [posts]);

  if (user === undefined || (user && !ready)) return <Loading />;
  if (user === null)
    return (
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back />
        <Empty title="Driver not found">There's no driver called "{username}".</Empty>
      </main>
    );

  const name = nameOf(user);

  const stats = [
    `${posts.length} ${posts.length === 1 ? 'lap' : 'laps'}`,
    role !== 'driver' ? ROLE_LABEL[role].toLowerCase() : null,
    wins > 0 ? `${wins}× P1` : null,
  ].filter(Boolean);
  const row = (pb: Post, rank?: number) => {
    const route = routes.get(pb.routeId);
    return (
      <Link key={pb.id} to={`/lap/${pb.id}`} style={{ gridTemplateColumns: '1fr auto' }}>
        <div style={{ minWidth: 0 }}>
          <div className="lbl ellipsis">
            {pb.routeName}
            {rank ? ` · P${rank}` : ''}
          </div>
          <div className={`t${rank === 1 ? ' acc' : ''}`} style={{ fontSize: 24, marginTop: 3 }}>{formatLap(pb.totalMs)}</div>
        </div>
        <SectorStrip colours={postBigColours(pb, route)} />
      </Link>
    );
  };

  return (
    <main className="ph soft docked profile">
      <div className="profile-map" aria-hidden={!home?.isPublic}>
        {home?.isPublic && <RouteShape route={home} map height={300} ticks={false} label={`${name}'s home course, ${home.name}`} />}
      </div>
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 56 }}>
        {!isMe ? <ScreenHead back /> : <span />}
        {isMe && (
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && (
              <Link to="/admin" className="glass ib" aria-label="Admin">
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
                </svg>
              </Link>
            )}
            <Link to="/settings" className="glass ib" aria-label="Settings">
              <I n="gear" />
            </Link>
          </div>
        )}
      </div>
      <div className="glass sheet profile-sheet">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ flex: 'none' }}>
            <Avatar name={name} hue={user.avatarHue} size={64} uid={user.id} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 className="ellipsis" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>{name}</h1>
            <div className="lbl" style={{ marginTop: 2 }}>
              {name !== user.username && <>@{user.username} · </>}
              {stats.join(' · ')}
            </div>
            <div className="lbl" style={{ marginTop: 2, display: 'flex', gap: 10 }}>
              <Link to={`/u/${user.username}/followers`}>
                {counts?.followers ?? '–'} {counts?.followers === 1 ? 'follower' : 'followers'}
              </Link>
              <Link to={`/u/${user.username}/following`}>{counts?.following ?? '–'} following</Link>
            </div>
          </div>
          {!isMe && <FollowButton userId={user.id} onChange={(f) => setCounts((c) => (c ? { ...c, followers: c.followers + (f ? 1 : -1) } : c))} />}
        </div>
        {home?.isPublic ? (
          <Link to={`/r/${home.id}`} className="lbl" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <span>Home course · {home.name}</span>
            {homeBest && <span>{formatLap(homeBest.totalMs)}</span>}
          </Link>
        ) : (
          isMe && (
            <p className="lbl" style={{ marginTop: 14 }}>
              No home course yet. Pick one on a route&rsquo;s page in <Link to="/explore" style={{ textDecoration: 'underline' }}>Explore</Link>.
            </p>
          )
        )}
        {best.length > 0 ? (
          <div className="rows" style={{ marginTop: 10 }}>{best.map(({ pb, rank }) => row(pb, rank))}</div>
        ) : (
          <p className="lbl" style={{ marginTop: 18 }}>{isMe ? 'Laps you post on public routes appear here.' : `${name} hasn\u2019t posted a lap yet.`}</p>
        )}
        {newest.length > best.length && (
          <>
            <div className="lbl" style={{ marginTop: 18 }}>Latest laps</div>
            <div className="rows">{newest.slice(0, 10).map((p) => row(p))}</div>
          </>
        )}
        {publicRoutes.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 18 }}>Built by {name}</div>
            <div className="rows">
              {publicRoutes.map((r) => (
                <Link key={r.id} to={`/r/${r.id}`} style={{ gridTemplateColumns: '64px 1fr auto' }}>
                  <RouteGlyph route={r} style={{ width: 64, height: 44, color: '#fff' }} strokeWidth={56} />
                  <div style={{ minWidth: 0 }}>
                    <b className="ellipsis" style={{ display: 'block' }}>{r.name}</b>
                    <div className="lbl">
                      {formatDistance(r.lengthM)} · {r.isLoop ? 'lap' : r.startType}
                    </div>
                  </div>
                  <I n="fwd" style={{ color: 'var(--ink-2)' }} />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
