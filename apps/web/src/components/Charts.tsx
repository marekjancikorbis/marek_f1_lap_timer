import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatDelta, formatDistance } from '../lib/format';

/** Series colours, validated for CVD separation and contrast on the dark surface. */
// a = the lap you're looking at (blue), b = what it's compared with (chalk).
export const SERIES = { a: '#2F86FF', b: '#C3C9D2' };

const W = 640;
const H = 220;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

interface Axis {
  maxD: number;
  boundaries: number[];
}

function xScale(axis: Axis) {
  return (d: number) => PAD.l + (d / axis.maxD) * (W - PAD.l - PAD.r);
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Distance axis + sector gridlines: both graphs register on the same frame. */
function Frame({ axis, yTicks, y, yFmt }: { axis: Axis; yTicks: number[]; y: (v: number) => number; yFmt: (v: number) => string }) {
  const x = xScale(axis);
  // About ten labels fit across a phone; past that, label every k-th sector.
  const every = Math.ceil(axis.boundaries.length / 10);
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth={1} />
          <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
            {yFmt(t)}
          </text>
        </g>
      ))}
      {[0, ...axis.boundaries].map((b, i) => (
        <g key={`s${i}`}>
          <line x1={x(b)} x2={x(b)} y1={PAD.t} y2={H - PAD.b} stroke="var(--hairline-2)" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '2 4'} />
          {i < axis.boundaries.length && i % every === 0 && (
            <text x={(x(b) + x(axis.boundaries[i])) / 2} y={H - 8} textAnchor="middle" className="chart-tick">
              S{i + 1}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function nearest(xs: number[], d: number): number {
  let best = 0;
  for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - d) < Math.abs(xs[best] - d)) best = k;
  return best;
}

/** Hover / touch scrubbing that snaps to the nearest sample; `at` moves it from outside (e.g. a map tap). */
function useScrub(xs: number[], axis: Axis, onScrub?: (d: number) => void, at?: number | null) {
  const [i, setI] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (at != null) setI(nearest(xs, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const best = nearest(xs, ((px - PAD.l) / (W - PAD.l - PAD.r)) * axis.maxD);
    setI(best);
    onScrub?.(xs[best]);
  };
  // No clear on leave: the last spot stays highlighted after a finger lifts, so its readout can be read.
  return { svg, i, onMove };
}

export interface DeltaPoint {
  d: number;
  ms: number;
}

/**
 * Cumulative gap A − B against route distance. Below zero A is ahead; the
 * area takes the colour of whoever is ahead at that point.
 */
export function DeltaGraph({
  data,
  boundaries,
  aLabel,
  bLabel,
  onScrub,
  at,
}: {
  data: DeltaPoint[];
  boundaries: number[];
  aLabel: string;
  bLabel: string;
  /** Distance (m) under the pointer; not cleared on leave, so a tap keeps its spot. */
  onScrub?: (d: number) => void;
  /** Distance (m) to highlight, set from outside the graph. */
  at?: number | null;
}) {
  const axis = { maxD: boundaries[boundaries.length - 1], boundaries };
  const { minV, maxV, yTicks } = useMemo(() => {
    const vs = data.map((p) => p.ms / 1000);
    const lo = Math.min(0, ...vs);
    const hi = Math.max(0, ...vs);
    const pad = Math.max(0.1, (hi - lo) * 0.12);
    return { minV: lo - pad, maxV: hi + pad, yTicks: niceTicks(lo - pad, hi + pad) };
  }, [data]);
  const x = xScale(axis);
  const y = (v: number) => PAD.t + ((maxV - v) / (maxV - minV)) * (H - PAD.t - PAD.b);
  const scrub = useScrub(
    data.map((p) => p.d),
    axis,
    onScrub,
    at,
  );
  const line = data.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.ms / 1000).toFixed(1)}`).join('');
  const area = `${line}L${x(data[data.length - 1].d)} ${y(0)}L${x(data[0].d)} ${y(0)}Z`;
  const hover = scrub.i != null ? data[scrub.i] : null;
  const zeroY = y(0);

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span>
          <i style={{ background: 'var(--green)' }} /> {aLabel} faster
        </span>
        <span>
          <i style={{ background: 'var(--yellow)' }} /> {aLabel} slower
        </span>
      </figcaption>
      <svg
        ref={scrub.svg}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        aria-label={`Gap between ${aLabel} and ${bLabel} along the route`}
        onPointerMove={scrub.onMove}
        onPointerDown={scrub.onMove}
      >
        <defs>
          <clipPath id="above">
            <rect x={0} y={0} width={W} height={zeroY} />
          </clipPath>
          <clipPath id="below">
            <rect x={0} y={zeroY} width={W} height={H} />
          </clipPath>
        </defs>
        <Frame axis={axis} yTicks={yTicks} y={y} yFmt={(v) => (v > 0 ? `+${v}` : String(v))} />
        <path d={area} fill="var(--yellow)" opacity={0.42} clipPath="url(#above)" />
        <path d={area} fill="var(--green)" opacity={0.35} clipPath="url(#below)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--mute)" strokeWidth={1} />
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.d)} x2={x(hover.d)} y1={PAD.t} y2={H - PAD.b} stroke="var(--blue)" strokeWidth={2} />
            <circle cx={x(hover.d)} cy={y(hover.ms / 1000)} r={5} fill="var(--blue)" stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="chart-readout num" aria-live="polite">
        {hover ? (
          <>
            {formatDistance(hover.d)} ·{' '}
            <strong style={{ color: hover.ms <= 0 ? 'var(--green-ink)' : 'var(--yellow)' }}>
              {hover.ms === 0 ? 'level' : `${aLabel} ${formatDelta(hover.ms)} ${hover.ms < 0 ? 'ahead' : 'behind'}`}
            </strong>
          </>
        ) : (
          <span className="mute">Drag across the graph to read the gap</span>
        )}
      </div>
    </figure>
  );
}

export interface SpeedPoint {
  d: number;
  a: number;
  b: number;
}

/** Both laps' speed (km/h) against route distance. */
export function SpeedGraph({
  data,
  boundaries,
  aLabel,
  bLabel,
  onScrub,
  at,
}: {
  data: SpeedPoint[];
  boundaries: number[];
  aLabel: string;
  bLabel: string | null;
  onScrub?: (d: number) => void;
  at?: number | null;
}) {
  const axis = { maxD: boundaries[boundaries.length - 1], boundaries };
  const maxV = useMemo(() => Math.max(20, ...data.map((p) => Math.max(p.a, bLabel ? p.b : 0))) * 1.08, [data, bLabel]);
  const yTicks = niceTicks(0, maxV);
  const x = xScale(axis);
  const y = (v: number) => PAD.t + ((maxV - v) / maxV) * (H - PAD.t - PAD.b);
  const scrub = useScrub(
    data.map((p) => p.d),
    axis,
    onScrub,
    at,
  );
  const path = (key: 'a' | 'b') => data.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
  const hover = scrub.i != null ? data[scrub.i] : null;
  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span>
          <i style={{ background: SERIES.a }} /> {aLabel}
        </span>
        {bLabel && (
          <span>
            <i style={{ background: SERIES.b }} /> {bLabel}
          </span>
        )}
      </figcaption>
      <svg
        ref={scrub.svg}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        aria-label={`Speed of ${aLabel} and ${bLabel} along the route`}
        onPointerMove={scrub.onMove}
        onPointerDown={scrub.onMove}
      >
        <Frame axis={axis} yTicks={yTicks} y={y} yFmt={(v) => String(Math.round(v))} />
        {bLabel && <path d={path('b')} fill="none" stroke={SERIES.b} strokeWidth={2} strokeLinejoin="round" />}
        <path d={path('a')} fill="none" stroke={SERIES.a} strokeWidth={2} strokeLinejoin="round" />
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.d)} x2={x(hover.d)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-2)" strokeWidth={1} />
            {bLabel && <circle cx={x(hover.d)} cy={y(hover.b)} r={5} fill={SERIES.b} stroke="var(--raised)" strokeWidth={2} />}
            <circle cx={x(hover.d)} cy={y(hover.a)} r={5} fill={SERIES.a} stroke="var(--raised)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="chart-readout num" aria-live="polite">
        {hover ? (
          <>
            {formatDistance(hover.d)} · {aLabel} <strong>{Math.round(hover.a)}</strong>
            {bLabel && (
              <>
                {' '}
                · {bLabel} <strong>{Math.round(hover.b)}</strong>
              </>
            )}{' '}
            km/h
          </>
        ) : (
          <span className="mute">km/h along the route · drag to read</span>
        )}
      </div>
    </figure>
  );
}
