import { compareLaps, fitsBoundaries, sectorColour, sectorTimes, type LapProfile } from '@laptimer/timing';
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
import { Avatar, I, SectorStrip, Segmented, Sheet, STRIP_LABEL, UserName } from './ui';

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

  const day = new Date(lap.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const who = lap.userId ? <UserName uid={lap.userId} fallback={lap.username} /> : lap.username;
  const status = rank === 1 ? 'Record' : rank ? `P${rank}` : null;
  const hero = (
    <>
      <Link to={`/u/${lap.username}`} style={{ padding: '16px 20px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar name={lap.username} hue={lap.avatarHue} size={48} uid={lap.userId} />
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 18 }}>{who}</b>
          <div className="lbl ellipsis">
            {lap.routeName} · {day}
            {meta && ` · ${meta}`}
          </div>
        </div>
      </Link>
      <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className={`t${rank === 1 ? ' acc' : ''}`} style={{ fontSize: 64 }}>{formatLap(lap.totalMs)}</span>
        {status && <span className="lbl">{status}</span>}
        {lap.penaltyMs > 0 && <span className="lbl" style={{ color: '#ff9a9d' }}>incl. +{formatSeconds(lap.penaltyMs, 3)}</span>}
      </div>
      {(badges || ref) && (
        <div className="lbl" style={{ padding: '4px 20px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {ref && (
            <span>
              vs {ref.label} {formatLap(ref.totalMs)}
              {!lap.partial && !ref.partial && (
                <span style={{ color: lap.totalMs <= ref.totalMs ? 'var(--s-g)' : 'var(--s-y)' }}> · {formatDelta(lap.totalMs - ref.totalMs, 2)}</span>
              )}
            </span>
          )}
          {badges}
        </div>
      )}
      {caption && <div style={{ padding: '8px 20px 0' }}>{caption}</div>}
    </>
  );

  return (
    <>
      <LapTabs
        lap={lap}
        reference={ref}
        route={route}
        colours={miniColours}
        sectors={sectors}
        mapExtra={mapExtra}
        onOpen={onOpen}
        hero={hero}
        who={who}
        rankOne={rank === 1}
        onMore={menu ? () => setMore(true) : undefined}
        actions={actions}
      >
        {children}
      </LapTabs>
      {menu && (
        <Sheet open={more} onClose={() => setMore(false)} label="More">
          <div style={{ display: 'grid', gap: 10 }} onClick={() => setMore(false)}>
            {menu}
          </div>
        </Sheet>
      )}
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

  return (
    <div className="glass lift" style={{ margin: '14px 16px 0', borderRadius: 28, padding: '18px 20px', display: 'grid', gap: 16 }}>
      {!table ? (
        <p className="lbl">This lap was timed on an older version of the route, so its sectors can&rsquo;t be shown.</p>
      ) : !table.length ? (
        <p className="lbl">The lap stopped before the first sector ended. The graphs and map show what was recorded.</p>
      ) : (
        <>
          <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{refLabel ? (who ? `← ${who} faster` : '← Faster') : 'Sector times'}</span>
            <span>{refLabel ? `vs ${refLabel}` : 'Nothing to compare with yet'}</span>
          </div>
          {table.map(({ row, kids }, b) => (
            <button
              key={row.name}
              style={{ display: 'grid', gap: 8, textAlign: 'left' }}
              aria-expanded={open.has(b)}
              aria-label={`${row.name}, ${kids.length} minisectors`}
              onClick={() => setOpen((o) => (o.has(b) ? new Set([...o].filter((x) => x !== b)) : new Set(o).add(b)))}
            >
              <SecCells row={row} scale={bigScale} />
              {open.has(b) && (
                <span style={{ display: 'grid', gap: 6, paddingLeft: 38 }}>
                  <SectorStrip colours={kids.map((k) => k.colour)} wide />
                  <span className="lbl">
                    {formatLap(row.ms)}
                    {row.colour === 'purple' && refLabel ? ' · fastest ever' : ''} · {kids.length} minisectors
                  </span>
                </span>
              )}
            </button>
          ))}
          {totalMs != null && (
            <div className="bar">
              <span className="lbl">Total</span>
              <span />
              <b className="t" style={{ color: totalMs < 0 ? 'var(--s-g)' : totalMs > 0 ? 'var(--s-y)' : undefined }}>{formatDelta(totalMs, 2)}</b>
            </div>
          )}
        </>
      )}
    </div>
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
  hero,
  who,
  rankOne,
  onMore,
  actions,
  children,
}: {
  lap: Pick<LapViewLap, 'username' | 'totalMs' | 'splitTimesMs' | 'penaltyMs' | 'profile' | 'partial'> & { userId?: string; avatarHue?: number };
  /** Who and the time, above the tabs on Sectors and Graphs. */
  hero?: ReactNode;
  who?: ReactNode;
  rankOne?: boolean;
  onMore?: () => void;
  /** The main action, pinned at the bottom (Race this lap). */
  actions?: ReactNode;
  children?: ReactNode;
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
    <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '14px 22px 0' }}>
      <span>
        At {formatDistance(carAtM)} · <b style={{ color: 'var(--ink)' }}>{sectorAt}</b>
      </span>
      {ref && gapAt != null && <span className="t" style={{ fontSize: 15, color: gapAt <= 0 ? 'var(--s-g)' : 'var(--s-y)' }}>{formatDelta(gapAt)}</span>}
      {(speedAt || ownSpeedAt != null) && (
        <span>
          <b style={{ color: SERIES.a }}>{Math.round(speedAt ? speedAt.a : ownSpeedAt!)}</b>
          {speedAt && <b style={{ color: SERIES.b }}> | {Math.round(speedAt.b)}</b>} km/h
        </span>
      )}
    </div>
  );
  const pick = (v: Tab) => {
    setTab(v);
    if (v !== 'sectors' && !mapSeen) {
      setMapSeen(true);
      onOpen?.();
    }
  };
  const seg = (
    <Segmented
      label="Show"
      value={tab}
      onChange={pick}
      options={[
        { value: 'sectors', label: 'Sectors' },
        { value: 'graphs', label: 'Graphs' },
        { value: 'map', label: 'Map' },
      ]}
    />
  );
  const back = (
    <button className="glass ib" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
      <I n="back" />
    </button>
  );
  const top = topTotal(lap, ref);

  return (
    <>
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {back}
        {onMore && (
          <button className="glass ib" aria-label="More" onClick={onMore}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h.01M12 12h.01M19 12h.01" style={{ strokeWidth: 3.2 }} />
            </svg>
          </button>
        )}
      </div>
      {hero}
      <div style={{ padding: '16px 16px 0' }}>{seg}</div>

      {tab === 'sectors' && sectors}

      {tab === 'graphs' &&
        (!route || !fits ? (
          <p className="lbl" style={{ padding: '16px 22px' }}>No graphs for this lap.</p>
        ) : (
          <>
            {readout}
            {(cmp?.speed || hasSpeed) && (
              <div className="glass lift" style={{ margin: '14px 16px 0', borderRadius: 28, padding: '16px 18px' }}>
                <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Speed, km/h</span>
                  <span>Top {Math.round(Math.max(...(cmp?.speed ? cmp.speed.map((x) => x.a) : lap.profile!.speedDms.map((v) => v * 0.36))))}</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <SpeedGraph
                    data={cmp?.speed ?? lap.profile!.speedDms.map((v, i) => ({ d: i * lap.profile!.stepM, a: v * 0.36, b: 0 }))}
                    boundaries={bigBoundaries}
                    aLabel={lap.username}
                    bLabel={cmp?.speed ? ref!.label : null}
                    onScrub={scrubTo}
                    at={carAtM}
                  />
                </div>
              </div>
            )}
            {cmp ? (
              <div className="glass lift" style={{ margin: '10px 16px 0', borderRadius: 28, padding: '16px 18px' }}>
                <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{top != null && top <= 0 ? `Ahead of ${ref!.label}` : `Behind ${ref!.label}`}</span>
                  {top != null && <span className={`t${top <= 0 ? ' acc' : ''}`} style={{ fontSize: 15 }}>{formatDelta(top, 2)}</span>}
                </div>
                <div style={{ marginTop: 10 }}>
                  <DeltaGraph data={cmp.delta} boundaries={bigBoundaries} aLabel={lap.username} bLabel={ref!.label} onScrub={scrubTo} at={carAtM} />
                </div>
                {!cmp.smooth && <p className="lbl" style={{ marginTop: 8 }}>Drawn from sector splits only: one of these laps has no 10 m profile.</p>}
              </div>
            ) : (
              <p className="lbl" style={{ padding: '16px 22px' }}>The gap graph needs a lap to compare with.</p>
            )}
          </>
        ))}

      {children}
      {actions && <div className="lap-cta">{actions}</div>}

      {/* The Map tab is the whole screen: the map, the header floating on it, playback in the sheet. One map,
          kept once shown (every mount counts against the monthly Mapbox cap). */}
      {mapSeen && route && (
        <div className="lap-map" hidden={tab !== 'map'}>
          <div className="map">
            <RouteMap
              route={route}
              colours={colours}
              height="100%"
              padding={{ top: 200, bottom: 300, left: 40, right: 40 }}
              extra={mapExtra}
              carAtM={carAtM}
              ghostAtM={ghostAtM}
              follow={follow === 'route' ? null : follow}
              onPick={fits ? scrubTo : undefined}
            />
          </div>
          <div className="edge" />
          <div className="sb" />
          <div style={{ padding: '4px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
            {back}
            <div className="glass lift" style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 24, padding: '0 8px 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={lap.username} hue={lap.avatarHue} uid={lap.userId} />
              <b className="ellipsis" style={{ flex: 1 }}>{who ?? lap.username}</b>
              <span className={`t${rankOne ? ' acc' : ''}`} style={{ fontSize: 20, paddingRight: 8 }}>{formatLap(lap.totalMs)}</span>
            </div>
          </div>
          <div style={{ padding: '10px 16px 0' }}>{seg}</div>
          <div style={{ padding: '10px 16px 0', display: 'flex', gap: 6 }}>
            {colours.includes('purple') && (
              <span className="glass chip lift" style={{ height: 30, fontSize: 12 }}>
                <i className="dot" style={{ background: 'var(--s-p)' }} />
                Fastest ever
              </span>
            )}
            <span className="glass chip lift" style={{ height: 30, fontSize: 12 }}>
              <i className="dot" style={{ background: 'var(--s-g)' }} />
              Faster
            </span>
            <span className="glass chip lift" style={{ height: 30, fontSize: 12 }}>
              <i className="dot" style={{ background: 'var(--s-y)' }} />
              Slower
            </span>
          </div>
          <div className="glass sheet sheet-b" style={{ bottom: 'calc(8px + var(--safe-b))' }}>
            <div className="grab" />
            {fits ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button className="play" aria-label={playing ? 'Pause' : 'Play the lap'} onClick={togglePlay}>
                    {playing ? <I n="pause" style={{ strokeWidth: 3 }} /> : <I n="play" style={{ fill: 'currentColor', stroke: 'none', marginLeft: 3 }} />}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="t" style={{ fontSize: 22 }}>{formatLap(t ?? 0)}</span>
                      {gapAt != null && (
                        <span className="t" style={{ fontSize: 17, color: gapAt <= 0 ? 'var(--accent)' : 'var(--s-y)' }}>{formatDelta(gapAt)}</span>
                      )}
                    </div>
                    <div className="scrub" style={{ ['--p' as string]: `${((t ?? 0) / Math.max(1, endT)) * 100}%` }}>
                      <input
                        type="range"
                        min={0}
                        max={Math.round(endT)}
                        step={100}
                        value={Math.round(t ?? 0)}
                        aria-label="Time into the lap"
                        onChange={(e) => {
                          setPlaying(false);
                          setT(Number(e.target.value));
                        }}
                      />
                    </div>
                  </div>
                  <button
                    className="chip"
                    style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }}
                    aria-label={`Playback speed ${speed}×. Change`}
                    onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
                  >
                    {speed}×
                  </button>
                </div>
                <div className="lbl" style={{ display: 'flex', gap: 14, marginTop: 14 }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <i className="dot" style={{ background: 'var(--ink)' }} />
                    {lap.username}
                  </span>
                  {ref && (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <i className="dot" style={{ background: 'transparent', boxShadow: 'inset 0 0 0 2px var(--ink)' }} />
                      {ref.label}
                    </span>
                  )}
                </div>
                <div className="lbl" style={{ marginTop: 14 }}>Follow</div>
                <div style={{ marginTop: 8 }}>
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
              <p className="lbl">This lap was timed on an older version of the route, so it can&rsquo;t be played back.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** The whole-lap gap against the reference, when both laps are complete. */
function topTotal(lap: { totalMs: number; partial?: boolean }, ref: LapReference | null) {
  return ref && !lap.partial && !ref.partial ? lap.totalMs - ref.totalMs : null;
}

/** Name, the delta bar growing from the centre (faster left, slower right), and the delta. */
function SecCells({ row, scale }: { row: Row; scale: number }) {
  const w = row.deltaMs == null ? 0 : Math.max(4, (Math.abs(row.deltaMs) / scale) * 100);
  const cls = row.colour ? row.colour[0] : '';
  return (
    <span className="bar">
      <span className="lbl">{row.name}</span>
      <i className={cls} style={{ width: `${w}%`, background: row.colour ? undefined : 'color-mix(in srgb, var(--ink) 20%, transparent)' }} aria-hidden="true" />
      <b className="t" style={{ color: row.colour === 'purple' ? 'var(--s-p)' : undefined }}>
        {row.deltaMs != null ? formatDelta(row.deltaMs, 2) : formatLap(row.ms)}
        {row.colour && <span className="visually-hidden"> {STRIP_LABEL[row.colour]}</span>}
      </b>
    </span>
  );
}

function nearestBy<T extends { d: number }>(pts: T[], d: number): T | null {
  let best: T | null = null;
  for (const p of pts) if (!best || Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
  return best;
}
