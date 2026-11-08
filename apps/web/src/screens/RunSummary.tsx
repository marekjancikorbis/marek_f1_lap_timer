import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { LapView, useSectorTable } from '../components/LapView';
import { Empty, errorMessage, I, Loading, ScreenHead, useToast } from '../components/ui';
import { RouteMap } from '../components/RouteMap';
import { deleteRun, getRoute, getRun, routePosts, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDelta, formatDistance, formatLap, formatSeconds } from '../lib/format';
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
  // The summary first; the full breakdown (sectors, graphs, map) behind Details.
  const [params, setParams] = useSearchParams();
  const details = params.get('view') === 'details';

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
  const table = useSectorTable(run ?? null, route, posts, against, colours);
  const pbBefore = useMemo(() => (run ? runs.filter((r) => r.valid && r.id !== run.id && r.startedAt < run.startedAt && sameSectors(r, run)).reduce<number | null>((m, r) => (m == null || r.totalMs < m ? r.totalMs : m), null) : null), [run, runs]);

  const traceLayer = useCallback(
    (map: mapboxgl.Map) => {
      if (!run?.trace?.length) return;
      const coords: [number, number][] = [];
      for (let i = 0; i + 4 < run.trace.length; i += 5) coords.push([run.trace[i + 4], run.trace[i + 3]]);
      map.addSource('trace', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'trace', type: 'line', source: 'trace', paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [1, 2] } });
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
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back />
        <Empty title="Lap not found">It may have been deleted, or it&rsquo;s still syncing.</Empty>
      </main>
    );

  const canPost = route?.isPublic && !route.hidden && run.valid && !run.replay;

  const gap = against && !run.partial && !against.partial ? run.totalMs - against.totalMs : null;
  const newPb = run.valid && !run.replay && (pbBefore == null || run.totalMs < pbBefore);
  const INK: Record<string, string> = { purple: 'var(--s-p)', green: 'var(--s-g)', yellow: 'var(--s-y)' };
  const quiet = { background: 'color-mix(in srgb, var(--ink) 10%, transparent)' };
  const status = newPb
    ? 'New best'
    : run.replay
      ? 'Simulated'
      : notCounted(run)
        ? notCounted(run)
        : stage
          ? `${run.routeName} · stage`
          : `Lap ${run.lap + 1}${session.length > 1 ? ` of ${session.length}` : ''}`;

  if (!details)
    return (
      <main className="ph fixed result">
        <div className="map">{route && <RouteMap route={route} height="100%" padding={{ top: 130, bottom: 420, left: 40, right: 40 }} extra={traceLayer} />}</div>
        <div className="edge" />
        <div className="sb" />
        <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between' }}>
          <Link to={`/r/${run.routeId}`} className="glass ib" aria-label="Close">
            <I n="x" />
          </Link>
          {route && !run.partial && (
            <button className="glass ib" aria-label="Share as an image" onClick={share}>
              <I n="share" />
            </button>
          )}
        </div>
        <div className="glass sheet sheet-b result-sheet" style={{ paddingTop: 22, bottom: 'calc(8px + var(--safe-b))' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className={`chip${newPb ? ' acc' : ''}`} style={{ background: newPb ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : quiet.background }}>
              {status}
            </span>
            {run.posted && <span className="chip" style={quiet}>Posted</span>}
            {run.penaltyMs > 0 && <span className="chip" style={{ background: 'color-mix(in srgb, #ff5a5f 20%, transparent)', color: '#ff9a9d' }}>+{formatSeconds(run.penaltyMs, 0)}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12, gap: 12 }}>
            <span className="t" style={{ fontSize: 64 }}>{run.partial ? formatDistance(route?.boundaries[run.splitTimesMs.length - 1] ?? 0) : formatLap(run.totalMs)}</span>
            {gap != null && (
              <span className="t" style={{ fontSize: 24, color: gap <= 0 ? 'var(--s-g)' : 'var(--s-y)' }} aria-label={`${formatDelta(gap, 2)} versus ${against!.label}`}>
                {formatDelta(gap, 2)}
              </span>
            )}
          </div>
          {table && (
            <div className="rows" style={{ marginTop: 10 }}>
              {table.map((t) => (
                <div key={t.row.name} style={{ gridTemplateColumns: '12px 1fr auto 60px' }}>
                  <span className="dot" style={{ background: t.row.colour ? INK[t.row.colour] : 'color-mix(in srgb, var(--ink) 20%, transparent)' }} />
                  <span className="lbl">{t.row.name}</span>
                  <span className="t" style={{ fontSize: 19 }}>{t.row.ms != null ? formatLap(t.row.ms) : '–'}</span>
                  <span className="t" style={{ fontSize: 15, textAlign: 'right', color: t.row.colour ? INK[t.row.colour] : 'var(--ink-2)' }}>
                    {t.row.deltaMs != null ? formatDelta(t.row.deltaMs, 2) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!run.valid && (
            <p className="lbl" style={{ marginTop: 10 }}>
              {run.partial ? 'The GPS signal dropped out before the finish.' : `No GPS signal for ${formatSeconds(run.gpsGapMs ?? 0, 0)}.`} It can be compared but can&rsquo;t be posted or set a best.
            </p>
          )}
          {session.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 12, paddingBottom: 2 }} aria-label="This session">
              {session.map((r) => (
                <Link key={r.id} to={`/run/${r.id}`} replace className="chip" aria-current={r.id === run.id} style={r.id === run.id ? { background: 'var(--main)', color: 'var(--on-main)' } : quiet}>
                  {r.lap + 1} · {r.partial ? '–' : formatLap(r.totalMs)}
                </Link>
              ))}
            </div>
          )}
          {stage && run.valid && <StageCompare run={run} prev={prev} userId={profile.id} posts={route?.isPublic ? posts : []} />}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Link className="solid quiet" to={`/drive/${run.routeId}${run.referenceRef ? `?ref=${run.referenceRef}` : ''}`}>
              Again
            </Link>
            {canPost && !run.posted ? (
              <button className="solid" onClick={() => setPosting(true)}>
                Post
              </button>
            ) : (
              <button className="solid" onClick={() => setParams({ view: 'details' })}>
                Details
              </button>
            )}
          </div>
          <div className="lbl" style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 12 }}>
            {canPost && !run.posted && <button onClick={() => setParams({ view: 'details' })}>Details</button>}
            <Link to={`/r/${run.routeId}/history`}>All my times</Link>
            <button onClick={discard} style={{ color: '#ff9a9d' }}>
              Discard
            </button>
          </div>
        </div>

        {route && <PostSheet open={posting} onClose={() => setPosting(false)} run={run} route={route} myRuns={runs} onPosted={() => setRun({ ...run, posted: true })} />}
      </main>
    );

  return (
    <main className="ph soft col">
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
            {session.length > 1 && <span>Lap {run.lap + 1}</span>}
            {run.replay && <span>Simulated</span>}
            {run.posted && <span>Posted</span>}
            {notCounted(run) && <span>{notCounted(run)}</span>}
          </>
        }
        caption={
          <>
            <p className="lbl">
              GPS ±{run.gpsAvgAccuracyM} m · {run.gpsRateHz} Hz
              {run.jumpDistanceM != null && ` · moved ${run.jumpDistanceM} m before GO`}
            </p>
            {!run.valid && (
              <p className="lbl">
                {run.partial
                  ? `Stopped before the finish${run.splitTimesMs.length ? ` after ${run.splitTimesMs.length} of ${route?.boundaries.length ?? '?'} minisectors` : ''}.`
                  : `No GPS signal for ${formatSeconds(run.gpsGapMs ?? 0, 0)}.`}{' '}
                It can be compared but can't be posted or set a best.
              </p>
            )}
          </>
        }
        actions={
          <div style={{ display: 'grid', gap: 10 }}>
            {canPost && !run.posted && (
              <button className="solid" onClick={() => setPosting(true)}>
                Post to leaderboard
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              {run.referenceRef && (
                <Link className="solid quiet" to={`/compare/${run.routeId}?a=run:${run.id}&b=${run.referenceRef}`}>
                  Compare
                </Link>
              )}
              <Link className={canPost && !run.posted ? 'solid quiet' : 'solid'} to={`/drive/${run.routeId}?ref=run:${run.id}`}>
                Race again
              </Link>
            </div>
          </div>
        }
      >
        <div className="lbl" style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 22 }}>
          {route && !run.partial && <button onClick={share}>Share image</button>}
          {run.posted && <button onClick={unpost}>Remove post</button>}
          {run.replay && route?.isPublic && <span>Simulated laps can&rsquo;t be posted</span>}
        </div>
      </LapView>

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
    <div className="rows" style={{ marginTop: 6 }}>
      {prev && (
        <div style={{ gridTemplateColumns: '1fr auto' }}>
          <div>
            <b>Your best before</b>
            <div className="lbl">
              {formatLap(prev.totalMs)} · {formatDate(prev.startedAt)}
            </div>
          </div>
          <span className="t" style={{ fontSize: 19, color: run.totalMs <= prev.totalMs ? 'var(--s-g)' : 'var(--s-y)' }}>{formatDelta(run.totalMs - prev.totalMs, 2)}</span>
        </div>
      )}
      {record && (
        <div style={{ gridTemplateColumns: '1fr auto' }}>
          <div>
            <b>Route record</b>
            <div className="lbl">
              {record.username} · {formatLap(record.totalMs)}
            </div>
          </div>
          <span className="t" style={{ fontSize: 19, color: run.totalMs <= record.totalMs ? 'var(--s-p)' : 'var(--s-y)' }}>{formatDelta(run.totalMs - record.totalMs, 2)}</span>
        </div>
      )}
      {record && !run.replay && (
        <div style={{ gridTemplateColumns: '1fr auto' }}>
          <b>{run.posted ? 'Leaderboard' : 'Leaderboard if posted'}</b>
          <span className="t" style={{ fontSize: 19 }}>
            P{place} of {bestBy.size + 1}
          </span>
        </div>
      )}
    </div>
  );
}
