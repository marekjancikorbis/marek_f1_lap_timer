import { compareLaps, fitsBoundaries, sectorColour, sectorTimes, type LapProfile } from '@laptimer/timing';
import { ChevronLeft, MoreHorizontal, Pause, Play } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { leaderboardFrom } from '../lib/data';
import { formatDate, formatDelta, formatDistance, formatLap, formatSeconds } from '../lib/format';
import { bigEnds, bigRecords, bigRoute, distanceAt, recordsExcluding, timeAt } from '../lib/laps';
import type { Post, Route, SectorColourName } from '../lib/types';
import { DeltaGraph, SERIES, SpeedGraph } from './Charts';
import { RouteMap } from './RouteMap';
import { RouteShape } from './RouteShape';
import { Avatar, Segmented, Sheet, STRIP_LABEL, UserName } from './ui';

export interface LapViewLap {
  /** Post id, or run id (a posted run's post shares its id). */
  id: string;
  username: string;
  /** The driver, for their photo and current name. */
  userId?: string;
  avatarHue?: number;
  routeId: string;
  routeName: string;
  startedAt: number;
  totalMs: number;
  splitTimesMs: number[];
  penaltyMs: number;
  profile: LapProfile | null;
  /** Stopped before the finish: splits cover only the gates crossed. */
  partial?: boolean;
}

/** The lap every bar and graph is measured against. */
export interface LapReference {
  label: string;
  splitTimesMs: number[];
  totalMs: number;
  penaltyMs: number;
  profile: LapProfile | null;
  partial?: boolean;
}

