import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { formatDelta, formatDistance } from '../lib/format';

// Look and feel after bklit.com's line and area charts: monotone curves, gradient
// fills fading to the baseline, dashed horizontal grid only, an edge-faded
// crosshair with a dot per series, a value pill that follows it, axis labels
// that fade as it passes, and a clip-reveal on enter.

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

/** Smooth path through the points that never overshoots them (monotone cubic, as d3's curveMonotoneX). */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push(dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  }
  t.push(m[n - 2]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)} ${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)} ${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

/** Dashed horizontal grid, sector marks and labels: both graphs register on the same frame. */
function Frame({ axis, yTicks, y, yFmt, hoverX }: { axis: Axis; yTicks: number[]; y: (v: number) => number; yFmt: (v: number) => string; hoverX: number | null }) {
  const x = xScale(axis);
  // About ten labels fit across a phone; past that, label every k-th sector.
  const every = Math.ceil(axis.boundaries.length / 10);
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--hairline-2)" strokeWidth={1} strokeDasharray="4 4" />
          <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
            {yFmt(t)}
          </text>
        </g>
      ))}
      {axis.boundaries.slice(0, -1).map((b) => (
        <line key={`s${b}`} x1={x(b)} x2={x(b)} y1={PAD.t} y2={H - PAD.b} stroke="var(--hairline)" strokeWidth={1} />
      ))}
      {axis.boundaries.map((b, i) => {
        if (i % every) return null;
        const lx = (x(i ? axis.boundaries[i - 1] : 0) + x(b)) / 2;
        // Labels make way for the crosshair as it passes.
        const near = hoverX == null ? 1 : Math.min(1, Math.max(0.15, Math.abs(lx - hoverX) / 50));
        return (
          <text key={`l${i}`} x={lx} y={H - 8} textAnchor="middle" className="chart-tick" style={{ opacity: near }}>
            S{i + 1}
          </text>
        );
      })}
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

/** Shared chrome: gradients, the reveal clip, the crosshair with its dots, and the value pill. */
function Plot({
  id,
  label,
  scrub,
  hoverX,
  dots,
  pill,
  hint,
  defs,
  children,
}: {
  id: string;
  label: string;
  scrub: ReturnType<typeof useScrub>;
  hoverX: number | null;
  dots: { y: number; fill: string }[];
  pill: ReactNode;
  hint: string;
  defs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="chart-plot">
        <svg ref={scrub.svg} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={label} onPointerMove={scrub.onMove} onPointerDown={scrub.onMove}>
          <defs>
            <clipPath id={`${id}-reveal`}>
              <rect className="chart-reveal" x={0} y={0} width={W} height={H} />
            </clipPath>
            <linearGradient id={`${id}-cross`} x1="0" y1={PAD.t} x2="0" y2={H - PAD.b} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--ink)" stopOpacity={0} />
              <stop offset="0.1" stopColor="var(--ink)" stopOpacity={0.7} />
              <stop offset="0.9" stopColor="var(--ink)" stopOpacity={0.7} />
              <stop offset="1" stopColor="var(--ink)" stopOpacity={0} />
            </linearGradient>
            {defs}
          </defs>
          {children}
          {hoverX != null && (
            <g className="chart-cross" pointerEvents="none" style={{ transform: `translateX(${hoverX}px)` }}>
              <line x1={0} x2={0} y1={PAD.t} y2={H - PAD.b} stroke={`url(#${id}-cross)`} strokeWidth={1.5} />
              {dots.map((d, k) => (
                <circle key={k} cx={0} cy={d.y} r={5} fill={d.fill} stroke="var(--raised)" strokeWidth={2.5} style={{ transition: 'cy 140ms ease-out' }} />
              ))}
            </g>
          )}
        </svg>
        {hoverX != null && (
          <div className="chart-pill num" aria-live="polite" style={{ left: `${Math.min(84, Math.max(16, (hoverX / W) * 100))}%` }}>
            {pill}
          </div>
        )}
      </div>
      {hoverX == null && <p className="chart-readout mute">{hint}</p>}
    </>
  );
}

export interface DeltaPoint {
  d: number;
  ms: number;
}

