import { bigSplits, compareLaps, sectorColour, sectorTimes, type LapProfile } from '@laptimer/timing';
import { ChevronDown, Pause, Play } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { leaderboardFrom } from '../lib/data';
import { formatDate, formatDelta, formatDistance, formatLap, formatSeconds } from '../lib/format';
import { bigEnds, bigRecords, bigRoute, distanceAt, recordsExcluding, timeAt } from '../lib/laps';
import type { Post, Route, SectorColourName } from '../lib/types';
import { DeltaGraph, SERIES, SpeedGraph } from './Charts';
import { RouteMap } from './RouteMap';
import { RouteShape } from './RouteShape';
import { Avatar, Segmented, STRIP_LABEL } from './ui';

export interface LapViewLap {
  /** Post id, or run id (a posted run's post shares its id). */
  id: string;
  username: string;
  avatarHue?: number;
  routeId: string;
  routeName: string;
  startedAt: number;
  totalMs: number;
  splitTimesMs: number[];
  penaltyMs: number;
  profile: LapProfile | null;
}

/** The lap every bar and graph is measured against. */
export interface LapReference {
  label: string;
  splitTimesMs: number[];
  totalMs: number;
  penaltyMs: number;
  profile: LapProfile | null;
}

interface Row {
  /** "S2" or "2.3" */
  name: string;
  ms: number;
  deltaMs: number | null;
  colour: SectorColourName | null;
}

/**
 * The full breakdown of one lap, measured against the lap it raced (or a
 * fallback): sectors with their minisectors, graphs, and the map. Shared by
 * posted laps and your own laps so both read the same.
 */
export function LapView({
  lap,
  colours,
  route,
  posts,
  reference,
  badges,
  caption,
  actions,
  mapExtra,
  onOpen,
  children,
}: {
  lap: LapViewLap;
  /** Minisector colours from when the lap was driven: used when there's nothing to measure against. */
  colours: (SectorColourName | null)[];
  route: Route | null;
  posts: Post[];
  reference: LapReference | null;
  /** Extra badges after the rank badge. */
  badges?: ReactNode;
  /** Shown under the time. */
  caption?: ReactNode;
  /** Buttons under the hero. */
  actions?: ReactNode;
  mapExtra?: (map: mapboxgl.Map) => void | (() => void);
  /** Called when Graphs or Map is first opened: load what only they need. */
  onOpen?: () => void;
  /** Rendered at the end. */
  children?: ReactNode;
}) {
  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const rank = board.find((r) => r.post.id === lap.id)?.rank;
  const n = lap.splitTimesMs.length;
  const ref = reference && reference.splitTimesMs.length === n ? reference : null;

  const table = useSectorTable(lap, route, posts, ref, colours);

  const miniColours = useMemo(() => table?.flatMap((t) => t.kids.map((k) => k.colour)) ?? colours, [table, colours]);
  const sectors = <SectorList table={table} refLabel={ref?.label ?? null} />;

  return (
    <>
      <Link to={`/u/${lap.username}`} className="row" style={{ gap: 10, textDecoration: 'none' }}>
        <Avatar name={lap.username} hue={lap.avatarHue} size={40} />
        <span className="grow">
          <strong>{lap.username}</strong>
          <span className="mute" style={{ display: 'block', fontSize: 14 }}>
            {formatDate(lap.startedAt)}
          </span>
        </span>
      </Link>

      <section className="lap-hero">
        {route && <RouteShape route={bigRoute(route)} colours={table?.map((t) => t.row.colour) ?? []} height={150} label={`${lap.routeName}, sectors coloured by this lap`} />}
        <Link to={`/r/${lap.routeId}`} className="lap-hero-route">
          {lap.routeName}
        </Link>
        <div className={`lap-hero-time num ${rank === 1 ? 'fastest' : ''}`}>{formatLap(lap.totalMs)}</div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
          {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>P{rank} now</span>}
          {badges}
          {lap.penaltyMs > 0 && <span className="badge red">incl. +{formatSeconds(lap.penaltyMs, 3)} jump start</span>}
        </div>
        {caption}
      </section>

      {ref && (
        <p className="lap-against">
          <span className="mute">
            Raced against <strong>{ref.label}</strong>
          </span>
          <span className="num">
            {formatLap(ref.totalMs)} <span className={lap.totalMs <= ref.totalMs ? 'faster' : 'slower'}>{formatDelta(lap.totalMs - ref.totalMs, 3)}</span>
          </span>
        </p>
      )}

      {actions}

      <LapTabs lap={lap} reference={ref} route={route} colours={miniColours} sectors={sectors} mapExtra={mapExtra} onOpen={onOpen} />

      {children}
    </>
  );
}

type SectorTableRows = { row: Row; kids: Row[] }[];

