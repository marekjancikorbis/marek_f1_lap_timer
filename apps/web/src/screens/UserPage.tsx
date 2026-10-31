import { Check, ChevronRight, Flag, LayoutGrid, Lock, Route as RouteIcon, Settings as SettingsIcon, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { FollowButton } from '../components/FollowButton';
import { LapCard } from '../components/LapCard';
import { RouteShape } from '../components/RouteShape';
import { SkeletonRows } from '../components/Skeleton';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, SectorStrip, useToast } from '../components/ui';
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

  const newest = useMemo(() => [...posts].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)), [posts]);

  if (user === undefined || (user && !ready)) return <Loading />;
  if (user === null)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Driver not found">There's no driver called "{username}".</Empty>
      </main>
    );

  const name = nameOf(user);
  const tabs: { id: Tab; label: string; icon: typeof Lock }[] = [
    { id: 'posts', label: 'Posts', icon: LayoutGrid },
    { id: 'routes', label: 'Routes', icon: RouteIcon },
    ...(isMe ? [{ id: 'laps' as const, label: 'Laps', icon: Lock }] : []),
  ];

  return (
    <main className="screen">
      <ScreenHead
        back={!isMe}
        title={<h1 className="profile-handle">{user.username}</h1>}
        right={
          isMe && (
            <Link to="/settings" className="icon-btn" aria-label="Settings">
              <SettingsIcon size={22} />
            </Link>
          )
        }
      />

      <section className="profile-top">
        <Avatar name={user.username} hue={user.avatarHue} size={86} uid={user.id} />
        <div className="profile-counts">
          <span>
            <strong className="num">{posts.length}</strong> {posts.length === 1 ? 'post' : 'posts'}
          </span>
          <Link to={`/u/${user.username}/followers`}>
            <strong className="num">{counts?.followers ?? '–'}</strong> {counts?.followers === 1 ? 'follower' : 'followers'}
          </Link>
          <Link to={`/u/${user.username}/following`}>
            <strong className="num">{counts?.following ?? '–'}</strong> following
          </Link>
        </div>
      </section>

      <section className="profile-bio">
        <p className="row" style={{ gap: 8 }}>
          <strong className="profile-name">{name}</strong>
          {role !== 'driver' && <span className="badge blue">{ROLE_LABEL[role]}</span>}
        </p>
        {home?.isPublic ? (
          <p className="profile-home">
            <Flag size={14} aria-hidden="true" /> Home course <Link to={`/r/${home.id}`}>{home.name}</Link>
          </p>
        ) : (
          isMe && (
            <p className="mute">
              No home course yet. Pick one on a route's page in <Link to="/explore">Explore</Link>.
            </p>
          )
        )}
        <p className="mute">
          {wins > 0 && (
            <>
              <strong className="num fastest">{wins}× P1</strong> ·{' '}
            </>
          )}
          Driving since {formatDate(user.createdAt?.toDate())}
        </p>
      </section>

      {!isMe && <FollowButtonBlock userId={user.id} onChange={(f) => setCounts((c) => (c ? { ...c, followers: c.followers + (f ? 1 : -1) } : c))} />}
      {isMe && isAdmin && (
        <Link to="/admin" className="btn block" style={{ marginTop: 12 }}>
          <Shield size={18} aria-hidden="true" /> Admin
        </Link>
      )}

      {activity && <ActivityHeatmap days={activity} weeks={26} />}

      <div className="profile-tabs" role="tablist" aria-label="Profile">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'posts' &&
          (newest.length === 0 ? (
            <p className="mute profile-empty">{isMe ? 'Laps you post on public routes appear here.' : `${name} hasn't posted a lap yet.`}</p>
          ) : (
            <div className="stack-lg">
              {newest.map((p) => (
                <LapCard key={p.id} post={p} route={routes.get(p.routeId)} canCompare={driven.has(p.routeId)} showAuthor={false} />
              ))}
            </div>
          ))}

        {tab === 'routes' && (
          <>
            {best.length > 0 && (
              <>
                <h2 className="section-title">Best on</h2>
                <div className="list">
                  {best.map(({ pb, rank, count }) => {
                    const route = routes.get(pb.routeId);
                    return (
                      <Link key={pb.routeId} to={`/r/${pb.routeId}`} className="list-item">
                        <span className="logbook-shape" aria-hidden="true">
                          {route && <RouteShape route={route} height={44} ticks={false} />}
                        </span>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <strong className="ellipsis">{pb.routeName}</strong>
                          <span className="mute ellipsis small-text">
                            {[route && formatDistance(route.lengthM), `${count} ${count === 1 ? 'lap' : 'laps'} posted`].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="trophy-time">
                          <strong className={`num ${rank === 1 ? 'fastest' : ''}`}>{formatLap(pb.totalMs)}</strong>
                          {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>P{rank}</span>}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
            {publicRoutes.length > 0 && (
              <>
                <h2 className="section-title">Built by {name}</h2>
                <div className="list">
                  {publicRoutes.map((r) => (
                    <Link key={r.id} to={`/r/${r.id}`} className="list-item">
                      <span className="logbook-shape" aria-hidden="true">
                        <RouteShape route={r} height={44} ticks={false} />
                      </span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <strong className="ellipsis">{r.name}</strong>
                        <span className="mute ellipsis small-text">
                          {formatDistance(r.lengthM)} · {r.isLoop ? 'lap' : 'A to B'}
                        </span>
                      </span>
                      <span className="section-link row" style={{ gap: 2 }}>
                        Leaderboard <ChevronRight size={16} aria-hidden="true" />
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {best.length === 0 && publicRoutes.length === 0 && (
              <p className="mute profile-empty">{isMe ? 'Routes you post a lap on, or build, appear here.' : `${name} hasn't posted on or built a route yet.`}</p>
            )}
          </>
        )}

        {tab === 'laps' && isMe && (
          <>
            <p className="mute profile-private">
              <Lock size={14} aria-hidden="true" /> Only you see this tab
            </p>
            {laps === null ? (
              <SkeletonRows count={4} />
            ) : laps.length === 0 ? (
              <Empty title="No laps yet" action={<Link to="/drive" className="btn primary lg">Start a drive</Link>}>
                Every lap you drive is saved here, grouped by route.
              </Empty>
            ) : (
              <div className="stack">
                {laps.map(({ route, runs }) => (
                  <RouteLaps key={route.id} route={route} runs={runs} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function FollowButtonBlock(props: { userId: string; onChange: (f: boolean) => void }) {
  return (
    <div className="follow-block">
      <FollowButton userId={props.userId} size="lg" onChange={props.onChange} />
    </div>
  );
}

/** One route's newest laps, its PB and the way to all of them. */
function RouteLaps({ route, runs }: { route: Route; runs: Run[] }) {
  const colours = useMemo(() => historyColours(runs, route), [runs, route]);
  const pb = runs.filter((r) => r.valid).reduce<number | null>((m, r) => (m == null || r.totalMs < m ? r.totalMs : m), null);
  // Only a public route takes posts.
  const postable = route.isPublic && !route.hidden;
  return (
    <section className="list" aria-label={route.name}>
      <Link to={`/r/${route.id}/history`} className="list-item">
        <strong className="grow ellipsis">{route.name}</strong>
        <span className="mute small-text">
          {pb != null && (
            <>
              PB <strong className="num">{formatLap(pb)}</strong> ·{' '}
            </>
          )}
          {runs.length} {runs.length === 1 ? 'lap' : 'laps'}
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
      {runs.slice(0, 3).map((run) => (
        <div key={run.id} className="list-item">
          <Link to={`/run/${run.id}`} className="grow lap-row-main">
            <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <strong className="num lap-row-time">{formatLap(run.totalMs)}</strong>
              <span className="mute small-text">{formatDate(run.startedAt)}</span>
            </span>
            <span style={{ maxWidth: 150 }}>
              <SectorStrip colours={colours(run)} height={4} />
            </span>
          </Link>
          {run.posted ? (
            <span className="mute small-text row" style={{ gap: 4 }}>
              <Check size={14} aria-hidden="true" /> Posted
            </span>
          ) : (
            postable &&
            run.valid && (
              <Link to={`/run/${run.id}`} className="btn sm">
                Post
              </Link>
            )
          )}
        </div>
      ))}
    </section>
  );
}
