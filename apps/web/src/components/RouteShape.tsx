import { useEffect, useMemo, useState } from 'react';
import type { SectorColourName, Route } from '../lib/types';
import { sectorLines } from '../lib/geo';
import { allowStaticMap, staticMapFit } from '../lib/staticMap';

const COLOUR: Record<SectorColourName | 'none', string> = {
  purple: 'var(--purple)',
  green: 'var(--green)',
  yellow: 'var(--yellow)',
  none: 'var(--ink-2)',
};

interface Props {
  route: Pick<Route, 'id' | 'coords' | 'boundaries' | 'isLoop'>;
  /** One colour per sector; omitted sectors draw in chalk. */
  colours?: (SectorColourName | null)[];
  height?: number;
  /** Highlight the sector boundaries with ticks. */
  ticks?: boolean;
  className?: string;
  label?: string;
  /** Put a map picture of the surroundings under the line (counts against the card-map cap). */
  map?: boolean;
}

/** Card map picture size in CSS px; the SVG draws in a 1000-wide space on top. */
const IMG_W = 640;

type XYPoint = readonly [number, number];

/** Project a route's sectors into a W-wide box (height follows the shape), for SVG or canvas drawing. */
export function shapeGeometry(route: Props['route'], W = 1000, maxH = W * 0.6, pad = 70) {
  const lines = sectorLines(route, 12);
  const all = lines.flat();
  if (!all.length) return null;
  const lat0 = (all[0].lat * Math.PI) / 180;
  const k = Math.cos(lat0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    const x = p.lng * k;
    const y = -p.lat;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX || 1e-9;
  const h = maxY - minY || 1e-9;
  const scale = Math.min((W - pad * 2) / w, (maxH - pad * 2) / h);
  const H = Math.max(240, h * scale + pad * 2);
  const ox = (W - w * scale) / 2;
  const oy = (H - h * scale) / 2;
  const P = (p: { lng: number; lat: number }): XYPoint => [ox + (p.lng * k - minX) * scale, oy + (-p.lat - minY) * scale];
  return {
    lines: lines.map((line) => line.map(P)),
    start: P(all[0]),
    finish: P(all[all.length - 1]),
    tickPts: lines.slice(0, -1).map((l) => P(l[l.length - 1])),
    W,
    H,
  };
}

/** Same layout as shapeGeometry, but in Web Mercator matching a Static Images picture. */
function mapGeometry(route: Props['route'], imgH: number) {
  const lines = sectorLines(route, 12);
  const all = lines.flat();
  if (!all.length) return null;
  const fit = staticMapFit(all, IMG_W, imgH, 30);
  const k = 1000 / IMG_W;
  const P = (p: { lng: number; lat: number }): XYPoint => {
    const [x, y] = fit.project(p);
    return [x * k, y * k];
  };
  return {
    url: fit.url,
    lines: lines.map((line) => line.map(P)),
    start: P(all[0]),
    finish: P(all[all.length - 1]),
    tickPts: lines.slice(0, -1).map((l) => P(l[l.length - 1])),
    W: 1000,
    H: imgH * k,
  };
}

/**
 * The route drawn from its own geometry, each sector stroked in its flag
 * colour. Without `map` it needs no tiles at all; with it, one static map
 * picture sits underneath, drawn in the same projection so the line lands on the roads.
 */
export function RouteShape({ route, colours, height = 150, ticks = true, className, label, map = false }: Props) {
  const imgH = Math.round(height * 1.6);
  const geom = useMemo(() => {
    const plain = map ? null : shapeGeometry(route);
    const g = map ? mapGeometry(route, imgH) : plain && { ...plain, url: null };
    if (!g) return null;
    const paths = g.lines.map((line) => line.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''));
    return { ...g, paths };
  }, [route, map, imgH]);

  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setImg(null);
    if (geom?.url) void allowStaticMap(geom.url).then((ok) => live && ok && setImg(geom.url));
    return () => {
      live = false;
    };
  }, [geom?.url]);

  if (!geom) return null;
  const svg = (
    <svg
      className={map ? undefined : className}
      viewBox={`0 0 ${geom.W} ${geom.H}`}
      style={map ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : { width: '100%', height, display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label ?? 'Route map'}
    >
      {/* Casing first so sector joins stay clean. */}
      {geom.paths.map((d, i) => (
        <path key={`c${i}`} d={d} fill="none" stroke="#0c0d0e" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {geom.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={COLOUR[colours?.[i] ?? 'none']}
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {ticks &&
        geom.tickPts.map(([x, y], i) => <circle key={`t${i}`} cx={x} cy={y} r={7} fill="#0c0d0e" stroke="var(--ink)" strokeWidth={4} />)}
      {!route.isLoop && <circle cx={geom.finish[0]} cy={geom.finish[1]} r={16} fill="var(--ink)" stroke="#0c0d0e" strokeWidth={6} />}
      <g transform={`translate(${geom.start[0]} ${geom.start[1]})`}>
        <rect x={-20} y={-20} width={40} height={40} rx={8} fill="var(--ink)" stroke="#0c0d0e" strokeWidth={6} />
        <path d="M-8 -9v18M-8 -9h14l-4 5 4 5h-14" fill="none" stroke="#0c0d0e" strokeWidth={4} strokeLinejoin="round" />
      </g>
    </svg>
  );
  if (!map) return svg;
  return (
    <div className={`route-map-pic ${className ?? ''}`} style={{ aspectRatio: `${IMG_W} / ${imgH}` }}>
      {img && <img src={img} alt="" onError={() => setImg(null)} />}
      {svg}
    </div>
  );
}