/** The reference when it was timed on the same version of the route as the lap. */
function sameRouteRef<R extends Pick<LapReference, 'splitTimesMs' | 'partial'>>(
  lap: Pick<LapViewLap, 'splitTimesMs' | 'partial'>,
  ref: R | null,
  route: Pick<Route, 'boundaries'> | null,
): R | null {
  if (!ref) return null;
  if (route) return fitsBoundaries(lap, route.boundaries) && fitsBoundaries(ref, route.boundaries) ? ref : null;
  return !lap.partial && !ref.partial && ref.splitTimesMs.length === lap.splitTimesMs.length ? ref : null;
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
  menu,
  meta,
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
  /** Less used actions, behind the bar's more button. */
  menu?: ReactNode;
  /** Added to the route and date line, e.g. the car. */
  meta?: string | null;
  mapExtra?: (map: mapboxgl.Map) => void | (() => void);
  /** Called when Graphs or Map is first opened: load what only they need. */
  onOpen?: () => void;
  /** Rendered at the end. */
  children?: ReactNode;
}) {
  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const rank = board.find((r) => r.post.id === lap.id)?.rank;
  const ref = sameRouteRef(lap, reference, route);
  const nav = useNavigate();
  const [more, setMore] = useState(false);

  const table = useSectorTable(lap, route, posts, ref, colours);

  const miniColours = useMemo(() => table?.flatMap((t) => t.kids.map((k) => k.colour)) ?? colours, [table, colours]);
  const sectors = <SectorList table={table} refLabel={ref?.label ?? null} />;

  return (
    <>
      {/* The navy panel: back, who drove it, the time, what it raced, and the actions. */}
      <section className="top-panel navy lap-panel">
        <span className="livery thin" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="lap-panel-bar">
          <button className="icon-btn back" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
            <ChevronLeft size={26} />
          </button>
          {menu && (
            <button className="icon-btn" aria-label="More" onClick={() => setMore(true)}>
              <MoreHorizontal size={22} />
            </button>
          )}
        </div>
        <div className="lap-panel-body">
          <Link to={`/u/${lap.username}`} className="row" style={{ gap: 12, textDecoration: 'none' }}>
            <Avatar name={lap.username} hue={lap.avatarHue} size={44} uid={lap.userId} />
            <span className="grow" style={{ minWidth: 0 }}>
              <strong>{lap.userId ? <UserName uid={lap.userId} fallback={lap.username} /> : lap.username}</strong>
              <span className="mute small-text ellipsis">
                {lap.routeName} · {new Date(lap.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {meta && ` · ${meta}`}
              </span>
            </span>
          </Link>
          <div className="row wrap" style={{ gap: 10, alignItems: 'baseline', marginTop: 12 }}>
            <span className="num lap-panel-time">{formatLap(lap.totalMs)}</span>
            {rank && <span className={`badge ${rank === 1 ? 'purple' : ''}`}>{rank === 1 ? 'Route record' : `P${rank} now`}</span>}
            {badges}
            {lap.penaltyMs > 0 && <span className="badge red">incl. +{formatSeconds(lap.penaltyMs, 3)}</span>}
          </div>
          {ref && (
            <p className="mute small-text" style={{ marginTop: 4 }}>
              vs {ref.label} {formatLap(ref.totalMs)}
              {!lap.partial && !ref.partial && (
                <>
                  {' · '}
                  <strong className={lap.totalMs <= ref.totalMs ? 'faster' : 'slower'}>
                    {formatDelta(Math.abs(lap.totalMs - ref.totalMs), 2).replace(/^[+−-]/, '')} {lap.totalMs <= ref.totalMs ? 'faster' : 'slower'}
                  </strong>
                </>
              )}
            </p>
          )}
          {caption}
          {actions}
        </div>
      </section>

      <LapTabs lap={lap} reference={ref} route={route} colours={miniColours} sectors={sectors} mapExtra={mapExtra} onOpen={onOpen} />
      {menu && (
        <Sheet open={more} onClose={() => setMore(false)} label="More">
          <div className="stack" onClick={() => setMore(false)}>
            {menu}
          </div>
        </Sheet>
      )}

      {children}
    </>
  );
}

type SectorTableRows = { row: Row; kids: Row[] }[];

/**
 * The 3 big sectors with their minisectors, each measured against the reference; null when the lap doesn't fit the route.
 * A partial lap has only the sectors it got to, the last perhaps with only some of its minisectors.
 */
export function useSectorTable(
  lap: Pick<LapViewLap, 'id' | 'splitTimesMs' | 'partial'> | null,
  route: Route | null,
  posts: Post[],
  reference: Pick<LapReference, 'splitTimesMs' | 'partial'> | null,
  colours: (SectorColourName | null)[],
): SectorTableRows | null {
  return useMemo(() => {
    if (!lap || !route || !fitsBoundaries(lap, route.boundaries)) return null;
    const n = route.boundaries.length;
    const isPublic = !!route.isPublic;
    const ref = sameRouteRef(lap, reference, route);
    const ends = bigEnds(route);
    // Purple = faster than everyone else's posted time for that (mini)sector.
    const miniRec = isPublic ? recordsExcluding(posts, n, lap.id) : null;
    const bigRec = isPublic ? bigRecords(posts, route, lap.id) : null;
    const colourOf = (ms: number, refMs: number | null, rec: number | null | undefined, fallback: SectorColourName | null) =>
      refMs == null ? fallback : isPublic ? sectorColour(ms, refMs, rec, true) : ms < refMs ? 'green' : 'yellow';
    const minis = sectorTimes(lap.splitTimesMs);
    const refMinis = ref ? sectorTimes(ref.splitTimesMs) : null;
    /** Time from minisector a to b, when the lap got that far. */
    const span = (xs: number[] | null, a: number, b: number) => (xs && b < xs.length ? xs.slice(a, b + 1).reduce((x, y) => x + y, 0) : null);
    const rows: SectorTableRows = [];
    let from = 0;
    for (const [b, end] of ends.entries()) {
      if (from >= minis.length) break;
      const kids: Row[] = [];
      for (let i = from; i <= end && i < minis.length; i++) {
        const refMs = refMinis?.[i] ?? null;
        kids.push({ name: `${b + 1}.${i - from + 1}`, ms: minis[i], deltaMs: refMs == null ? null : minis[i] - refMs, colour: colourOf(minis[i], refMs, miniRec?.[i], colours[i] ?? null) });
      }
      // A big sector the lap didn't finish: its minisectors so far, with no verdict on the whole.
      const ms = span(minis, from, end);
      const refMs = ms == null ? null : span(refMinis, from, end);
      const row: Row = ms == null
        ? { name: `S${b + 1}`, ms: kids.reduce((x, k) => x + k.ms, 0), deltaMs: null, colour: null }
        : { name: `S${b + 1}`, ms, deltaMs: refMs == null ? null : ms - refMs, colour: colourOf(ms, refMs, bigRec?.[b], null) };
      rows.push({ row, kids });
      from = end + 1;
    }
    return rows;
  }, [route, posts, lap, reference, colours]);

}

/**
 * Big sectors as rows of centre-out delta bars; tap one to open its minisectors.
 * Compare passes the total gap and "A" to label the scale A faster / A slower.
 */
export function SectorList({ table, refLabel, totalMs, who }: { table: SectorTableRows | null; refLabel: string | null; totalMs?: number | null; who?: string }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const bigScale = Math.max(1, ...(table ?? []).map((t) => Math.abs(t.row.deltaMs ?? 0)));

  return !table ? (
    <p className="mute">This lap was timed on an older version of the route, so its sectors can't be shown.</p>
  ) : !table.length ? (
    <p className="mute">The lap stopped before the first sector ended. The graphs and map show what was recorded.</p>
  ) : (
    <>
      {!refLabel && (
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
              aria-label={`${row.name}, ${kids.length} minisectors`}
              onClick={() => setOpen((o) => (o.has(b) ? new Set([...o].filter((x) => x !== b)) : new Set(o).add(b)))}
            >
              <SecCells row={row} scale={bigScale} />
              {open.has(b) && (
                <>
                  <span className="sec-minis" aria-label={kids.map((k) => `${k.name} ${k.colour ? STRIP_LABEL[k.colour] : 'no time'}`).join(', ')}>
                    {kids.map((k) => (
                      <i key={k.name} className={k.colour ?? ''} />
                    ))}
                  </span>
                  <span className="sec-sub">
                    {formatLap(row.ms)}
                    {row.colour === 'purple' && refLabel ? ' · fastest ever' : ''} · {kids.length} minisectors
                  </span>
                </>
              )}
            </button>
          </li>
        ))}
        {totalMs != null && (
          <li className="sec-total">
            <strong>Total</strong>
            <span className={`num ${totalMs < 0 ? 'green' : totalMs > 0 ? 'yellow' : ''}`}>{formatDelta(totalMs, 2)}</span>
          </li>
        )}
      </ol>
      {refLabel && (
        <div className="dscale" aria-hidden="true">
          <span>← {who ? `${who} faster` : 'Faster'}</span>
          <span>{who ? `${who} slower` : 'Slower'} →</span>
        </div>
      )}
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
  lap: Pick<LapViewLap, 'username' | 'totalMs' | 'splitTimesMs' | 'penaltyMs' | 'profile' | 'partial'>;
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
  const strip = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  // Every map mount counts against the monthly Mapbox cap: keep one alive once shown.
  const [mapSeen, setMapSeen] = useState(false);
  /** Ms into the lap the cars are shown at; null until something moves them. */
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState<'route' | 'car' | 'ghost'>('route');

  const fits = !!route && fitsBoundaries(lap, route.boundaries);
  const ref = fits ? sameRouteRef(lap, reference, route) : null;
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
      {/* On Graphs and Map the tabs become the screen's header: back, driver and time, then the tabs. */}
      <div ref={strip} className={tab === 'sectors' ? 'lap-tabs' : `lap-strip ${tab === 'map' ? 'over-map' : ''}`}>
        {tab !== 'sectors' && (
          <header className="screen-head">
            <div className="row grow">
              <button className="icon-btn back" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
                <ChevronLeft size={26} />
              </button>
              <h1 className="ellipsis">
                {lap.username} · <span className="num">{formatLap(lap.totalMs)}</span>
              </h1>
            </div>
          </header>
        )}
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => {
            setTab(v);
            if (v !== 'sectors' && !mapSeen) {
              setMapSeen(true);
              onOpen?.();
            }
            // Bring the new header to the top of the screen.
            if (v !== 'sectors') requestAnimationFrame(() => strip.current?.scrollIntoView({ block: 'start' }));
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
        <div hidden={tab !== 'map'} className="lap-map-full">
          <div className="map-card">
            <RouteMap
              route={route}
              colours={colours}
              height="100dvh"
              extra={mapExtra}
              carAtM={carAtM}
              ghostAtM={ghostAtM}
              follow={follow === 'route' ? null : follow}
              onPick={fits ? scrubTo : undefined}
            />
          </div>
        </div>
      )}

      {tab === 'graphs' &&
        (!route || !fits ? (
          <p className="mute">No graphs for this lap.</p>
        ) : (
          <div className="stack">
            {readout}
            {cmp ? (
              <div className="panel chart-panel">
                <span className="cap">Gap</span>
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
                <span className="cap">Speed km/h</span>
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
        <>
          <p className="maplegend over-map">
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
          <div className="map-sheet">
            <span className="grabber" aria-hidden="true" />
            {fits ? (
              <>
                <div className="play-bar">
                  <button className="btn primary play-btn" aria-label={playing ? 'Pause' : 'Play the lap'} onClick={togglePlay}>
                    {playing ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
                  </button>
                  <label className="grow play-track">
                    <span className="play-line">
                      <span className="num play-time">{formatLap(t ?? 0)}</span>
                      {gapAt != null && <strong className={gapAt <= 0 ? 'faster' : 'slower'}>{formatDelta(gapAt)}</strong>}
                    </span>
                    <span className="visually-hidden">Time into the lap</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.round(endT)}
                      step={100}
                      value={Math.round(t ?? 0)}
                      style={{ ['--p' as string]: `${((t ?? 0) / Math.max(1, endT)) * 100}%` }}
                      onChange={(e) => {
                        setPlaying(false);
                        setT(Number(e.target.value));
                      }}
                    />
                  </label>
                  <label>
                    <span className="visually-hidden">Playback speed</span>
                    <select className="badge outline play-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                      {SPEEDS.map((x) => (
                        <option key={x} value={x}>
                          {x}×
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mute small-text" style={{ marginTop: 10 }}>
                  Navy dot: {lap.username}
                  {ref && ` · light dot: ${ref.label}`}
                </p>
                <div style={{ marginTop: 10 }}>
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
                </div>
              </>
            ) : (
              <p className="mute small-text">This lap was timed on an older version of the route, so it can't be played back.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Name, the delta bar growing from the centre (faster left, slower right), and the delta. */
function SecCells({ row, scale }: { row: Row; scale: number }) {
  const w = row.deltaMs == null ? 0 : Math.max(2, (Math.abs(row.deltaMs) / scale) * 50);
  const faster = row.deltaMs != null && row.deltaMs < 0;
  return (
    <>
      <span className="sec-name">{row.name}</span>
      <span className="dbar" aria-hidden="true">
        {row.deltaMs != null && <b className={`${faster ? 'gain' : 'loss'} ${row.colour === 'purple' ? 'rec' : ''}`} style={{ width: `${w}%` }} />}
      </span>
      <span className={`sec-delta num ${row.colour ?? ''}`}>
        {row.deltaMs != null ? formatDelta(row.deltaMs, 2) : formatLap(row.ms)}
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
