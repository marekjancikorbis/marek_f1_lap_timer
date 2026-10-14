import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { RouteMap } from '../components/RouteMap';
import { COLOUR_VAR, Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { deleteRun, getRoute, getRun, routePosts, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { coloursFor, recordsExcluding, resolveLap, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import { shareLap } from '../lib/shareImage';
import type { Post, Route, Run } from '../lib/types';
import { bestSectors, sectorTimes } from '@laptimer/timing';

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

  // Purple: fastest posted sector on public routes, your own all-time best on private ones.
  const colours = useMemo(() => {
    if (!run || !route) return [];
    const n = route.boundaries.length;
    const records = route.isPublic
      ? recordsExcluding(posts, n, run.id)
      : bestSectors(runs.filter((x) => x.valid && x.id !== run.id && x.splitTimesMs.length === n));
    return coloursFor(run.splitTimesMs, ref?.splitTimesMs ?? null, records);
  }, [run, route, posts, runs, ref]);

  const session = useMemo(() => (run ? runs.filter((r) => r.sessionId === run.sessionId).sort((a, b) => a.lap - b.lap) : []), [run, runs]);

  const traceLayer = useCallback(
    (map: mapboxgl.Map) => {
      if (!run?.trace?.length) return;
      const coords: [number, number][] = [];
      for (let i = 0; i + 4 < run.trace.length; i += 5) coords.push([run.trace[i + 4], run.trace[i + 3]]);
      map.addSource('trace', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'trace', type: 'line', source: 'trace', paint: { 'line-color': '#f2f1ec', 'line-width': 1.5, 'line-dasharray': [1, 2] } });
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

  const secs = sectorTimes(run.splitTimesMs);
  const refSecs = ref ? sectorTimes(ref.splitTimesMs) : null;
  const canPost = route?.isPublic && !route.hidden && run.valid && !run.replay;

  return (
    <main className="screen">
      <ScreenHead back={`/r/${run.routeId}`} title="Lap" />
      <section className="summary-head">
        <p className="mute">
          {run.routeName} · {formatDate(run.startedAt)}
          {session.length > 1 && ` · lap ${run.lap + 1}`}
        </p>
        <div className="summary-time num">{formatLap(run.totalMs)}</div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
          {run.penaltyMs > 0 && <span className="badge red">incl. +{formatSeconds(run.penaltyMs, 3)} jump start</span>}
          {run.reactionMs != null && <span className="badge outline">Reaction {formatSeconds(run.reactionMs, 2)}</span>}
          {ref && (
            <span className={`badge ${run.totalMs < ref.totalMs ? 'green' : ''}`}>
              {formatDelta(run.totalMs - ref.totalMs, 3)} vs {ref.label}
            </span>
          )}
          {run.replay && <span className="badge yellow">Simulated</span>}
          {run.posted && <span className="badge purple">Posted</span>}
        </div>
        <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>
          GPS ±{run.gpsAvgAccuracyM} m · {run.gpsRateHz} Hz
          {run.jumpDistanceM != null && ` · moved ${run.jumpDistanceM} m before GO`}
        </p>
      </section>

      <div className="list sectors-list" style={{ marginTop: 16 }}>
        {secs.map((ms, i) => (
          <div key={i} className="list-item sector-row">
            <span className="sector-chip" style={{ background: COLOUR_VAR[colours[i] ?? 'yellow'] }} aria-hidden="true" />
            <span className="grow">
              Sector {i + 1}
              <span className="visually-hidden"> {colours[i]}</span>
            </span>
            {refSecs && <span className="num mute">{formatDelta(ms - refSecs[i], 3)}</span>}
            <strong className="num" style={{ fontSize: 20, minWidth: 84, textAlign: 'right' }}>
              {formatLap(ms)}
            </strong>
          </div>
        ))}
      </div>

      {route && (
        <div className="map-card" style={{ marginTop: 16 }}>
          <RouteMap route={route} colours={colours} height={240} extra={traceLayer} />
        </div>
      )}

      <div className="stack" style={{ marginTop: 20 }}>
        {canPost && !run.posted && (
          <button className="btn purple lg block" onClick={() => setPosting(true)}>
            Post to leaderboard
          </button>
        )}
        {run.posted && (
          <button className="btn block" onClick={unpost}>
            Remove post
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
            Race this lap
          </Link>
          {route && (
            <button className="btn grow" onClick={share}>
              Share image
            </button>
          )}
        </div>
        <div className="row">
          <Link className="btn primary grow" to={`/r/${run.routeId}`}>
            Keep
          </Link>
          <button className="btn danger grow" onClick={discard}>
            Discard
          </button>
        </div>
      </div>

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
