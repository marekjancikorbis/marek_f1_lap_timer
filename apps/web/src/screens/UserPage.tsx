import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { RouteShape } from '../components/RouteShape';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, SectorStrip, useToast } from '../components/ui';
import {
  followCounts,
  getProfileByUsername,
  getRole,
  getRoutes,
  leaderboardFrom,
  publicRouteOf,
  routePosts,
  unpostLap,
  userPosts,
} from '../lib/data';
import { formatDate, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { Post, Profile, Role, Route } from '../lib/types';

export default function UserPage() {
  const { username = '' } = useParams();
  const { profile: me } = useMe();
  const toast = useToast();
  const [user, setUser] = useState<Profile | null | undefined>(undefined);
  const [role, setRole] = useState<Role>('driver');
  const [posts, setPosts] = useState<Post[]>([]);
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);
  const [publicRoute, setPublicRoute] = useState<Route | null>(null);
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
        const [ps, c, pr, r] = await Promise.all([userPosts(p.id), followCounts(p.id), publicRouteOf(p.id), getRole(p.id)]);
        if (!alive) return;
        setPosts(ps);
        setCounts(c);
        setPublicRoute(pr);
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
        <Avatar name={user.username} hue={user.avatarHue} size={76} />
        <div className="grow">
          <h1 style={{ fontSize: '2rem' }}>{user.username}</h1>
          <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
            {role !== 'driver' && <span className="badge purple">{role === 'admin' ? 'Admin' : 'Creator'}</span>}
            <span className="mute" style={{ fontSize: 14 }}>
              Member since {formatDate(user.createdAt?.toDate())}
            </span>
          </div>
        </div>
      </section>

      <div className="stats-row">
        <Stat value={posts.length} label="Posted laps" />
        <Stat value={routes.size || new Set(posts.map((p) => p.routeId)).size} label="Routes" />
        <Stat value={wins} label="P1s" />
      </div>

      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        <Link to={`/u/${user.username}/followers`} className="btn grow">
          <span className="num" style={{ fontSize: 18 }}>{counts?.followers ?? '–'}</span> Followers
        </Link>
        <Link to={`/u/${user.username}/following`} className="btn grow">
          <span className="num" style={{ fontSize: 18 }}>{counts?.following ?? '–'}</span> Following
        </Link>
      </div>
      {!isMe && (
        <div style={{ marginTop: 12 }}>
          <FollowButtonBlock userId={user.id} onChange={(f) => setCounts((c) => (c ? { ...c, followers: c.followers + (f ? 1 : -1) } : c))} />
        </div>
      )}

      {publicRoute && (
        <>
          <h2 className="section-title">Public route</h2>
          <Link to={`/r/${publicRoute.id}`} className="panel route-tile">
            <RouteShape map route={publicRoute} height={120} />
            <div className="row between" style={{ marginTop: 8 }}>
              <strong>{publicRoute.name}</strong>
              <span className="mute">Leaderboard →</span>
            </div>
          </Link>
        </>
      )}

      <h2 className="section-title">Posted laps</h2>
      {groups.length === 0 ? (
        <p className="mute">{isMe ? 'Laps you post on public routes appear here.' : `${user.username} hasn't posted a lap yet.`}</p>
      ) : (
        <div className="stack-lg">
          {groups.map((g) => (
            <section key={g.routeId} className="panel">
              <Link to={`/r/${g.routeId}`} className="row between" style={{ textDecoration: 'none' }}>
                <h3>{g.routeName}</h3>
                {ranks.get(g.pb.id) && <span className={`badge ${ranks.get(g.pb.id) === 1 ? 'purple' : ''}`}>P{ranks.get(g.pb.id)}</span>}
              </Link>
              <PostRow post={g.pb} pb isMe={isMe} onRemove={remove} />
              {g.rest.map((p) => (
                <PostRow key={p.id} post={p} isMe={isMe} onRemove={remove} />
              ))}
            </section>
          ))}
        </div>
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <span className="num">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function PostRow({ post, pb, isMe, onRemove }: { post: Post; pb?: boolean; isMe: boolean; onRemove: (p: Post) => void }) {
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
        <SectorStrip colours={post.sectorColours} height={5} />
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
