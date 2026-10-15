import { sectorTimes } from '@laptimer/timing';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DeltaGraph, SpeedGraph } from '../components/Charts';
import { RouteMap } from '../components/RouteMap';
import { RouteShape } from '../components/RouteShape';
import { Avatar, COLOUR_VAR, Empty, errorMessage, Loading, ScreenHead, Segmented, STRIP_LABEL, useToast } from '../components/ui';
import { getPost, getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom, unpostLap, updatePostText } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { compareLaps } from '@laptimer/timing';
import { useMe } from '../lib/session';
import type { Post, Route, SectorColourName } from '../lib/types';

/** Sectors shown before "Show all": enough for a short route, a screenful on a long one. */
const FOLD = 12;
const COLOURS: SectorColourName[] = ['purple', 'green', 'yellow'];

export default function LapDetail() {
  const { postId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [route, setRoute] = useState<Route | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [driven, setDriven] = useState(false);
  const [sort, setSort] = useState<'order' | 'lost'>('order');
  const [showAll, setShowAll] = useState(false);
  const [carAtM, setCarAtM] = useState<number | null>(null);

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
  // Per-sector record now (the best anyone has posted), so every sector shows what it gave away.
  const records = useMemo(() => {
    if (!post || posts.length < 2) return null;
    const rec = sectorRecordsFrom(posts, post.splitTimesMs.length);
    return rec.some((x) => x == null) ? null : (rec as number[]);
  }, [post, posts]);
  const rank = board.find((r) => r.post.id === post?.id)?.rank;
  // Against the route record: where this lap gains and loses on the best possible lap.
  const vsRecord = useMemo(() => {
    if (!post || !route || !records || records.length !== route.boundaries.length) return null;
    let acc = 0;
    const splits = records.map((s) => (acc += s));
    try {
      return compareLaps(post, { splitTimesMs: splits, totalMs: acc }, route.boundaries);
    } catch {
      return null;
    }
  }, [post, route, records]);

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
  const lost = records ? secs.map((ms, i) => Math.max(0, ms - records[i])) : null;
  const theoretical = records ? records.reduce((a, b) => a + b, 0) : null;
  const counts = COLOURS.map((c) => [c, post.sectorColours.filter((x) => x === c).length] as const).filter(([, n]) => n > 0);
  // Running gap to the best possible lap as the lap crossed each sector's end line.
  let acc = 0;
  const gapAt = lost ? lost.map((l) => (acc += l)) : null;
  const rows = secs.map((ms, i) => ({ i, ms, lost: lost ? lost[i] : null }));
  if (sort === 'lost' && lost) rows.sort((a, b) => (b.lost ?? 0) - (a.lost ?? 0));
  // Folding away only two or three rows would just add a tap.
  const folded = !showAll && rows.length > FOLD + 3;
  const visible = folded ? rows.slice(0, FOLD) : rows;
  const hasSpeed = !!post.profile && post.profile.speedDms.length > 1;
  const hasGraphs = !!route && (!!vsRecord || hasSpeed);

  return (
    <main className="screen">
      <ScreenHead back title="Lap" />
      <Link to={`/u/${post.username}`} className="row" style={{ gap: 10, textDecoration: 'none' }}>
        <Avatar name={post.username} hue={post.avatarHue} size={40} />
        <span className="grow">
          <strong>{post.username}</strong>
          <span className="mute" style={{ display: 'block', fontSize: 14 }}>
            {formatDate(post.startedAt)}
          </span>
        </span>
      </Link>

      <section className="lap-hero">
        {route && <RouteShape route={route} colours={post.sectorColours} height={190} label={`${post.routeName}, sectors coloured by this lap`} />}
        <Link to={`/r/${post.routeId}`} className="lap-hero-route">
          {post.routeName}
        </Link>
        <div className="lap-hero-time num">{formatLap(post.totalMs)}</div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
          {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>P{rank} now</span>}
          {post.isPB && <span className="badge ink">PB when posted</span>}
          {post.penaltyMs > 0 && <span className="badge red">incl. +{formatSeconds(post.penaltyMs, 3)} jump start</span>}
          {post.reactionMs != null && <span className="badge outline">Reaction {formatSeconds(post.reactionMs, 2)}</span>}
        </div>
        {(post.caption || post.car) && (
          <p className="lap-hero-caption">
            {post.caption} {post.car && <span className="mute">· {post.car}</span>}
          </p>
        )}
      </section>

      <Link className="btn primary lg block" style={{ marginTop: 16 }} to={`/drive/${post.routeId}?ref=post:${post.id}`}>
        Race against this
      </Link>
      <div className="row" style={{ marginTop: 8 }}>
        {driven && (
          <Link className="btn grow" to={`/compare/${post.routeId}?a=best&b=post:${post.id}`}>
            Compare with my best
          </Link>
        )}
        <Link className="btn grow" to={`/compare/${post.routeId}?a=post:${post.id}&b=record`}>
          Compare with…
        </Link>
      </div>

      <h2 className="section-title">Sectors · {secs.length}</h2>
      <div className="panel lap-sectors-head">
        <div className="lap-counts">
          {counts.map(([c, n]) => (
            <span key={c} className="lap-count">
              <i style={{ background: COLOUR_VAR[c] }} aria-hidden="true" />
              <strong className="num">{n}</strong> {STRIP_LABEL[c]}
            </span>
          ))}
        </div>
        {lost && theoretical != null && (
          <>
            <p className="lap-ideal">
              <span className="mute">Best possible lap from sector records</span>
              <span>
                <strong className="num">{formatLap(theoretical)}</strong> <span className="num mute">this lap {formatDelta(post.totalMs - theoretical, 3)}</span>
              </span>
            </p>
            <LossChart lost={lost} colours={post.sectorColours} />
          </>
        )}
      </div>

      {lost && (
        <div style={{ margin: '12px 0 8px' }}>
          <Segmented
            label="Sort sectors"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'order', label: 'In order' },
              { value: 'lost', label: 'Most time lost' },
            ]}
          />
        </div>
      )}
      {lost && (
        <div className="lap-sector lap-sector-cols" aria-hidden="true">
          <span />
          <span>Sector</span>
          <span>Time</span>
          <span>Lost</span>
          <span>Gap</span>
        </div>
      )}
      <ol className="list lap-sector-list" style={lost ? undefined : { marginTop: 12 }}>
        {visible.map(({ i, ms, lost: l }) => {
          const c = post.sectorColours[i];
          return (
            <li key={i} className="lap-sector">
              <span className="sector-chip" style={{ background: c ? COLOUR_VAR[c] : 'var(--hairline-2)' }} aria-hidden="true" />
              <span className="lap-sector-n num">S{i + 1}</span>
              {c && <span className="visually-hidden">{STRIP_LABEL[c]}</span>}
              <strong className="lap-sector-time num">{formatLap(ms)}</strong>
              {l != null && (
                <span className={`lap-sector-lost num ${l === 0 ? 'rec' : ''}`}>
                  <span className="visually-hidden">lost </span>
                  {l === 0 ? 'Record' : formatDelta(l, 3)}
                </span>
              )}
              {gapAt && (
                <span className="lap-sector-gap num">
                  <span className="visually-hidden">gap at end </span>
                  {formatDelta(gapAt[i], 3)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {folded && (
        <button className="btn block" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>
          Show all {rows.length} sectors
        </button>
      )}

      {route && (
        <>
          <h2 className="section-title">Map</h2>
          <div className="map-card">
            <RouteMap route={route} colours={post.sectorColours} height={240} carAtM={carAtM} onPick={hasGraphs ? setCarAtM : undefined} />
          </div>
          {hasGraphs && <p className="mute" style={{ fontSize: 13, marginTop: 6 }}>Tap a graph below or the route on the map to line the two up.</p>}
        </>
      )}

      {route && vsRecord && (
        <>
          <h2 className="section-title">Against the best possible lap</h2>
          <div className="panel chart-panel">
            <DeltaGraph data={vsRecord.delta} boundaries={route.boundaries} aLabel={post.username} bLabel="Sector records" onScrub={setCarAtM} at={carAtM} />
          </div>
        </>
      )}

      {route && post.profile && hasSpeed && (
        <>
          <h2 className="section-title">Speed</h2>
          <div className="panel chart-panel">
            <SpeedGraph
              data={post.profile.speedDms.map((v, i) => ({ d: i * post.profile!.stepM, a: v * 0.36, b: 0 }))}
              boundaries={route.boundaries}
              aLabel={post.username}
              bLabel={null}
              onScrub={setCarAtM}
              at={carAtM}
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

/**
 * One bar per sector, height = time lost to that sector's record, coloured by
 * the lap's sector colour. Stays readable at dozens of sectors, where a list
 * alone hides where the lap went wrong.
 */
function LossChart({ lost, colours }: { lost: number[]; colours: (SectorColourName | null)[] }) {
  const max = Math.max(...lost, 1);
  const n = lost.length;
  const step = 1000 / n;
  const gap = Math.min(step * 0.25, 6);
  const worst = lost
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l > 0)
    .sort((a, b) => b.l - a.l)
    .slice(0, 3);
  return (
    <figure className="loss-chart">
      <svg
        viewBox="0 0 1000 120"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Time lost per sector. ${worst.length ? `Most lost: ${worst.map((w) => `sector ${w.i + 1} ${formatDelta(w.l, 3)} s`).join(', ')}.` : 'Every sector is a record.'}`}
      >
        <line x1="0" x2="1000" y1="119.5" y2="119.5" className="loss-axis" />
        {lost.map((l, i) => {
          const h = l === 0 ? 3 : Math.max(5, (l / max) * 112);
          const c = colours[i];
          return <rect key={i} x={i * step + gap / 2} width={step - gap} y={120 - h} height={h} fill={c ? COLOUR_VAR[c] : 'var(--ink-2)'} />;
        })}
      </svg>
      <figcaption className="loss-axis-labels num">
        <span>S1</span>
        <span>Time lost to each sector record</span>
        <span>S{n}</span>
      </figcaption>
      {worst.length > 0 && (
        <div className="loss-worst">
          <span className="mute">Most lost</span>
          {worst.map((w) => (
            <span key={w.i} className="loss-worst-item num">
              S{w.i + 1} <strong>{formatDelta(w.l, 3)}</strong>
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
