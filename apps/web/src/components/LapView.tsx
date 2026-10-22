import { bigSplits, compareLaps, sectorColour, sectorTimes, type LapProfile } from '@laptimer/timing';
import { ChevronDown } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { leaderboardFrom } from '../lib/data';
import { formatDate, formatDelta, formatDistance, formatLap, formatSeconds } from '../lib/format';
import { bigEnds, bigRecords, bigRoute, distanceAt, recordsExcluding, timeAt } from '../lib/laps';
import type { Post, Route, SectorColourName } from '../lib/types';
import { DeltaGraph, SpeedGraph } from './Charts';
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
  /** Rendered at the end. */
  children?: ReactNode;
}) {
  const [tab, setTab] = useState<'sectors' | 'graphs' | 'map'>('sectors');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [carAtM, setCarAtM] = useState<number | null>(null);

  const board = useMemo(() => leaderboardFrom(posts), [posts]);
  const rank = board.find((r) => r.post.id === lap.id)?.rank;
  const n = lap.splitTimesMs.length;
  const fits = !!route && route.boundaries.length === n;
  const ref = reference && reference.splitTimesMs.length === n ? reference : null;
  const isPublic = !!route?.isPublic;

  const table = useMemo(() => {
    if (!route || !fits) return null;
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
  }, [route, fits, isPublic, posts, n, lap, ref, colours]);

  const miniColours = useMemo(() => table?.flatMap((t) => t.kids.map((k) => k.colour)) ?? colours, [table, colours]);
  const bigScale = Math.max(1, ...(table ?? []).map((t) => Math.abs(t.row.deltaMs ?? 0)));
  const miniScale = Math.max(1, ...(table ?? []).flatMap((t) => t.kids.map((k) => Math.abs(k.deltaMs ?? 0))));

  const cmp = useMemo(() => {
    if (!route || !fits || !ref) return null;
    try {
      return compareLaps(lap, ref, route.boundaries);
    } catch {
      return null;
    }
  }, [route, fits, lap, ref]);

  const hasSpeed = !!lap.profile && lap.profile.speedDms.length > 1;
  const lengthM = route?.boundaries[route.boundaries.length - 1] ?? 0;
  const bigBoundaries = route ? bigRoute(route).boundaries : [];
  // Where the reference was at the moment this lap reached carAtM.
  const ghostAtM = route && ref && carAtM != null ? distanceAt(timeAt(carAtM, lap, route.boundaries, lap.profile), ref, route.boundaries, ref.profile) : null;
  const gapAt = cmp && carAtM != null ? nearestBy(cmp.delta, carAtM)?.ms ?? null : null;
  const speedAt = cmp?.speed && carAtM != null ? nearestBy(cmp.speed, carAtM) : null;
  const ownSpeedAt = !cmp?.speed && hasSpeed && carAtM != null ? lap.profile!.speedDms[Math.min(lap.profile!.speedDms.length - 1, Math.round(carAtM / lap.profile!.stepM))] * 0.36 : null;
  const sectorAt = carAtM != null ? bigBoundaries.findIndex((b) => b >= carAtM) + 1 : null;

  const readout = carAtM != null && (
    <div className="lap-readout">
      <div>
        <span>At {formatDistance(carAtM)}</span>
        <strong className="num">S{sectorAt || 1}</strong>
      </div>
      {ref && (
        <div>
          <span>Gap</span>
          <strong className={`num ${gapAt == null ? '' : gapAt <= 0 ? 'faster' : 'slower'}`}>{gapAt == null ? '—' : formatDelta(gapAt)}</strong>
        </div>
      )}
      {tab === 'map' && ref && ghostAtM != null ? (
        <div>
          <span>{ref.label} is</span>
          <strong className="num">
            {Math.abs(ghostAtM - carAtM) < 1 ? 'level' : `${Math.round(Math.abs(ghostAtM - carAtM))} m ${ghostAtM > carAtM ? 'ahead' : 'behind'}`}
          </strong>
        </div>
      ) : (
        (speedAt || ownSpeedAt != null) && (
          <div>
            <span>Speed{speedAt ? ` / ${ref?.label}` : ''}</span>
            <strong className="num">
              {Math.round(speedAt ? speedAt.a : ownSpeedAt!)}
              {speedAt && <small className="mute"> / {Math.round(speedAt.b)}</small>}
            </strong>
          </div>
        )
      )}
    </div>
  );

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

      <div className="lap-tabs">
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sectors', label: 'Sectors' },
            { value: 'graphs', label: 'Graphs' },
            { value: 'map', label: 'Map' },
          ]}
        />
      </div>

      {tab === 'sectors' &&
        (!table ? (
          <p className="mute">This lap was timed on an older version of the route, so its sectors can't be shown.</p>
        ) : (
          <>
            {ref ? (
              <div className="dscale" aria-hidden="true">
                <span>← Faster</span>
                <span>vs {ref.label}</span>
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
                      {row.colour === 'purple' && ref ? ' · fastest ever' : ''} · {kids.length} minisectors
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
        ))}

      {tab === 'graphs' &&
        (!route || !fits ? (
          <p className="mute">No graphs for this lap.</p>
        ) : (
          <div className="stack">
            {readout}
            {cmp ? (
              <div className="panel chart-panel">
                <DeltaGraph data={cmp.delta} boundaries={bigBoundaries} aLabel={lap.username} bLabel={ref!.label} onScrub={setCarAtM} at={carAtM} />
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
                  onScrub={setCarAtM}
                  at={carAtM}
                />
              </div>
            )}
          </div>
        ))}

      {tab === 'map' && route && (
        <div className="stack">
          <div className="map-card">
            <RouteMap route={route} colours={miniColours} height={360} extra={mapExtra} carAtM={carAtM} ghostAtM={ghostAtM} onPick={setCarAtM} />
          </div>
          <p className="maplegend">
            <span>
              <i style={{ background: 'var(--purple)' }} /> Fastest ever
            </span>
            <span>
              <i style={{ background: 'var(--green)' }} /> Faster
            </span>
            <span>
              <i style={{ background: 'var(--yellow)' }} /> Slower
            </span>
          </p>
          <label className="lap-scrub">
            <span className="visually-hidden">Position along the route</span>
            <input type="range" min={0} max={Math.round(lengthM)} step={1} value={Math.round(carAtM ?? 0)} onChange={(e) => setCarAtM(Number(e.target.value))} />
          </label>
          {readout || <p className="mute small-text">Drag the slider or tap the route to replay the lap{ref ? ` against ${ref.label}` : ''}.</p>}
        </div>
      )}

      {children}
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