/** The 3 big sectors with their minisectors, each measured against the reference; null when the lap doesn't fit the route. */
export function useSectorTable(
  lap: Pick<LapViewLap, 'id' | 'splitTimesMs'> | null,
  route: Route | null,
  posts: Post[],
  reference: Pick<LapReference, 'splitTimesMs'> | null,
  colours: (SectorColourName | null)[],
): SectorTableRows | null {
  return useMemo(() => {
    if (!lap || !route || route.boundaries.length !== lap.splitTimesMs.length) return null;
    const n = lap.splitTimesMs.length;
    const isPublic = !!route.isPublic;
    const ref = reference && reference.splitTimesMs.length === n ? reference : null;
    const ends = bigEnds(route);
    // Purple = faster than everyone else's posted time for that (mini)sector.
    const miniRec = isPublic ? recordsExcluding(posts, n, lap.id) : null;
    const bigRec = isPublic ? bigRecords(posts, route, lap.id) : null;
    const colourOf = (ms: number, refMs: number | null, rec: number | null | undefined, fallback: SectorColourName | null) =>
      refMs == null ? fallback : isPublic ? sectorColour(ms, refMs, rec, true) : ms < refMs ? 'green' : 'yellow';
    const minis = sectorTimes(lap.splitTimesMs);
    const refMinis = ref ? sectorTimes(ref.splitTimesMs) : null;
    const big = sectorTimes(bigSplits(lap.splitTimesMs, ends));
    const refBig = ref ? sectorTimes(bigSplits(ref.splitTimesMs, ends)) : null;
    let from = 0;
    return ends.map((end, b) => {
      const kids: Row[] = [];
      for (let i = from; i <= end; i++) {
        const refMs = refMinis?.[i] ?? null;
        kids.push({ name: `${b + 1}.${i - from + 1}`, ms: minis[i], deltaMs: refMs == null ? null : minis[i] - refMs, colour: colourOf(minis[i], refMs, miniRec?.[i], colours[i] ?? null) });
      }
      from = end + 1;
      const refMs = refBig?.[b] ?? null;
      const bigColour = colourOf(big[b], refMs, bigRec?.[b], null);
      return { row: { name: `S${b + 1}`, ms: big[b], deltaMs: refMs == null ? null : big[b] - refMs, colour: bigColour } as Row, kids };
    });
  }, [route, posts, lap, reference, colours]);

}

