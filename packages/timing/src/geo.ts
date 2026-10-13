export interface LatLon {
  lat: number;
  lon: number;
}

export interface XY {
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local flat projection (equirectangular) around an origin. Accurate to well
 * under a metre over the tens of kilometres a route spans, and it makes
 * point-to-segment projection plain vector maths.
 */
export class LocalProjection {
  private readonly cosLat: number;

  constructor(readonly origin: LatLon) {
    this.cosLat = Math.cos(origin.lat * DEG);
  }

  toXY(p: LatLon): XY {
    return {
      x: (p.lon - this.origin.lon) * DEG * EARTH_RADIUS_M * this.cosLat,
      y: (p.lat - this.origin.lat) * DEG * EARTH_RADIUS_M,
    };
  }

  toLatLon(p: XY): LatLon {
    return {
      lat: this.origin.lat + p.y / EARTH_RADIUS_M / DEG,
      lon: this.origin.lon + p.x / (EARTH_RADIUS_M * this.cosLat) / DEG,
    };
  }
}

/** Compass heading in degrees (0 = north, clockwise) of the vector a→b in local XY. */
export function headingOf(dx: number, dy: number): number {
  const h = Math.atan2(dx, dy) / DEG;
  return (h + 360) % 360;
}

/** Smallest absolute difference between two headings, 0..180. */
export function headingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Offset a point by a distance (m) along a compass heading (deg). */
export function offsetLatLon(p: LatLon, distanceM: number, headingDeg: number): LatLon {
  const proj = new LocalProjection(p);
  return proj.toLatLon({
    x: distanceM * Math.sin(headingDeg * DEG),
    y: distanceM * Math.cos(headingDeg * DEG),
  });
}
