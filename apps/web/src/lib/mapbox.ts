import type { LatLon } from '@laptimer/timing';
import { MAPBOX_TOKEN } from './config';
import { consume } from './usage';

const MAX_WAYPOINTS = 25;

/**
 * Snap tapped waypoints to roads with the Directions API. Each request is
 * counted against the monthly cap first. Requests take at most 25 waypoints,
 * so long routes are split into overlapping legs.
 */
export async function snapToRoads(waypoints: LatLon[], loop: boolean, signal?: AbortSignal): Promise<LatLon[]> {
  const pts = loop && waypoints.length > 2 ? [...waypoints, waypoints[0]] : waypoints;
  if (pts.length < 2) return pts;
  const legs: LatLon[][] = [];
  for (let i = 0; i < pts.length - 1; i += MAX_WAYPOINTS - 1) {
    legs.push(pts.slice(i, i + MAX_WAYPOINTS));
  }
  const out: LatLon[] = [];
  for (const leg of legs) {
    await consume('directions');
    const coords = leg.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?geometries=geojson&overview=full&continue_straight=true&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(res.status === 401 ? 'Mapbox rejected the token.' : `Road snapping failed (${res.status}).`);
    const body = await res.json();
    const line: [number, number][] | undefined = body.routes?.[0]?.geometry?.coordinates;
    if (!line?.length) throw new Error('No road route between those points. Move a waypoint onto a road.');
    const mapped = line.map(([lon, lat]) => ({ lat, lon }));
    out.push(...(out.length ? mapped.slice(1) : mapped));
  }
  return out;
}