/** Big sectors as rows of centre-out delta bars; tap one to open its minisectors. */
export function SectorList({ table, refLabel }: { table: SectorTableRows | null; refLabel: string | null }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const bigScale = Math.max(1, ...(table ?? []).map((t) => Math.abs(t.row.deltaMs ?? 0)));
  const miniScale = Math.max(1, ...(table ?? []).flatMap((t) => t.kids.map((k) => Math.abs(k.deltaMs ?? 0))));

  return !table ? (
    <p className="mute">This lap was timed on an older version of the route, so its sectors can't be shown.</p>
  ) : (
    <>
      {refLabel ? (
        <div className="dscale" aria-hidden="true">
          <span>← Faster</span>
          <span>vs {refLabel}</span>
          <span>Slower →</span>
        </div>
      ) : (
        <p className="mute small-text" style={{ marginBottom: 8 }}>
          Your first lap here: nothing to compare with yet.
        </p>
      )}
      <ol className="list sec-list">
        {table.map(({ row, kids }, b) => (
          <li key={row.name}>
            <button
              className="sec-row"
              aria-expanded={open.has(b)}
              onClick={() => setOpen((o) => (o.has(b) ? new Set([...o].filter((x) => x !== b)) : new Set(o).add(b)))}
            >
              <SecCells row={row} scale={bigScale} />
              <span className="sec-sub">
                {formatLap(row.ms)}
                {row.colour === 'purple' && refLabel ? ' · fastest ever' : ''} · {kids.length} minisectors
                <ChevronDown size={14} aria-hidden="true" className="sec-chev" />
              </span>
            </button>
            {open.has(b) && (
              <ol className="sec-minis">
                {kids.map((k) => (
                  <li key={k.name} className="sec-row mini">
                    <SecCells row={k} scale={miniScale} />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

type Tab = 'sectors' | 'graphs' | 'map';
const SPEEDS = [1, 2, 4, 8];

/**
 * Sectors / Graphs / Map for a lap measured against a reference. The cars sit
 * at one moment of the lap: scrubbing a graph, tapping the route or playing it
 * back moves them, and the map shows that moment on both tabs.
 */
export function LapTabs({
  lap,
  reference,
  route,
  colours,
  sectors,
  mapExtra,
  onOpen,
}: {
  lap: Pick<LapViewLap, 'username' | 'totalMs' | 'splitTimesMs' | 'penaltyMs' | 'profile'>;
  reference: LapReference | null;
  route: Route | null;
  /** Minisector colours for the route line. */
  colours: (SectorColourName | null)[];
  /** The Sectors tab. */
  sectors: ReactNode;
  mapExtra?: (map: mapboxgl.Map) => void | (() => void);
  onOpen?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('sectors');
  // Every map mount counts against the monthly Mapbox cap: keep one alive once shown.
  const [mapSeen, setMapSeen] = useState(false);
  /** Ms into the lap the cars are shown at; null until something moves them. */
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState<'route' | 'car' | 'ghost'>('route');

  const n = lap.splitTimesMs.length;
  const fits = !!route && route.boundaries.length === n;
  const ref = fits && reference && reference.splitTimesMs.length === n ? reference : null;
  const endT = Math.max(lap.totalMs, ref?.totalMs ?? 0);

  const cmp = useMemo(() => {
    if (!route || !ref) return null;
    try {
      return compareLaps(lap, ref, route.boundaries);
    } catch {
      return null;
    }
  }, [route, lap, ref]);

  // Play back at real speed, times the multiplier.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      setT((p) => Math.min(endT, (p ?? 0) + dt));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, endT]);
  useEffect(() => {
    if (playing && t != null && t >= endT) setPlaying(false);
  }, [playing, t, endT]);

  const boundaries = route?.boundaries ?? [];
  const carAtM = fits && t != null ? distanceAt(t, lap, boundaries, lap.profile) : null;
  const ghostAtM = ref && t != null ? distanceAt(t, ref, boundaries, ref.profile) : null;
  const scrubTo = (d: number) => {
    setPlaying(false);
    setT(timeAt(d, lap, boundaries, lap.profile));
  };
  const togglePlay = () => {
    if (!playing && (t == null || t >= endT)) setT(0);
    setPlaying(!playing);
  };

  const hasSpeed = !!lap.profile && lap.profile.speedDms.length > 1;
  const bigBoundaries = route ? bigRoute(route).boundaries : [];
  const gapAt = cmp && carAtM != null ? nearestBy(cmp.delta, carAtM)?.ms ?? null : null;
  const speedAt = cmp?.speed && carAtM != null ? nearestBy(cmp.speed, carAtM) : null;
  const ownSpeedAt = !cmp?.speed && hasSpeed && carAtM != null ? lap.profile!.speedDms[Math.min(lap.profile!.speedDms.length - 1, Math.round(carAtM / lap.profile!.stepM))] * 0.36 : null;
  // "S2.3": the minisector the car is in, numbered within its big sector.
  const sectorAt = (() => {
    if (!route || carAtM == null) return null;
    const i = Math.max(0, route.boundaries.findIndex((b) => b >= carAtM));
    const ends = bigEnds(route);
    const big = Math.max(0, ends.findIndex((e) => e >= i));
    return `S${big + 1}.${i - (big ? ends[big - 1] + 1 : 0) + 1}`;
  })();

  const readout = carAtM != null && (
    <div className="lap-readout">
      <div>
        <span>At {formatDistance(carAtM)}</span>
        <strong className="num">{sectorAt}</strong>
      </div>
      {ref && (
        <div>
          <span>Gap</span>
          <strong className={`num ${gapAt == null ? '' : gapAt <= 0 ? 'faster' : 'slower'}`}>{gapAt == null ? '—' : formatDelta(gapAt)}</strong>
        </div>
      )}
      {(speedAt || ownSpeedAt != null) && (
        <div>
          <span>Speed km/h</span>
          <strong className="num">
            <b style={{ color: SERIES.a }}>{Math.round(speedAt ? speedAt.a : ownSpeedAt!)}</b>
            {speedAt && (
              <>
                <b className="mute"> | </b>
                <b style={{ color: SERIES.b }}>{Math.round(speedAt.b)}</b>
              </>
            )}
          </strong>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="lap-tabs">
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => {
            setTab(v);
            if (v !== 'sectors' && !mapSeen) {
              setMapSeen(true);
              onOpen?.();
            }
          }}
          options={[
            { value: 'sectors', label: 'Sectors' },
            { value: 'graphs', label: 'Graphs' },
            { value: 'map', label: 'Map' },
          ]}
        />
      </div>

      {tab === 'sectors' && sectors}

      {/* One map for both tabs: small and pinned above the graphs, full size on the Map tab. */}
      {mapSeen && route && (
        <div className={tab === 'graphs' ? 'lap-pin' : ''} hidden={tab === 'sectors'}>
          <div className="map-card">
            <RouteMap
              route={route}
              colours={colours}
              height={tab === 'map' ? 360 : 190}
              extra={mapExtra}
              carAtM={carAtM}
              ghostAtM={ghostAtM}
              follow={follow === 'route' ? null : follow}
              onPick={fits ? scrubTo : undefined}
            />
          </div>
          {tab === 'graphs' && readout}
        </div>
      )}

      {tab === 'graphs' &&
        (!route || !fits ? (
          <p className="mute">No graphs for this lap.</p>
        ) : (
          <div className="stack">
            {carAtM == null && <p className="mute small-text">Slide along a graph to see that spot on the map.</p>}
            {cmp ? (
              <div className="panel chart-panel">
                <DeltaGraph data={cmp.delta} boundaries={bigBoundaries} aLabel={lap.username} bLabel={ref!.label} onScrub={scrubTo} at={carAtM} />
                {!cmp.smooth && (
                  <p className="mute small-text" style={{ marginTop: 8 }}>
                    Drawn from sector splits only: one of these laps has no 10 m profile.
                  </p>
                )}
              </div>
            ) : (
              <p className="mute">The gap graph needs a lap to compare with.</p>
            )}
            {(cmp?.speed || hasSpeed) && (
              <div className="panel chart-panel">
                <SpeedGraph
                  data={cmp?.speed ?? lap.profile!.speedDms.map((v, i) => ({ d: i * lap.profile!.stepM, a: v * 0.36, b: 0 }))}
                  boundaries={bigBoundaries}
                  aLabel={lap.username}
                  bLabel={cmp?.speed ? ref!.label : null}
                  onScrub={scrubTo}
                  at={carAtM}
                />
              </div>
            )}
          </div>
        ))}

      {tab === 'map' && route && (
        <div className="stack">
          <p className="maplegend">
            <span>
              <i className="dot car" /> {lap.username}
            </span>
            {ref && (
              <span>
                <i className="dot ghost" /> {ref.label}
              </span>
            )}
            {colours.includes('purple') && (
              <span>
                <i style={{ background: 'var(--purple)' }} /> Fastest ever
              </span>
            )}
            <span>
              <i style={{ background: 'var(--green)' }} /> Faster
            </span>
            <span>
              <i style={{ background: 'var(--yellow)' }} /> Slower
            </span>
          </p>
          {fits ? (
            <>
              <div className="play-bar">
                <button className="play-btn" aria-label={playing ? 'Pause' : 'Play the lap'} onClick={togglePlay}>
                  {playing ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
                </button>
                <span className="play-time num">{formatLap(t ?? 0)}</span>
                <label className="grow">
                  <span className="visually-hidden">Time into the lap</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.round(endT)}
                    step={100}
                    value={Math.round(t ?? 0)}
                    onChange={(e) => {
                      setPlaying(false);
                      setT(Number(e.target.value));
                    }}
                  />
                </label>
                <label>
                  <span className="visually-hidden">Playback speed</span>
                  <select className="play-speed num" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {SPEEDS.map((x) => (
                      <option key={x} value={x}>
                        {x}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Segmented
                label="Follow"
                value={follow}
                onChange={(v) => {
                  setFollow(v);
                  if (v !== 'route' && t == null) setT(0);
                }}
                options={[
                  { value: 'route', label: 'Whole route' },
                  { value: 'car', label: lap.username },
                  ...(ref ? [{ value: 'ghost' as const, label: ref.label }] : []),
                ]}
              />
              {readout || <p className="mute small-text">Press play, drag the slider or tap the route{ref ? ` to race ${ref.label}` : ''}.</p>}
            </>
          ) : (
            <p className="mute small-text">This lap was timed on an older version of the route, so it can't be played back.</p>
          )}
        </div>
      )}
    </>
  );
}

/** Name, the delta bar growing from the centre (faster left, slower right), and the delta. */
function SecCells({ row, scale }: { row: Row; scale: number }) {
  const w = row.deltaMs == null ? 0 : Math.max(2, (Math.abs(row.deltaMs) / scale) * 46);
  const faster = row.deltaMs != null && row.deltaMs < 0;
  return (
    <>
      <span className="sec-name num">{row.name}</span>
      <span className="dbar" aria-hidden="true">
        {row.deltaMs != null && <b className={`${faster ? 'gain' : 'loss'} ${row.colour === 'purple' ? 'rec' : ''}`} style={{ width: `${w}%` }} />}
      </span>
      <span className={`sec-delta num ${row.colour ?? ''}`}>
        {row.deltaMs != null ? formatDelta(row.deltaMs, 3) : formatLap(row.ms)}
        {row.colour && <span className="visually-hidden"> {STRIP_LABEL[row.colour]}</span>}
      </span>
    </>
  );
}

function nearestBy<T extends { d: number }>(pts: T[], d: number): T | null {
  let best: T | null = null;
  for (const p of pts) if (!best || Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
  return best;
}
