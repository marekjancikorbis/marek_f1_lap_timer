import { useMemo } from 'react';
import type { SectorColourName, Route } from '../lib/types';
import { sectorLines } from '../lib/geo';

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
}

/**
 * The route drawn from its own geometry, each sector stroked in its flag
 * colour. No map tiles: thumbnails cost nothing against the Mapbox cap.
 */
export function RouteShape({ route, colours, height = 150, ticks = true, className, label }: Props) {
  const geom = useMemo(() => {
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
    const W = 1000;
    const pad = 70;
    const scale = Math.min((W - pad * 2) / w, (W * 0.6 - pad * 2) / h);
    const H = Math.max(240, h * scale + pad * 2);
    const ox = (W - w * scale) / 2;
    const oy = (H - h * scale) / 2;
    const P = (p: { lng: number; lat: number }) => [ox + (p.lng * k - minX) * scale, oy + (-p.lat - minY) * scale] as const;
    const paths = lines.map((line) =>
      line.map((p, i) => `${i ? 'L' : 'M'}${P(p)[0].toFixed(1)} ${P(p)[1].toFixed(1)}`).join(''),
    );
    const start = P(all[0]);
    const finish = P(all[all.length - 1]);
    const tickPts = lines.slice(0, -1).map((l) => P(l[l.length - 1]));
    return { paths, start, finish, tickPts, W, H };
  }, [route]);

  if (!geom) return null;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${geom.W} ${geom.H}`}
      style={{ width: '100%', height, display: 'block' }}
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
}
