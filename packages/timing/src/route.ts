import { LatLon, LocalProjection, XY, headingOf } from './geo';

export const MIN_SECTOR_M = 50;
export const MAX_SECTOR_M = 1000;
export const SECTOR_STEP_M = 50;
const RESAMPLE_STEP_M = 2;
const DIR_SPAN_M = 10;

function unit(a: XY, b: XY): XY {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/**
 * Distances along the route at which each sector ends. The last boundary is
 * always the route length. A trailing sector shorter than half a sector
 * length is merged into the previous one.
 */
export function computeSectorBoundaries(lengthM: number, sectorLengthM: number): number[] {
  if (!(lengthM > 0)) throw new Error('route length must be positive');
  if (
    sectorLengthM < MIN_SECTOR_M ||
    sectorLengthM > MAX_SECTOR_M ||
    sectorLengthM % SECTOR_STEP_M !== 0
  ) {
    throw new Error(`sector length must be ${MIN_SECTOR_M}-${MAX_SECTOR_M} m in steps of ${SECTOR_STEP_M}`);
  }
  const boundaries: number[] = [];
  for (let d = sectorLengthM; d < lengthM; d += sectorLengthM) boundaries.push(d);
  const lastStart = boundaries.length ? boundaries[boundaries.length - 1] : 0;
  if (boundaries.length && lengthM - lastStart < sectorLengthM / 2) boundaries.pop();
  boundaries.push(round1(lengthM));
  return boundaries;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function polylineLengthM(coords: LatLon[]): number {
  if (coords.length < 2) return 0;
  const proj = new LocalProjection(coords[0]);
  let total = 0;
  let prev = proj.toXY(coords[0]);
  for (let i = 1; i < coords.length; i++) {
    const p = proj.toXY(coords[i]);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

export interface Projection {
  /** Distance along the route. Negative before the start, above length past the finish. */
  s: number;
  /** Lateral offset from the route line, metres (always >= 0). */
  e: number;
  /** Route heading at the projected point, degrees. */
  heading: number;
}

/**
 * A route resampled every ~2 m, with cumulative distance at each point, ready
 * for fast windowed projection of GPS fixes.
 */
export class PreparedRoute {
  readonly proj: LocalProjection;
  readonly pts: XY[];
  readonly cum: number[];
  readonly lengthM: number;

  constructor(coords: LatLon[]) {
    if (coords.length < 2) throw new Error('route needs at least two points');
    this.proj = new LocalProjection(coords[0]);
    const raw = coords.map((c) => this.proj.toXY(c));
    const pts: XY[] = [raw[0]];
    const cum: number[] = [0];
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1];
      const b = raw[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      const steps = Math.max(1, Math.ceil(len / RESAMPLE_STEP_M));
      const base = cum[cum.length - 1];
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        cum.push(base + len * f);
      }
    }
    this.pts = pts;
    this.cum = cum;
    this.lengthM = cum[cum.length - 1];
    // Direction over the first/last 10 m, not the first/last segment: a route can
    // start or end with a sliver segment whose heading is noise.
    const d = Math.min(DIR_SPAN_M, this.lengthM);
    this.startDir = unit(this.xyAt(0), this.xyAt(d));
    this.endDir = unit(this.xyAt(this.lengthM - d), this.xyAt(this.lengthM));
  }

  /** Unit direction of travel at the start and at the finish. */
  readonly startDir: XY;
  readonly endDir: XY;

  private xyAt(s: number): XY {
    return this.proj.toXY(this.pointAt(s));
  }

  get startXY(): XY {
    return this.pts[0];
  }

  /** Route heading at the start, degrees. */
  get startHeading(): number {
    return headingOf(this.startDir.x, this.startDir.y);
  }

  pointAt(s: number): LatLon {
    const clamped = Math.max(0, Math.min(this.lengthM, s));
    const i = this.segmentIndexAt(clamped);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const segLen = this.cum[i + 1] - this.cum[i];
    const f = segLen > 0 ? (clamped - this.cum[i]) / segLen : 0;
    return this.proj.toLatLon({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }

  headingAt(s: number): number {
    return this.segHeading(this.segmentIndexAt(Math.max(0, Math.min(this.lengthM, s))));
  }

  private segHeading(i: number): number {
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return headingOf(b.x - a.x, b.y - a.y);
  }

  /** Index of the segment containing distance s (binary search). */
  segmentIndexAt(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Project a point onto the route, searching only segments whose distance
   * lies within [sMin, sMax]. Restricting the window keeps self-crossing
   * routes and loops (start = finish) unambiguous. Past either end the
   * along-track coordinate is extended linearly, so s < 0 before the start
   * and s > length past the finish, which is what gate crossing needs.
   */
  project(p: LatLon, sMin = -Infinity, sMax = Infinity): Projection {
    const q = this.proj.toXY(p);
    const lo = this.segmentIndexAt(Math.max(0, sMin));
    const hi = this.segmentIndexAt(Math.min(this.lengthM, sMax));
    let best: Projection = { s: 0, e: Infinity, heading: 0 };
    for (let i = lo; i <= hi; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const segLen = Math.sqrt(len2);
      let t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const e = Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
      if (e < best.e) {
        best = { s: this.cum[i] + t * segLen, e, heading: headingOf(dx, dy) };
      }
    }
    // Before the start / past the finish: extend straight along the end directions,
    // with e measured perpendicular to that line.
    const ext = (o: XY, u: XY, sign: 1 | -1, base: number) => {
      const along = (q.x - o.x) * u.x + (q.y - o.y) * u.y;
      if (along * sign <= 0) return;
      const e = Math.abs((q.x - o.x) * -u.y + (q.y - o.y) * u.x);
      if (e < best.e) best = { s: base + along, e, heading: headingOf(u.x, u.y) };
    };
    if (lo === 0) ext(this.pts[0], this.startDir, -1, 0);
    if (hi === this.pts.length - 2) ext(this.pts[this.pts.length - 1], this.endDir, 1, this.lengthM);
    return best;
  }
}
