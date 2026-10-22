import { Settings as SettingsIcon, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { RouteShape } from '../components/RouteShape';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, SectorStrip, useToast } from '../components/ui';
import {
  followCounts,
  getProfileByUsername,
  getRole,
  getRoute,
  getRoutes,
  leaderboardFrom,
  publicRoutesOf,
  routePosts,
  unpostLap,
  userPosts,
} from '../lib/data';
import { formatDate, formatLap, ROLE_LABEL } from '../lib/format';
import { postBigColours } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Profile, Role, Route } from '../lib/types';

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

  useEffect(() => {
    let alive = true;
    setUser(undefined);
    (async () => {
      try {
        const p = await getProfileByUsername(username);
        if (!alive) return;
        setUser(p);
        if (!p) return;
        const [ps, c, pr, r] = await Promise.all([userPosts(p.id), followCounts(p.id), publicRoutesOf(p.id), getRole(p.id)]);
        if (!alive) return;
        setPosts(ps);
        setCounts(c);
        setPublicRoutes(pr);
        // Unpublished or hidden since? Then getRoute returns null and nothing shows.
        setHome(p.homeRouteId ? await getRoute(p.homeRouteId) : null);
        setRole(r);
        const routeIds = [...new Set(ps.map((x) => x.routeId))];
        setRoutes(await getRoutes(routeIds));
        // Current leaderboard position on each route they've posted on.
        const rankMap = new Map<string, number>();
        let firsts = 0;
        await Promise.all(
          routeIds.map(async (rid) => {
            const board = leaderboardFrom(await routePosts(rid));
            const row = board.find((b) => b.post.userId === p.id);
            if (row) {
              rankMap.set(row.post.id, row.rank);
              if (row.rank === 1) firsts++;
            }
          }),
        );
        if (!alive) return;
        setRanks(rankMap);
        setWins(firsts);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [username, toast]);

  // Group by route, PB first in each group.
  const groups = useMemo(() => {
    const m = new Map<string, Post[]>();
    posts.forEach((p) => m.set(p.routeId, [...(m.get(p.routeId) ?? []), p]));
    return [...m.entries()].map(([routeId, list]) => {
      const sorted = [...list].sort((a, b) => a.totalMs - b.totalMs);
      return { routeId, routeName: sorted[0].routeName, pb: sorted[0], rest: sorted.slice(1).sort((a, b) => b.startedAt - a.startedAt) };
    });
  }, [posts]);

  async function remove(post: Post) {
    if (!confirm(`Remove your ${formatLap(post.totalMs)} lap from ${post.routeName}? It stays in your run history.`)) return;
    try {
      await unpostLap(me.id, post.id);
      setPosts((ps) => ps.filter((p) => p.id !== post.id));
      toast('Post removed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (user === undefined) return <Loading />;
  if (user === null)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Driver not found">There's no driver called "{username}".</Empty>
      </main>
    );

  return (
    <main className="screen">
      <ScreenHead
        back={!isMe}
        right={
          isMe && (
            <Link to="/settings" className="icon-btn" aria-label="Settings">
              <SettingsIcon size={22} />
            </Link>
          )
        }
      />
      <section className="profile-head">
        <Avatar name={user.username} hue={user.avatarHue} size={72} />
        <div className="grow">
          <h1 className="profile-name">{user.username}</h1>
          <p className="mute profile-sub">
            {role !== 'driver' && <span className="badge blue">{ROLE_LABEL[role]}</span>}
            {home?.isPublic ? (
              <>
                Home course <Link to={`/r/${home.id}`}>{home.name}</Link>
              </>
            ) : isMe ? (
              <>
                No home course yet. Pick one on a route's page in <Link to="/explore">Explore</Link>.
              </>
            ) : null}
            <span>Since {formatDate(user.createdAt?.toDate())}</span>
          </p>
        </div>
      </section>

      <p className="statline">
        <Link to={`/u/${user.username}/followers`}>
          <strong className="num">{counts?.followers ?? '–'}</strong> followers
        </Link>
        <Link to={`/u/${user.username}/following`}>
          <strong className="num">{counts?.following ?? '–'}</strong> following
        </Link>
        <span>
          <strong className="num">{posts.length}</strong> posted {posts.length === 1 ? 'lap' : 'laps'}
        </span>
        {wins > 0 && (
          <span>
            <strong className="num fastest">{wins}</strong> {wins === 1 ? 'P1' : 'P1s'}
          </span>
        )}
      </p>
      {!isMe && <FollowButtonBlock userId={user.id} onChange={(f) => setCounts((c) => (c ? { ...c, followers: c.followers + (f ? 1 : -1) } : c))} />}
      {isMe && isAdmin && (
        <Link to="/admin" className="btn block">
          <Shield size={18} aria-hidden="true" /> Admin
        </Link>
      )}

      <h2 className="section-title">Best laps</h2>
      {groups.length === 0 ? (
        <p className="mute">{isMe ? 'Laps you post on public routes appear here.' : `${user.username} hasn't posted a lap yet.`}</p>
      ) : (
        <div className="list">
          {groups.map((g) => {
            const rank = ranks.get(g.pb.id);
            return (
              <section key={g.routeId} className="trophy">
                <Link to={`/lap/${g.pb.id}`} className="trophy-main">
                  <span className="grow">
                    <strong className="ellipsis">{g.routeName}</strong>
                    <span className="mute ellipsis small-text">{[g.pb.car, formatDate(g.pb.startedAt)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="trophy-time">
                    <strong className={`num ${rank === 1 ? 'fastest' : ''}`}>{formatLap(g.pb.totalMs)}</strong>
                    {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>P{rank}</span>}
                  </span>
                </Link>
                {(isMe || g.rest.length > 0) && (
                  <details className="trophy-more">
                    <summary>{g.rest.length ? `${g.rest.length} more posted ${g.rest.length === 1 ? 'lap' : 'laps'}` : 'Manage post'}</summary>
                    {[g.pb, ...g.rest].map((p) => (
                      <PostRow key={p.id} post={p} pb={p.id === g.pb.id} route={routes.get(p.routeId)} isMe={isMe} onRemove={remove} />
                    ))}
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {publicRoutes.length > 0 && (
        <>
          <h2 className="section-title">{publicRoutes.length === 1 ? 'Route they built' : 'Routes they built'}</h2>
          <div className="list">
            {publicRoutes.map((r) => (
              <Link key={r.id} to={`/r/${r.id}`} className="list-item">
                <span className="logbook-shape" aria-hidden="true">
                  <RouteShape route={r} height={44} ticks={false} />
                </span>
                <strong className="grow ellipsis">{r.name}</strong>
                <span className="mute small-text">Leaderboard</span>
              </Link>
            ))}
          </div>
        </>
      )}
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

function PostRow({ post, pb, route, isMe, onRemove }: { post: Post; pb?: boolean; route?: Route; isMe: boolean; onRemove: (p: Post) => void }) {
  return (
    <div className="post-row">
      <Link to={`/lap/${post.id}`} className="post-row-main">
        <div className="row between">
          <span className={`num post-row-time ${pb ? 'pb' : ''}`}>{formatLap(post.totalMs)}</span>
          <span className="row" style={{ gap: 6 }}>
            {pb && <span className="badge ink">PB</span>}
            {post.penaltyMs > 0 && <span className="badge red">+5 s</span>}
            <span className="mute" style={{ fontSize: 14 }}>
              {formatDate(post.startedAt)}
            </span>
          </span>
        </div>
        <SectorStrip colours={postBigColours(post, route)} height={5} />
        {(post.caption || post.car) && (
          <p className="mute" style={{ fontSize: 14, marginTop: 6 }}>
            {[post.caption, post.car].filter(Boolean).join(' · ')}
          </p>
        )}
      </Link>
      {isMe && (
        <button className="btn ghost sm" onClick={() => onRemove(post)} aria-label={`Remove post ${formatLap(post.totalMs)}`}>
          Remove
        </button>
      )}
    </div>
  );
}
