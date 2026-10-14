import { MAPBOX_TOKEN } from './config';
import { consume } from './usage';

/** Web Mercator x/y of a point in a 512-px world (Mapbox GL zoom 0), unscaled. */
function merc(lng: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * 512, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 512];
}

/**
 * Fit points into a W×H picture the way the Static Images API renders it, so a
 * line drawn with `project` lands exactly on the map picture at `url`.
 */
export function staticMapFit(pts: { lng: number; lat: number }[], W: number, H: number, pad: number) {
  const xy = pts.map((p) => merc(p.lng, p.lat));
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Two decimals, rounded down so the route still fits; capped so a short route keeps some context.
  const z = Math.min(16, Math.floor(Math.log2(Math.min((W - 2 * pad) / (x1 - x0 || 1e-9), (H - 2 * pad) / (y1 - y0 || 1e-9))) * 100) / 100);
  const k = 2 ** z;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const lng = (cx / 512) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / 512))) * 180) / Math.PI;
  return {
    url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${lng.toFixed(6)},${lat.toFixed(6)},${z}/${W}x${H}@2x?access_token=${MAPBOX_TOKEN}`,
    project: (p: { lng: number; lat: number }) => {
      const [x, y] = merc(p.lng, p.lat);
      return [W / 2 + (x - cx) * k, H / 2 + (y - cy) * k] as const;
    },
  };
}

// shortcut: counts each picture once a day per device (the browser cache serves repeats); a cleared cache can under-count slightly. Upgrade to a SW cache check if the cap gets close.
const KEY = 'static-maps-counted';
const DAY = 24 * 3600 * 1000;

/** Count a card picture against the monthly cap; false once the cap is reached (show the plain line). */
export async function allowStaticMap(url: string): Promise<boolean> {
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* storage blocked: count every time */
  }
  const now = Date.now();
  if (seen[url] && now - seen[url] < DAY) return true;
  try {
    await consume('staticMaps');
  } catch {
    return false;
  }
  for (const [u, t] of Object.entries(seen)) if (now - t >= DAY) delete seen[u];
  seen[url] = now;
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* fine: it just counts again next time */
  }
  return true;
}
