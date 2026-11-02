import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { LapView } from '../components/LapView';
import { Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { deleteRun, getRoute, getRun, routePosts, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { coloursFor, notCounted, pbsBefore, recordsExcluding, resolveLap, runToLap, sameSectors, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import { shareLap } from '../lib/shareImage';
import type { Post, Route, Run } from '../lib/types';

export default function RunSummary() {
  const { runId = '' } = useParams();
  const { profile } = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [route, setRoute] = useState<Route | null>(null);
  const [ref, setRef] = useState<ResolvedLap | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const r = await getRun(profile.id, runId);
    setRun(r);
    if (!r) return;
    const [rt, mine] = await Promise.all([getRoute(r.routeId), runsForRoute(profile.id, r.routeId)]);
    setRoute(rt);
    setRuns(mine);
    if (rt?.isPublic) setPosts(await routePosts(rt.id).catch(() => []));
    if (r.referenceRef) setRef(await resolveLap(r.referenceRef, profile.id, r.routeId).catch(() => null));
  }, [profile.id, runId]);

  useEffect(() => {
    load().catch((e) => {
      toast(errorMessage(e), 'error');
      setRun(null);
    });
  }, [load, toast]);

  // Public: purple beat the fastest posted sector, green beat your best. Private: purple beat your best, green beat the raced lap.
  const colours = useMemo(() => {
    if (!run || !route) return [];
    const records = route.isPublic ? recordsExcluding(posts, route.boundaries.length, run.id) : null;
    return coloursFor(run.splitTimesMs, pbsBefore(runs, run), records, ref?.splitTimesMs ?? null);
  }, [run, route, posts, runs, ref]);

  // Bars and graphs measure against the raced lap, or else your best lap from before this one.
  const prev = useMemo(() => {
    if (ref || !run) return null;
    return runs.filter((r) => r.valid && r.id !== run.id && r.startedAt < run.startedAt && sameSectors(r, run)).sort((a, b) => a.totalMs - b.totalMs)[0] ?? null;
  }, [ref, run, runs]);
  // Listed runs come without their profile; fetch it once the graphs are opened.
  const [opened, setOpened] = useState(false);
  const [prevFull, setPrevFull] = useState<Run | null>(null);
  useEffect(() => {
    if (opened && prev) getRun(profile.id, prev.id).then(setPrevFull).catch(() => undefined);
  }, [opened, prev, profile.id]);
  const against = useMemo(
    () => ref ?? (prev ? runToLap(prevFull?.id === prev.id ? prevFull : prev, 'your previous best') : null),
    [ref, prev, prevFull],
  );

  // Sessions of laps exist only on lap routes: a stage is one run start to finish.
  const session = useMemo(
    () => (run && route?.isLoop ? runs.filter((r) => r.sessionId === run.sessionId).sort((a, b) => a.lap - b.lap) : []),
    [run, runs, route],
  );
  const stage = route ? !route.isLoop : false;

  const traceLayer = useCallback(
    (map: mapboxgl.Map) => {
      if (!run?.trace?.length) return;
      const coords: [number, number][] = [];
      for (let i = 0; i + 4 < run.trace.length; i += 5) coords.push([run.trace[i + 4], run.trace[i + 3]]);
      map.addSource('trace', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'trace', type: 'line', source: 'trace', paint: { 'line-color': '#0e1b3d', 'line-width': 1.5, 'line-dasharray': [1, 2] } });
    },
    [run],
  );

  async function discard() {
    if (!run || !confirm('Discard this lap? It will be deleted.')) return;
    try {
      await deleteRun(profile.id, run);
      toast('Lap discarded');
      nav(`/r/${run.routeId}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function share() {
    if (!run || !route) return;
    try {
      await shareLap({
        route,
        username: profile.username,
        date: formatDate(run.startedAt),
        totalMs: run.totalMs,
        penaltyMs: run.penaltyMs,
        colours,
        delta: ref ? { ms: run.totalMs - ref.totalMs, label: ref.label } : null,
      });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function unpost() {
    if (!run) return;
    try {
      await unpostLap(profile.id, run.id, run.routeId);
      setRun({ ...run, posted: false });
      toast('Post removed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (run === undefined) return <Loading />;
  if (!run)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Lap not found">It may have been deleted, or it's still syncing.</Empty>
      </main>
    );

  const canPost = route?.isPublic && !route.hidden && run.valid && !run.replay;

  return (
    <main className="screen">
      <ScreenHead back={`/r/${run.routeId}`} title={stage ? 'Stage' : 'Lap'} />
      <LapView
        lap={{ ...run, profile: run.profile ?? null, username: profile.username, userId: profile.id, avatarHue: profile.avatarHue }}
        colours={colours}
        route={route}
        posts={posts}
        reference={against}
        onOpen={() => setOpened(true)}
        mapExtra={traceLayer}
        badges={
          <>
            {session.length > 1 && <span className="badge outline">Lap {run.lap + 1}</span>}
            {run.replay && <span className="badge outline">Simulated</span>}
            {run.posted && <span className="badge ink">Posted</span>}
            {notCounted(run) && <span className="badge outline">{notCounted(run)}</span>}
          </>
        }
        caption={
          <>
            <p className="lap-hero-caption mute" style={{ fontSize: 13 }}>
              GPS ±{run.gpsAvgAccuracyM} m · {run.gpsRateHz} Hz
              {run.jumpDistanceM != null && ` · moved ${run.jumpDistanceM} m before GO`}
            </p>
            {!run.valid && (
              <p className="lap-hero-caption mute" style={{ fontSize: 13 }}>
                {run.partial
                  ? `Stopped before the finish${run.splitTimesMs.length ? ` after ${run.splitTimesMs.length} of ${route?.boundaries.length ?? '?'} minisectors` : ''}.`
                  : `No GPS signal for ${formatSeconds(run.gpsGapMs ?? 0, 0)}.`}{' '}
                It can be compared but can't be posted or set a best.
              </p>
            )}
          </>
        }
        actions={
          <div className="stack" style={{ marginTop: 16 }}>
            {canPost && !run.posted && (
              <button className="btn primary lg block" onClick={() => setPosting(true)}>
                Post to leaderboard
              </button>
            )}
            {run.replay && route?.isPublic && <p className="mute" style={{ fontSize: 13, textAlign: 'center' }}>Simulated laps can't be posted.</p>}
            <div className="row">
              {run.referenceRef && (
                <Link className="btn grow" to={`/compare/${run.routeId}?a=run:${run.id}&b=${run.referenceRef}`}>
                  Compare
                </Link>
              )}
              <Link className="btn grow" to={`/drive/${run.routeId}?ref=run:${run.id}`}>
                Race again
              </Link>
              {route && !run.partial && (
                <button className="btn grow" onClick={share}>
                  Share image
                </button>
              )}
            </div>
          </div>
        }
      >
        <div className="row" style={{ marginTop: 24 }}>
          <Link className="btn primary grow" to={`/r/${run.routeId}`}>
            Keep
          </Link>
          {run.posted && (
            <button className="btn grow" onClick={unpost}>
              Remove post
            </button>
          )}
          <button className="btn danger grow" onClick={discard}>
            Discard
          </button>
        </div>
      </LapView>

      {stage && run.valid && <StageCompare run={run} prev={prev} userId={profile.id} posts={route?.isPublic ? posts : []} />}

      {session.length > 1 && (
        <>
          <h2 className="section-title">This session</h2>
          <div className="list">
            {session.map((r) => (
              <Link key={r.id} to={`/run/${r.id}`} className="list-item" aria-current={r.id === run.id}>
                <span className="grow">
                  Lap {r.lap + 1}
                  {notCounted(r) && <span className="mute"> · {notCounted(r)}</span>}
                </span>
                <strong className="num" style={{ fontSize: 20 }}>
                  {formatLap(r.totalMs)}
                </strong>
              </Link>
            ))}
          </div>
        </>
      )}

      {route && <PostSheet open={posting} onClose={() => setPosting(false)} run={run} route={route} myRuns={runs} onPosted={() => setRun({ ...run, posted: true })} />}
    </main>
  );
}

/** A stage has no session: one result, read against your earlier best, the route record and the leaderboard. */
function StageCompare({ run, prev, userId, posts }: { run: Run; prev: Run | null; userId: string; posts: Post[] }) {
  const others = posts.filter((p) => p.userId !== userId);
  const record = others.reduce<Post | null>((best, p) => (!best || p.totalMs < best.totalMs ? p : best), null);
  // Each other driver's best posted time, then where this time would sit among them.
  const bestBy = new Map<string, number>();
  for (const p of others) bestBy.set(p.userId, Math.min(bestBy.get(p.userId) ?? Infinity, p.totalMs));
  const place = [...bestBy.values()].filter((t) => t < run.totalMs).length + 1;
  if (!prev && !record) return null;
  return (
    <>
      <h2 className="section-title">How it compares</h2>
      <div className="list">
        {prev && (
          <div className="list-item">
            <span className="grow">
              <strong>Your best before</strong>
              <span className="mute small-text">
                {formatLap(prev.totalMs)} · {formatDate(prev.startedAt)}
              </span>
            </span>
            <strong className={`num ${run.totalMs <= prev.totalMs ? 'faster' : 'slower'}`}>{formatDelta(run.totalMs - prev.totalMs, 3)}</strong>
          </div>
        )}
        {record && (
          <div className="list-item">
            <span className="grow">
              <strong>Route record</strong>
              <span className="mute small-text">
                {record.username} · {formatLap(record.totalMs)}
              </span>
            </span>
            <strong className={`num ${run.totalMs <= record.totalMs ? 'fastest' : 'slower'}`}>{formatDelta(run.totalMs - record.totalMs, 3)}</strong>
          </div>
        )}
        {record && !run.replay && (
          <div className="list-item">
            <strong className="grow">{run.posted ? 'Leaderboard' : 'Leaderboard if posted'}</strong>
            <strong>
              P{place} of {bestBy.size + 1}
            </strong>
          </div>
        )}
      </div>
    </>
  );
}
