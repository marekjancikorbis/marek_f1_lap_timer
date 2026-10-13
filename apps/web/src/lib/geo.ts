import { PreparedRoute, type LatLon } from '@laptimer/timing';
import type { LngLat, Route } from './types';

export function flatToLatLon(flat: number[]): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ lon: flat[i], lat: flat[i + 1] });
  return out;
}

export function latLonToFlat(pts: LatLon[]): number[] {
  return pts.flatMap((p) => [round6(p.lon), round6(p.lat)]);
}

export function lngLatPairs(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

export function bboxOf(pts: LatLon[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of pts) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

const prepared = new Map<string, PreparedRoute>();

/** Cached PreparedRoute per route id (geometry is frozen once driven). */
export function preparedFor(route: Pick<Route, 'id' | 'coords'>): PreparedRoute {
  const key = `${route.id}:${route.coords.length}`;
  let p = prepared.get(key);
  if (!p) {
    p = new PreparedRoute(flatToLatLon(route.coords));
    prepared.set(key, p);
  }
  return p;
}

/** Split a route into per-sector polylines (lng/lat) at the frozen boundaries. */
export function sectorLines(route: Pick<Route, 'id' | 'coords' | 'boundaries'>, stepM = 10): LngLat[][] {
  const pr = preparedFor(route);
  const lines: LngLat[][] = [];
  let from = 0;
  for (const to of route.boundaries) {
    const line: LngLat[] = [];
    const end = Math.min(to, pr.lengthM);
    for (let d = from; d < end; d += stepM) {
      const p = pr.pointAt(d);
      line.push({ lng: p.lon, lat: p.lat });
    }
    const p = pr.pointAt(end);
    line.push({ lng: p.lon, lat: p.lat });
    lines.push(line);
    from = to;
  }
  return lines;
}

/** Douglas-Peucker in a local metric frame, for light thumbnails. */
export function simplify(pts: LatLon[], toleranceM: number): LatLon[] {
  if (pts.length < 3) return pts;
  const lat0 = (pts[0].lat * Math.PI) / 180;
  const xy = pts.map((p) => ({ x: p.lon * 111320 * Math.cos(lat0), y: p.lat * 110540 }));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const ax = xy[a].x;
    const ay = xy[a].y;
    const dx = xy[b].x - ax;
    const dy = xy[b].y - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (xy[i].x - ax) - dx * (xy[i].y - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
