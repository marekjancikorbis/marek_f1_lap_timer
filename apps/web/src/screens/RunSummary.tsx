import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { LapView } from '../components/LapView';
import { Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { deleteRun, getRoute, getRun, routePosts, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDelta, formatLap } from '../lib/format';
import { coloursFor, pbsBefore, recordsExcluding, resolveLap, runToLap, type ResolvedLap } from '../lib/laps';
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
    return runs.filter((r) => r.valid && r.id !== run.id && r.startedAt < run.startedAt && r.splitTimesMs.length === run.splitTimesMs.length).sort((a, b) => a.totalMs - b.totalMs)[0] ?? null;
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

  const session = useMemo(() => (run ? runs.filter((r) => r.sessionId === run.sessionId).sort((a, b) => a.lap - b.lap) : []), [run, runs]);

  const traceLayer = useCallback(
    (map: mapboxgl.Map) => {
      if (!run?.trace?.length) return;
      const coords: [number, number][] = [];
      for (let i = 0; i + 4 < run.trace.length; i += 5) coords.push([run.trace[i + 4], run.trace[i + 3]]);
      map.addSource('trace', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'trace', type: 'line', source: 'trace', paint: { 'line-color': '#eef1f5', 'line-width': 1.5, 'line-dasharray': [1, 2] } });
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
      await unpostLap(profile.id, run.id);
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
      <ScreenHead back={`/r/${run.routeId}`} title="Lap" />
      <LapView
        lap={{ ...run, profile: run.profile ?? null, username: profile.username, avatarHue: profile.avatarHue }}
        colours={colours}
        route={route}
        posts={posts}
        reference={against}
        onOpen={() => setOpened(true)}
        mapExtra={traceLayer}
        badges={
          <>
            {session.length > 1 && <span className="badge outline">Lap {run.lap + 1}</span>}
            {run.replay && <span className="badge yellow">Simulated</span>}
            {run.posted && <span className="badge blue">Posted</span>}
          </>
        }
        caption={
          <p className="lap-hero-caption mute" style={{ fontSize: 13 }}>
            GPS ±{run.gpsAvgAccuracyM} m · {run.gpsRateHz} Hz
            {run.jumpDistanceM != null && ` · moved ${run.jumpDistanceM} m before GO`}
          </p>
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
              {route && (
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

      {session.length > 1 && (
        <>
          <h2 className="section-title">This session</h2>
          <div className="list">
            {session.map((r) => (
              <Link key={r.id} to={`/run/${r.id}`} className="list-item" aria-current={r.id === run.id}>
                <span className="grow">Lap {r.lap + 1}</span>
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
