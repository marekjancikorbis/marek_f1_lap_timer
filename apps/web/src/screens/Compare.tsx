import { compareLaps, type LapComparison, type LapProfile } from '@laptimer/timing';
import type mapboxgl from 'mapbox-gl';
import { ArrowLeftRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DeltaGraph, SERIES, SpeedGraph } from '../components/Charts';
import { setSource } from '../components/MapView';
import { RouteMap } from '../components/RouteMap';
import { SectorTable } from '../components/SectorTable';
import { Empty, errorMessage, Loading, ScreenHead, Sheet } from '../components/ui';
import { getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { preparedFor, sectorLines } from '../lib/geo';
import { resolveLap, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Route, Run } from '../lib/types';

export default function Compare() {
  const { routeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { profile } = useMe();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [a, setA] = useState<ResolvedLap | null | undefined>(undefined);
  const [b, setB] = useState<ResolvedLap | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aRef = params.get('a') ?? 'best';
  const bRef = params.get('b') ?? 'record';

  useEffect(() => {
    (async () => {
      const r = await getRoute(routeId);
      setRoute(r);
      if (!r) return;
      const [p, mine] = await Promise.all([r.isPublic ? routePosts(r.id).catch(() => []) : [], runsForRoute(profile.id, r.id).catch(() => [])]);
      setPosts(p);
      setRuns(mine.filter((x) => x.valid));
    })().catch((e) => setError(errorMessage(e)));
  }, [routeId, profile.id]);

  useEffect(() => {
    setA(undefined);
    resolveLap(aRef, profile.id, routeId).then(setA).catch(() => setA(null));
  }, [aRef, profile.id, routeId]);
  useEffect(() => {
    setB(undefined);
    resolveLap(bRef, profile.id, routeId).then(setB).catch(() => setB(null));
  }, [bRef, profile.id, routeId]);

  const records = useMemo(() => (route ? sectorRecordsFrom(posts, route.boundaries.length) : []), [posts, route]);

  const cmp: LapComparison | null = useMemo(() => {
    if (!route || !a || !b) return null;
    try {
      return compareLaps(a, b, route.boundaries, records);
    } catch {
      return null;
    }
  }, [route, a, b, records]);

  const label = (l: ResolvedLap) => (l.username ? l.username : l.label === 'Your lap' ? `You ${l.sub}` : l.label);

  if (route === undefined || a === undefined || b === undefined) return <Loading />;
  if (!route)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Route not available" />
      </main>
    );
  if (!a || !b || !cmp)
    return (
      <main className="screen">
        <ScreenHead back title="Compare" />
        <Empty title="Nothing to compare yet">
          {!a ? "One of the laps isn't available. " : ''}
          {aRef === 'best' && !a ? 'Your theoretical best needs at least one lap on this route. ' : ''}
          Drive this route to compare against it.
        </Empty>
        {error && <p className="notice error">{error}</p>}
      </main>
    );

  const aLabel = label(a);
  const bLabel = label(b);

  return (
    <main className="screen">
      <ScreenHead
        back
        title="Compare"
        right={
          <button className="icon-btn" aria-label="Swap A and B" onClick={() => setParams({ a: bRef, b: aRef }, { replace: true })}>
            <ArrowLeftRight size={22} />
          </button>
        }
      />
      <p className="mute" style={{ marginTop: -8 }}>
        {route.name}
      </p>

      <section className="cmp-head">
        <LapHead lap={a} label={aLabel} colour={SERIES.a} tag="A" />
        <div className={`cmp-gap num ${cmp.gapMs < 0 ? 'a' : cmp.gapMs > 0 ? 'b' : ''}`}>
          {formatDelta(cmp.gapMs, 3)}
          <small>{cmp.gapMs < 0 ? `${aLabel} faster` : cmp.gapMs > 0 ? `${bLabel} faster` : 'Dead heat'}</small>
        </div>
        <LapHead lap={b} label={bLabel} colour={SERIES.b} tag="B" onChange={() => setPicker(true)} />
      </section>

      {/* The delta line owns this screen. */}
      <h2 className="section-title">Where the time went</h2>
      <div className="panel chart-panel">
        <DeltaGraph data={cmp.delta} boundaries={route.boundaries} aLabel={aLabel} bLabel={bLabel} />
        {!cmp.smooth && <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>Drawn from sector splits only: one of these laps has no 10 m profile.</p>}
      </div>

      <h2 className="section-title">Sectors</h2>
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <SectorTable rows={cmp.sectors} aLabel={aLabel} bLabel={bLabel} />
      </div>

      {cmp.speed && (
        <>
          <h2 className="section-title">Speed</h2>
          <div className="panel chart-panel">
            <SpeedGraph data={cmp.speed} boundaries={route.boundaries} aLabel={aLabel} bLabel={bLabel} />
          </div>
        </>
      )}

      <h2 className="section-title">On the map</h2>
      <GhostMap route={route} a={a} b={b} cmp={cmp} />

      <Sheet open={picker} onClose={() => setPicker(false)} label="Compare with">
        <LapPicker
          route={route}
          runs={runs}
          posts={posts}
          exclude={aRef}
          onPick={(ref) => {
            setParams({ a: aRef, b: ref }, { replace: true });
            setPicker(false);
          }}
        />
      </Sheet>
    </main>
  );
}

function LapHead({ lap, label, colour, tag, onChange }: { lap: ResolvedLap; label: string; colour: string; tag: string; onChange?: () => void }) {
  return (
    <div className="cmp-lap">
      <span className="cmp-tag" style={{ background: colour }}>
        {tag}
      </span>
      <strong className="ellipsis">{label}</strong>
      <span className="num cmp-total">{formatLap(lap.totalMs)}</span>
      <span className="mute" style={{ fontSize: 12 }}>
        {lap.penaltyMs > 0 && `incl. +${formatSeconds(lap.penaltyMs)} jump start`}
      </span>
      {onChange && (
        <button className="btn sm ghost" onClick={onChange}>
          Change
        </button>
      )}
    </div>
  );
}

/** Position along the route at elapsed time t, from the profile or the splits. */
function distanceAt(t: number, lap: ResolvedLap, boundaries: number[], profile: LapProfile | null): number {
  const pen = lap.penaltyMs;
  if (profile && profile.elapsedMs.length > 1) {
    const e = profile.elapsedMs;
    const tt = t - pen;
    if (tt <= 0) return 0;
    for (let i = 1; i < e.length; i++) {
      if (e[i] >= tt) {
        const f = (tt - e[i - 1]) / Math.max(1, e[i] - e[i - 1]);
        return (i - 1 + f) * profile.stepM;
      }
    }
    return boundaries[boundaries.length - 1];
  }
  const pts = [0, ...lap.splitTimesMs];
  const ds = [0, ...boundaries];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] >= t) return ds[i - 1] + ((t - pts[i - 1]) / Math.max(1, pts[i] - pts[i - 1])) * (ds[i] - ds[i - 1]);
  }
  return ds[ds.length - 1];
}

