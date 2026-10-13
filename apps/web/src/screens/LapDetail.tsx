import { sectorTimes } from '@laptimer/timing';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DeltaGraph, SpeedGraph } from '../components/Charts';
import { RouteMap } from '../components/RouteMap';
import { Avatar, COLOUR_VAR, Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { getPost, getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom, unpostLap, updatePostText } from '../lib/data';
import { formatDate, formatLap, formatSeconds } from '../lib/format';
import { compareLaps } from '@laptimer/timing';
import { useMe } from '../lib/session';
import type { Post, Route } from '../lib/types';

export default function LapDetail() {
  const { postId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [route, setRoute] = useState<Route | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [driven, setDriven] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getPost(postId);
      setPost(p);
      if (!p) return;
      const [r, all, mine] = await Promise.all([getRoute(p.routeId), routePosts(p.routeId).catch(() => []), runsForRoute(profile.id, p.routeId).catch(() => [])]);
      setRoute(r);
      setPosts(all);
      setDriven(mine.some((x) => x.valid));
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setPost(null);
    });
  }, [postId, profile.id, toast]);

  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const rank = board.find((r) => r.post.id === post?.id)?.rank;
  // Against the route record: where this lap gains and loses on the best possible lap.
  const vsRecord = useMemo(() => {
    if (!post || !route || posts.length < 2) return null;
    const rec = sectorRecordsFrom(posts, route.boundaries.length);
    if (rec.some((x) => x == null)) return null;
    let acc = 0;
    const splits = (rec as number[]).map((s) => (acc += s));
    try {
      return compareLaps(post, { splitTimesMs: splits, totalMs: acc }, route.boundaries);
    } catch {
      return null;
    }
  }, [post, route, posts]);

  async function editCaption() {
    if (!post) return;
    const caption = prompt('Caption', post.caption ?? '');
    if (caption === null) return;
    try {
      await updatePostText(post.id, caption, post.car);
      setPost({ ...post, caption: caption.trim() || null });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!post || !confirm('Remove this post? The lap stays in your history.')) return;
    try {
      await unpostLap(profile.id, post.id);
      toast('Post removed');
      nav(-1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (post === undefined) return <Loading />;
  if (!post)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Lap not available">The post was removed or its route is hidden.</Empty>
      </main>
    );

  const mine = post.userId === profile.id;
  const secs = sectorTimes(post.splitTimesMs);

  return (
    <main className="screen">
      <ScreenHead back title="Lap" />
      <Link to={`/u/${post.username}`} className="row" style={{ gap: 10, textDecoration: 'none' }}>
        <Avatar name={post.username} hue={post.avatarHue} size={40} />
        <span>
          <strong>{post.username}</strong>
          <span className="mute" style={{ display: 'block', fontSize: 14 }}>
            {post.routeName} · {formatDate(post.startedAt)}
          </span>
        </span>
      </Link>

      <section className="summary-head" style={{ marginTop: 16 }}>
        <div className="summary-time num">{formatLap(post.totalMs)}</div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
          {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>P{rank} now</span>}
          {post.isPB && <span className="badge ink">PB when posted</span>}
          {post.penaltyMs > 0 && <span className="badge red">incl. +{formatSeconds(post.penaltyMs, 3)} jump start</span>}
          {post.reactionMs != null && <span className="badge outline">Reaction {formatSeconds(post.reactionMs, 2)}</span>}
        </div>
        {(post.caption || post.car) && (
          <p style={{ marginTop: 10, textAlign: 'center' }}>
            {post.caption} {post.car && <span className="mute">· {post.car}</span>}
          </p>
        )}
      </section>

      <div className="stack" style={{ marginTop: 16 }}>
        {driven && (
          <Link className="btn block" to={`/compare/${post.routeId}?a=best&b=post:${post.id}`}>
            Compare with my best
          </Link>
        )}
        <div className="row">
          <Link className="btn grow" to={`/compare/${post.routeId}?a=post:${post.id}&b=record`}>
            Compare with…
          </Link>
          <Link className="btn primary grow" to={`/drive/${post.routeId}?ref=post:${post.id}`}>
            Race against this
          </Link>
        </div>
      </div>

      <h2 className="section-title">Sectors</h2>
      <div className="list">
        {secs.map((ms, i) => (
          <div key={i} className="list-item sector-row">
            <span className="sector-chip" style={{ background: COLOUR_VAR[post.sectorColours[i] ?? 'yellow'] }} aria-hidden="true" />
            <span className="grow">
              Sector {i + 1}
              <span className="visually-hidden"> {post.sectorColours[i]}</span>
            </span>
            <strong className="num" style={{ fontSize: 20 }}>
              {formatLap(ms)}
            </strong>
          </div>
        ))}
      </div>

      {route && (
        <>
          <h2 className="section-title">Map</h2>
          <div className="map-card">
            <RouteMap route={route} colours={post.sectorColours} height={240} />
          </div>
        </>
      )}

      {route && vsRecord && (
        <>
          <h2 className="section-title">Against the route record</h2>
          <div className="panel chart-panel">
            <DeltaGraph data={vsRecord.delta} boundaries={route.boundaries} aLabel={post.username} bLabel="Record" />
          </div>
        </>
      )}

      {route && post.profile && post.profile.speedDms.length > 1 && (
        <>
          <h2 className="section-title">Speed</h2>
          <div className="panel chart-panel">
            <SpeedGraph
              data={post.profile.speedDms.map((v, i) => ({ d: i * post.profile!.stepM, a: v * 0.36, b: 0 }))}
              boundaries={route.boundaries}
              aLabel={post.username}
              bLabel={null}
            />
          </div>
        </>
      )}

      {mine && (
        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn grow" onClick={editCaption}>
            Edit caption
          </button>
          <button className="btn danger grow" onClick={remove}>
            Remove post
          </button>
        </div>
      )}
    </main>
  );
}