/**
 * How far A is ahead of B against route distance: above zero A is ahead
 * (green), below it A is behind (yellow).
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
  const id = useId().replace(/:/g, '');
  const axis = { maxD: boundaries[boundaries.length - 1], boundaries };
  const { minV, maxV, yTicks } = useMemo(() => {
    const vs = data.map((p) => -p.ms / 1000);
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
  const line = useMemo(() => monotonePath(data.map((p) => [x(p.d), y(-p.ms / 1000)])), [data, minV, maxV, axis.maxD]); // eslint-disable-line react-hooks/exhaustive-deps
  const zeroY = y(0);
  const area = `${line}L${x(data[data.length - 1].d)} ${zeroY}L${x(data[0].d)} ${zeroY}Z`;
  const hover = scrub.i != null ? data[scrub.i] : null;
  const ahead = hover != null && hover.ms <= 0;

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span>
          <i style={{ background: 'var(--green)' }} /> {aLabel} ahead
        </span>
        <span>
          <i style={{ background: 'var(--yellow)' }} /> {aLabel} behind
        </span>
      </figcaption>
      <Plot
        id={id}
        label={`Gap between ${aLabel} and ${bLabel} along the route`}
        scrub={scrub}
        hoverX={hover ? x(hover.d) : null}
        dots={hover ? [{ y: y(-hover.ms / 1000), fill: ahead ? 'var(--green)' : 'var(--yellow)' }] : []}
        hint="Drag across the graph to read the gap"
        pill={
          hover && (
            <>
              <strong style={{ color: ahead ? 'var(--green-ink)' : 'var(--yellow)' }}>{hover.ms === 0 ? 'level' : `${formatDelta(hover.ms)} ${ahead ? 'ahead' : 'behind'}`}</strong>
              <span>{formatDistance(hover.d)}</span>
            </>
          )
        }
        defs={
          <>
            <clipPath id={`${id}-above`}>
              <rect x={0} y={0} width={W} height={zeroY} />
            </clipPath>
            <clipPath id={`${id}-below`}>
              <rect x={0} y={zeroY} width={W} height={H} />
            </clipPath>
            {/* Strongest where the gap is biggest, fading to nothing at the zero line. */}
            <linearGradient id={`${id}-ahead`} x1="0" y1={PAD.t} x2="0" y2={zeroY} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--green)" stopOpacity={0.45} />
              <stop offset="1" stopColor="var(--green)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}-behind`} x1="0" y1={zeroY} x2="0" y2={H - PAD.b} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--yellow)" stopOpacity={0} />
              <stop offset="1" stopColor="var(--yellow)" stopOpacity={0.45} />
            </linearGradient>
          </>
        }
      >
        <Frame axis={axis} yTicks={yTicks} y={y} yFmt={(v) => (v > 0 ? `+${v}` : String(v))} hoverX={hover ? x(hover.d) : null} />
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--mute)" strokeWidth={1} />
        <g clipPath={`url(#${id}-reveal)`}>
          <path d={area} fill={`url(#${id}-ahead)`} clipPath={`url(#${id}-above)`} />
          <path d={area} fill={`url(#${id}-behind)`} clipPath={`url(#${id}-below)`} />
          <path d={line} fill="none" stroke="var(--green)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}-above)`} />
          <path d={line} fill="none" stroke="var(--yellow)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}-below)`} />
        </g>
      </Plot>
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
  const id = useId().replace(/:/g, '');
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
  const paths = useMemo(
    () => ({ a: monotonePath(data.map((p) => [x(p.d), y(p.a)])), b: bLabel ? monotonePath(data.map((p) => [x(p.d), y(p.b)])) : '' }),
    [data, maxV, bLabel, axis.maxD], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const baseY = y(0);
  const areaA = `${paths.a}L${x(data[data.length - 1].d)} ${baseY}L${x(data[0].d)} ${baseY}Z`;
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
      <Plot
        id={id}
        label={`Speed of ${aLabel}${bLabel ? ` and ${bLabel}` : ''} along the route`}
        scrub={scrub}
        hoverX={hover ? x(hover.d) : null}
        dots={hover ? [...(bLabel ? [{ y: y(hover.b), fill: SERIES.b }] : []), { y: y(hover.a), fill: SERIES.a }] : []}
        hint="km/h along the route · drag to read"
        pill={
          hover && (
            <>
              <strong>
                <b style={{ color: SERIES.a }}>{Math.round(hover.a)}</b>
                {bLabel && (
                  <>
                    <b className="mute"> | </b>
                    <b style={{ color: SERIES.b }}>{Math.round(hover.b)}</b>
                  </>
                )}{' '}
                km/h
              </strong>
              <span>{formatDistance(hover.d)}</span>
            </>
          )
        }
        defs={
          <>
            <linearGradient id={`${id}-fill`} x1="0" y1={PAD.t} x2="0" y2={baseY} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={SERIES.a} stopOpacity={0.35} />
              <stop offset="1" stopColor={SERIES.a} stopOpacity={0} />
            </linearGradient>
            {/* Lines fade out at both ends. */}
            <linearGradient id={`${id}-edge`} x1={PAD.l} y1="0" x2={W - PAD.r} y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity={0.2} />
              <stop offset="0.04" stopColor="#fff" stopOpacity={1} />
              <stop offset="0.96" stopColor="#fff" stopOpacity={1} />
              <stop offset="1" stopColor="#fff" stopOpacity={0.2} />
            </linearGradient>
            <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
              <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-edge)`} />
            </mask>
          </>
        }
      >
        <Frame axis={axis} yTicks={yTicks} y={y} yFmt={(v) => String(Math.round(v))} hoverX={hover ? x(hover.d) : null} />
        <g clipPath={`url(#${id}-reveal)`}>
          <g mask={`url(#${id}-fade)`}>
            <path d={areaA} fill={`url(#${id}-fill)`} />
            {bLabel && <path d={paths.b} fill="none" stroke={SERIES.b} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />}
            <path d={paths.a} fill="none" stroke={SERIES.a} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        </g>
      </Plot>
    </figure>
  );
}