function GhostMap({ route, a, b, cmp }: { route: Route; a: ResolvedLap; b: ResolvedLap; cmp: LapComparison }) {
  const maxT = Math.max(a.totalMs, b.totalMs);
  const [t, setT] = useState(0);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const prepared = useMemo(() => preparedFor(route), [route]);

  const ghosts = useCallback(
    (time: number): GeoJSON.FeatureCollection => {
      const pa = prepared.pointAt(distanceAt(time, a, route.boundaries, a.profile));
      const pb = prepared.pointAt(distanceAt(time, b, route.boundaries, b.profile));
      return {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { c: SERIES.b }, geometry: { type: 'Point', coordinates: [pb.lon, pb.lat] } },
          { type: 'Feature', properties: { c: SERIES.a }, geometry: { type: 'Point', coordinates: [pa.lon, pa.lat] } },
        ],
      };
    },
    [a, b, prepared, route.boundaries],
  );

  const extra = useCallback(
    (map: mapboxgl.Map) => {
      mapRef.current = map;
      // Recolour each sector by who was faster there.
      const lines = sectorLines(route, 8);
      setSource(map, 'sectors', {
        type: 'FeatureCollection',
        features: lines.map((l, i) => ({
          type: 'Feature',
          properties: { color: cmp.sectors[i]?.faster === 'b' ? SERIES.b : SERIES.a },
          geometry: { type: 'LineString', coordinates: l.map((p) => [p.lng, p.lat]) },
        })),
      });
      map.addSource('ghosts', { type: 'geojson', data: ghosts(0) });
      map.addLayer({
        id: 'ghosts',
        type: 'circle',
        source: 'ghosts',
        paint: { 'circle-radius': 8, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#16181a', 'circle-stroke-width': 2 },
      });
      return () => {
        mapRef.current = null;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource('ghosts')) setSource(map, 'ghosts', ghosts(t));
  }, [t, ghosts]);

  const da = distanceAt(t, a, route.boundaries, a.profile);
  const db2 = distanceAt(t, b, route.boundaries, b.profile);

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <RouteMap route={route} height={280} extra={extra} />
      <div style={{ padding: 16 }}>
        <label className="field">
          <span className="row between">
            <span>Ghosts at</span>
            <strong className="num" style={{ fontSize: 18 }}>
              {formatLap(t)}
            </strong>
          </span>
          <input type="range" min={0} max={maxT} step={100} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Time into the lap" />
        </label>
        <p className="mute num" style={{ fontSize: 14, marginTop: 6 }}>
          {Math.abs(da - db2) < 1 ? 'Side by side' : `${da > db2 ? 'A' : 'B'} leads by ${Math.round(Math.abs(da - db2))} m`}
        </p>
        <p className="mute" style={{ fontSize: 13, marginTop: 4 }}>
          Route coloured by who was faster in each sector.
        </p>
      </div>
    </div>
  );
}

function LapPicker({ route, runs, posts, exclude, onPick }: { route: Route; runs: Run[]; posts: Post[]; exclude: string; onPick: (ref: string) => void }) {
  const board = leaderboardFrom(posts);
  const item = (ref: string, title: string, sub: string, ms: number | null) =>
    ref === exclude ? null : (
      <button key={ref} className="ref-option" onClick={() => onPick(ref)}>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{title}</strong>
          <span className="mute ellipsis" style={{ display: 'block', fontSize: 13 }}>
            {sub}
          </span>
        </span>
        {ms != null && <span className="num" style={{ fontSize: 20 }}>{formatLap(ms)}</span>}
      </button>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h2>Compare with</h2>
      {runs.length > 0 && item('best', 'Your theoretical best', 'Best time in each sector', null)}
      {posts.length > 0 && item('record', 'Route record', 'All purple sectors', null)}
      {[...runs]
        .sort((x, y) => x.totalMs - y.totalMs)
        .slice(0, 10)
        .map((r) => item(`run:${r.id}`, 'Your lap', formatDate(r.startedAt), r.totalMs))}
      {board.slice(0, 20).map(({ rank, post }) => item(`post:${post.id}`, `P${rank} ${post.username}`, post.car ?? formatDate(post.startedAt), post.totalMs))}
      {!runs.length && !posts.length && <p className="mute">No other laps on {route.name} yet.</p>}
    </div>
  );
}
