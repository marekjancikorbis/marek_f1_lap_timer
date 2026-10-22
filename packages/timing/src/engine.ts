import { LatLon, headingDiff } from './geo';
import { PreparedRoute } from './route';
import { SectorColour, sectorColour } from './sectors';

export interface Fix extends LatLon {
  /** GPS fix timestamp, ms. Always use the fix time, never the time it was received. */
  t: number;
  /** Horizontal accuracy, metres. */
  accuracy: number;
  /** Doppler speed, m/s, when the receiver reports it. */
  speed: number | null;
  /** Course over ground, degrees, when the receiver reports it. */
  heading: number | null;
}

/** Raw accelerometer sample including gravity, m/s², on the GPS time base. */
export interface MotionSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export type StartType = 'standing' | 'rolling';

export const DEFAULTS = {
  ARM_DISTANCE_M: 50,
  ARM_HEADING_DEG: 60,
  STANDING_ZONE_M: 15,
  STATIONARY_SPEED_MS: 1 / 3.6,
  STATIONARY_HOLD_MS: 2000,
  OFF_ROUTE_M: 30,
  OFF_ROUTE_HOLD_MS: 4000,
  POOR_ACCURACY_M: 20,
  /** Rally stages run through forests and tunnels: ride out dropouts this long. */
  GPS_GAP_MS: 30_000,
  JUMP_START_THRESHOLD_M: 10,
  JUMP_START_PENALTY_MS: 5000,
  MOTION_ACCEL_G: 0.1,
  MOTION_HOLD_MS: 300,
  MOTION_DOPPLER_MS: 1.5,
  COUNTDOWN_POOR_ACCURACY_M: 15,
  /** How long after GO to wait for fixes before deciding a jump start. */
  JUMP_DECISION_DELAY_MS: 1500,
};

export type Thresholds = typeof DEFAULTS;

export interface TimerConfig {
  route: PreparedRoute;
  /** Frozen sector boundaries (distance along the route at each sector end). */
  boundaries: number[];
  isLoop: boolean;
  startType: StartType;
  /** Reference lap splits (same boundaries), for the delta. */
  reference?: number[] | null;
  /** The driver's best time per sector so far, for green. Improved during the session. */
  personalBests?: (number | null)[] | null;
  /** Fastest posted time per sector, for purple. null = private route: no purple. Improved during the session. */
  sectorRecords?: (number | null)[] | null;
  countdownS?: number;
  thresholds?: Partial<Thresholds>;
}

export interface TracePoint {
  /** ms since lap start. */
  t: number;
  /** Distance along the route, m. */
  s: number;
  /** Speed, m/s. */
  v: number;
  lat: number;
  lon: number;
  acc: number;
}

export interface LapResult {
  lap: number;
  /** Absolute start time (GPS time base). */
  startT: number;
  /** Cumulative split at each sector end; includes penaltyMs. */
  splitTimesMs: number[];
  totalMs: number;
  penaltyMs: number;
  jumpStart: boolean;
  jumpDistanceM: number | null;
  countdownS: number | null;
  valid: boolean;
  gpsAvgAccuracyM: number;
  gpsRateHz: number;
  trace: TracePoint[];
}

export type InvalidReason = 'off_route' | 'gps_gap' | 'stopped';

export type TimerEvent =
  | { type: 'armed' }
  | { type: 'disarmed' }
  | { type: 'ready' }
  | { type: 'notReady' }
  | { type: 'countdownStarted'; goT: number }
  | { type: 'countdownCancelled' }
  | { type: 'started'; t: number; lap: number }
  | { type: 'jumpStart'; distanceM: number; penaltyMs: number }
  | {
      type: 'sector';
      lap: number;
      k: number;
      count: number;
      splitMs: number;
      sectorMs: number;
      deltaMs: number | null;
      colour: SectorColour;
    }
  | { type: 'lapComplete'; result: LapResult }
  | { type: 'finished'; result: LapResult }
  | { type: 'invalidated'; reason: InvalidReason };

export type Phase =
  | 'waiting'
  | 'armed'
  | 'ready'
  | 'countdown'
  | 'running'
  | 'finished'
  | 'invalid';

interface LapState {
  lap: number;
  startT: number;
  splits: number[];
  k: number;
  trace: TracePoint[];
  accSum: number;
  fixCount: number;
}

const G = 9.80665;

/**
 * The timing engine. Feed it GPS fixes, accelerometer samples and clock
 * ticks; it returns the events each input caused. It holds no timers and
 * reads no clocks, so the phone and the replay tests drive it identically.
 */
export class LapTimer {
  readonly cfg: Required<Omit<TimerConfig, 'thresholds'>> & { th: Thresholds };
  phase: Phase = 'waiting';

  private lastFix: Fix | null = null;
  private sLast = 0;
  private offRouteSince: number | null = null;
  private lapState: LapState | null = null;
  private lapsDone: LapResult[] = [];

  // Standing start
  private stationarySince: number | null = null;
  private anchorFixes: Fix[] = [];
  private goT: number | null = null;
  private countdownPoorAccuracy = false;
  private baseline: { x: number; y: number; z: number; n: number } | null = null;
  private accelLp = 0;
  private accelLastT: number | null = null;
  private accelAboveSince: number | null = null;
  private accelMotionT: number | null = null;
  private accelSeen = false;
  private motionFixes: Fix[] = [];
  private jumpPending = false;
  private penaltyMs = 0;
  private jumpStart = false;
  private jumpDistanceM: number | null = null;
  /** The lap clock has been moved from GO to the moment the car moved off. */
  private startShifted = false;

  constructor(config: TimerConfig) {
    this.cfg = {
      route: config.route,
      boundaries: config.boundaries,
      isLoop: config.isLoop,
      startType: config.startType,
      reference: config.reference ?? null,
      // Copies: the session improves them as it goes, so lap 2 races lap 1's sectors.
      personalBests: config.personalBests ? [...config.personalBests] : [],
      sectorRecords: config.sectorRecords ? [...config.sectorRecords] : null,
      countdownS: Math.min(10, Math.max(3, Math.round(config.countdownS ?? 5))),
      th: { ...DEFAULTS, ...config.thresholds },
    };
  }

  get laps(): readonly LapResult[] {
    return this.lapsDone;
  }

  get currentLap(): number {
    return this.lapState?.lap ?? this.lapsDone.length;
  }

  /** Elapsed time of the running lap at absolute time t, or null. */
  elapsedAt(t: number): number | null {
    if (!this.lapState) return null;
    return Math.max(0, t - this.lapState.startT) + (this.lapState.lap === 0 ? this.penaltyMs : 0);
  }

  /** Distance along the route of the latest fix. */
  get distanceM(): number {
    return this.sLast;
  }

  /** Distance to the next gate, or null when not running. */
  get distanceToNextGateM(): number | null {
    if (!this.lapState) return null;
    const b = this.cfg.boundaries[this.lapState.k];
    return b == null ? null : Math.max(0, b - this.sLast);
  }

  get nextSector(): number {
    return this.lapState?.k ?? 0;
  }

  get countdownGoT(): number | null {
    return this.phase === 'countdown' ? this.goT : null;
  }

  // ---------------------------------------------------------------- inputs

  push(fix: Fix): TimerEvent[] {
    const out: TimerEvent[] = [];
    if (this.phase === 'finished' || this.phase === 'invalid') return out;
    if (this.lastFix && fix.t <= this.lastFix.t) return out; // ignore duplicates / reordering
    this.tickTo(fix.t, out);

    switch (this.phase) {
      case 'waiting':
      case 'armed':
        if (this.cfg.startType === 'rolling') this.handleRollingApproach(fix, out);
        else this.handleStandingApproach(fix, out);
        break;
      case 'ready':
        this.handleStandingApproach(fix, out);
        break;
      case 'countdown':
        this.handleCountdownFix(fix);
        break;
      case 'running':
        this.handleRunningFix(fix, out);
        break;
    }
    this.lastFix = fix;
    return out;
  }

  motion(sample: MotionSample): TimerEvent[] {
    const out: TimerEvent[] = [];
    this.accelSeen = true;
    if (this.phase === 'ready' || (this.phase === 'countdown' && this.baseline && this.baseline.n < 20)) {
      // Capture gravity + mount angle while the car is known to be still.
      const b = this.baseline ?? { x: 0, y: 0, z: 0, n: 0 };
      b.n += 1;
      b.x += (sample.x - b.x) / b.n;
      b.y += (sample.y - b.y) / b.n;
      b.z += (sample.z - b.z) / b.n;
      this.baseline = b;
      this.accelLastT = sample.t;
      return out;
    }
    const watching =
      this.cfg.startType === 'standing' &&
      this.baseline &&
      this.accelMotionT == null &&
      (this.phase === 'countdown' || (this.phase === 'running' && this.lapState?.lap === 0));
    if (!watching || !this.baseline) return out;

    const lin =
      Math.hypot(sample.x - this.baseline.x, sample.y - this.baseline.y, sample.z - this.baseline.z) / G;
    const dt = this.accelLastT == null ? 0 : Math.max(0, sample.t - this.accelLastT);
    this.accelLastT = sample.t;
    // First-order low-pass, tau = 150 ms: door slams and revs are short spikes.
    const alpha = dt > 0 ? 1 - Math.exp(-dt / 150) : 1;
    this.accelLp += alpha * (lin - this.accelLp);
    if (this.accelLp > this.cfg.th.MOTION_ACCEL_G) {
      this.accelAboveSince ??= sample.t;
      if (sample.t - this.accelAboveSince >= this.cfg.th.MOTION_HOLD_MS) {
        this.accelMotionT = this.accelAboveSince;
        this.maybeShiftStart(out);
      }
    } else {
      this.accelAboveSince = null;
    }
    return out;
  }

  /** Advance the clock without a fix (drives the countdown → GO transition). */
  tick(t: number): TimerEvent[] {
    const out: TimerEvent[] = [];
    this.tickTo(t, out);
    return out;
  }

  /**
   * Start the standing-start countdown. tapT is on the GPS time base. GO comes
   * exactly countdownS seconds later, with no random hold.
   */
  startCountdown(tapT: number): number | null {
    if (this.phase !== 'ready') return null;
    this.goT = tapT + this.cfg.countdownS * 1000;
    this.phase = 'countdown';
    this.countdownPoorAccuracy = false;
    this.motionFixes = [];
    this.accelLp = 0;
    this.accelAboveSince = null;
    this.accelMotionT = null;
    return this.goT;
  }

  /** Cancel before GO, with no penalty. */
  cancelCountdown(): TimerEvent[] {
    if (this.phase !== 'countdown') return [];
    this.phase = 'ready';
    this.goT = null;
    return [{ type: 'countdownCancelled' }];
  }

  /**
   * Stop the session. A lap in progress is discarded (it never crossed the
   * finish). Completed laps are kept.
   */
  stop(): TimerEvent[] {
    if (this.phase === 'finished' || this.phase === 'invalid') return [];
    const hadLaps = this.lapsDone.length > 0;
    this.lapState = null;
    this.phase = hadLaps ? 'finished' : 'invalid';
    return hadLaps ? [] : [{ type: 'invalidated', reason: 'stopped' }];
  }

  // ------------------------------------------------------------- approach

  /** Along-track (a, negative before the line) and cross-track (c) position relative to the start gate, metres. */
  relToStart(fix: LatLon): { a: number; c: number } {
    const r = this.cfg.route;
    const q = r.proj.toXY(fix);
    const p0 = r.startXY;
    const { x: ux, y: uy } = r.startDir;
    const dx = q.x - p0.x;
    const dy = q.y - p0.y;
    return { a: dx * ux + dy * uy, c: Math.abs(dx * -uy + dy * ux) };
  }

  private handleRollingApproach(fix: Fix, out: TimerEvent[]): void {
    const th = this.cfg.th;
    const { a, c } = this.relToStart(fix);
    const moving = (fix.speed ?? 0) > 1;
    const headingOk =
      fix.heading == null || !moving || headingDiff(fix.heading, this.cfg.route.startHeading) < th.ARM_HEADING_DEG;
    const inArmZone = a >= -th.ARM_DISTANCE_M && a < 0 && c < th.OFF_ROUTE_M && headingOk;

    if (this.phase === 'armed' && this.lastFix && a >= 0 && c < th.OFF_ROUTE_M) {
      const prev = this.relToStart(this.lastFix);
      if (prev.a < 0) {
        const tCross = interp(prev.a, this.lastFix.t, a, fix.t, 0);
        this.beginLap(tCross, out);
        this.sLast = a;
        this.recordTrace(fix, a);
        return;
      }
    }
    if (inArmZone && this.phase !== 'armed') {
      this.phase = 'armed';
      out.push({ type: 'armed' });
    } else if (!inArmZone && this.phase === 'armed' && a < 0) {
      this.phase = 'waiting';
      out.push({ type: 'disarmed' });
    }
  }

  private handleStandingApproach(fix: Fix, out: TimerEvent[]): void {
    const th = this.cfg.th;
    const { a, c } = this.relToStart(fix);
    const inZone = Math.abs(a) <= th.STANDING_ZONE_M && c <= th.STANDING_ZONE_M;
    const stationary = this.isStationary(fix);

    if (inZone && stationary) {
      this.stationarySince ??= fix.t;
      this.anchorFixes.push(fix);
      if (this.phase !== 'ready' && fix.t - this.stationarySince >= th.STATIONARY_HOLD_MS) {
        this.phase = 'ready';
        this.baseline = null;
        out.push({ type: 'ready' });
      }
    } else {
      this.stationarySince = null;
      this.anchorFixes = [];
      if (this.phase === 'ready') {
        this.phase = 'waiting';
        out.push({ type: 'notReady' });
      }
    }
  }

  private isStationary(fix: Fix): boolean {
    if (fix.speed != null) return fix.speed < this.cfg.th.STATIONARY_SPEED_MS;
    if (!this.lastFix) return false;
    const dt = (fix.t - this.lastFix.t) / 1000;
    const d = this.cfg.route.proj.toXY(fix);
    const p = this.cfg.route.proj.toXY(this.lastFix);
    // Without Doppler, position wander makes this noisy: be generous.
    return dt > 0 && Math.hypot(d.x - p.x, d.y - p.y) / dt < 1;
  }

  private handleCountdownFix(fix: Fix): void {
    if (fix.accuracy > this.cfg.th.COUNTDOWN_POOR_ACCURACY_M) this.countdownPoorAccuracy = true;
    if ((fix.speed ?? 0) < this.cfg.th.STATIONARY_SPEED_MS) this.anchorFixes.push(fix);
    this.motionFixes.push(fix);
  }

  // ------------------------------------------------------------ the clock

  private tickTo(t: number, out: TimerEvent[]): void {
    if (this.phase === 'countdown' && this.goT != null && t >= this.goT) {
      const anchor = this.anchor();
      this.beginLap(this.goT, out);
      this.sLast = anchor ? this.cfg.route.project(anchor, -50, 50).s : 0;
      this.jumpPending = true;
    }
    if (this.jumpPending && this.goT != null && t >= this.goT + this.cfg.th.JUMP_DECISION_DELAY_MS) {
      this.decideJumpStart(out);
    }
  }

  private anchor(): LatLon | null {
    const fixes = this.anchorFixes.slice(-30);
    if (!fixes.length) return null;
    return {
      lat: fixes.reduce((s, f) => s + f.lat, 0) / fixes.length,
      lon: fixes.reduce((s, f) => s + f.lon, 0) / fixes.length,
    };
  }

  // ------------------------------------------------------- jump starts

  private dopplerMotionFix(): Fix | null {
    const th = this.cfg.th;
    const heading = this.cfg.route.startHeading;
    return (
      this.motionFixes.find(
        (f) =>
          (f.speed ?? 0) > th.MOTION_DOPPLER_MS &&
          (f.heading == null || headingDiff(f.heading, heading) < 90),
      ) ?? null
    );
  }

  /** Estimated time the car first moved, from the accelerometer or, failing that, Doppler. */
  private motionStartT(): number | null {
    if (this.accelMotionT != null) return this.accelMotionT;
    const f = this.dopplerMotionFix();
    if (!f) return null;
    // Back-date from the first moving fix assuming ~3 m/s² launch. Only an estimate,
    // so it never claims a start before GO: that needs accelerometer evidence.
    const est = f.t - ((f.speed as number) / 3) * 1000;
    return this.goT != null ? Math.max(est, this.goT) : est;
  }

  /**
   * Standing starts time from the moment the car moves, not from GO, so a slow
   * launch costs nothing. A jump start keeps GO as the start and takes the penalty.
   */
  private maybeShiftStart(out: TimerEvent[]): void {
    if (this.startShifted || this.goT == null) return;
    if (this.phase !== 'running') return;
    if (this.jumpPending) return;
    const m = this.motionStartT();
    if (m == null) return;
    this.startShifted = true;
    const lap = this.lapState;
    if (this.jumpStart || !lap || lap.lap !== 0 || lap.splits.length || m <= this.goT) return;
    const shift = Math.round(m - this.goT);
    lap.startT += shift;
    lap.trace = lap.trace.filter((p) => p.t >= shift).map((p) => ({ ...p, t: p.t - shift }));
    out.push({ type: 'started', t: lap.startT, lap: 0 });
  }

  /**
   * Decide whether the car really moved more than the threshold before GO
   * (section 4.3.1). Distance is the integral of Doppler speed (which does
   * not drift like position does) from first confirmed motion to GO, counting
   * forward movement only. Benefit of the doubt goes to the driver.
   */
  private decideJumpStart(out: TimerEvent[]): void {
    this.jumpPending = false;
    const th = this.cfg.th;
    const goT = this.goT as number;
    const accelConfirmedBeforeGo = this.accelMotionT != null && this.accelMotionT < goT;
    const dopplerFix = this.dopplerMotionFix();
    // Both signals must agree. Phones without an accelerometer rely on Doppler.
    const motionBeforeGo = this.accelSeen
      ? accelConfirmedBeforeGo && dopplerFix != null
      : dopplerFix != null && this.motionStartT()! < goT;

    let distance = 0;
    if (motionBeforeGo) {
      const startT = this.motionStartT() as number;
      distance = integrateForwardSpeed(this.motionFixes, startT, goT, this.cfg.route.startHeading);
      if (distance > th.JUMP_START_THRESHOLD_M && this.countdownPoorAccuracy) {
        // Poor accuracy: position must also clearly show the car ahead of the anchor.
        const anchor = this.anchor();
        const settled = this.motionFixes.filter((f) => f.t >= goT).slice(0, 3);
        const sAnchor = anchor ? this.cfg.route.project(anchor, -50, 50).s : 0;
        const ahead =
          settled.length > 0 &&
          settled.every((f) => {
            const sf = this.cfg.route.project(f, -50, 200).s;
            const travelledSinceGo = (f.speed ?? 0) * ((f.t - goT) / 1000) * 0.5;
            return sf - travelledSinceGo - sAnchor > th.JUMP_START_THRESHOLD_M;
          });
        if (!ahead) distance = 0;
      }
    }

    if (distance > th.JUMP_START_THRESHOLD_M) {
      this.jumpStart = true;
      this.jumpDistanceM = Math.round(distance * 10) / 10;
      this.penaltyMs = th.JUMP_START_PENALTY_MS;
      // The penalty belongs to sector 1, so every split already recorded moves too.
      if (this.lapState && this.lapState.lap === 0) {
        this.lapState.splits = this.lapState.splits.map((s) => s + this.penaltyMs);
      }
      out.push({ type: 'jumpStart', distanceM: this.jumpDistanceM, penaltyMs: this.penaltyMs });
    } else if (motionBeforeGo) {
      this.jumpDistanceM = Math.round(distance * 10) / 10;
    }
    this.maybeShiftStart(out);
  }

  // --------------------------------------------------------- running

  private beginLap(t: number, out: TimerEvent[]): void {
    const lap = this.lapsDone.length;
    this.lapState = { lap, startT: t, splits: [], k: 0, trace: [], accSum: 0, fixCount: 0 };
    this.phase = 'running';
    this.offRouteSince = null;
    out.push({ type: 'started', t, lap });
  }

  private handleRunningFix(fix: Fix, out: TimerEvent[]): void {
    const th = this.cfg.th;
    const prev = this.lastFix;
    if (this.jumpPending) this.motionFixes.push(fix);

    if (prev && fix.t - prev.t > th.GPS_GAP_MS) {
      this.invalidate('gps_gap', out);
      return;
    }

    const dt = prev ? (fix.t - prev.t) / 1000 : 1;
    const v = fix.speed ?? 30;
    const L = this.cfg.route.lengthM;
    const sMax = this.sLast + Math.max(150, v * dt * 2 + 100);
    let pr = this.cfg.route.project(fix, this.sLast - 30, sMax);
    // Loop: past the finish the car is on the route's first metres again, which
    // fits far better than a straight extension past the end.
    if (this.cfg.isLoop && sMax > L) {
      const wrap = this.cfg.route.project(fix, 0, sMax - L);
      if (wrap.e < pr.e) pr = { ...wrap, s: wrap.s + L };
    }

    if (pr.e > th.OFF_ROUTE_M) {
      this.offRouteSince ??= fix.t;
      if (fix.t - this.offRouteSince > th.OFF_ROUTE_HOLD_MS) {
        this.invalidate('off_route', out);
        return;
      }
    } else {
      this.offRouteSince = null;
    }

    let s = pr.s;
    const lap = this.lapState as LapState;
    lap.accSum += fix.accuracy;
    lap.fixCount += 1;

    // Gate crossings, interpolated between the two fixes either side.
    if (prev) {
      let sPrev = this.sLast;
      while (this.lapState && s > sPrev) {
        const cur = this.lapState;
        const b = this.cfg.boundaries[cur.k];
        if (b == null || !(sPrev < b && b <= s)) break;
        if (this.jumpPending) this.decideJumpStart(out);
        const tCross = interp(sPrev, prev.t, s, fix.t, b);
        const finishedLap = this.crossGate(tCross, fix, s, out);
        if (finishedLap && this.cfg.isLoop && this.phase === 'running') {
          // Next lap starts at the same instant; shift s into the new lap.
          s -= this.cfg.route.lengthM;
          sPrev -= this.cfg.route.lengthM;
        } else if (finishedLap) {
          this.sLast = s;
          return;
        }
      }
    }

    this.sLast = s;
    this.recordTrace(fix, s);
  }

  private crossGate(tCross: number, fix: Fix, s: number, out: TimerEvent[]): boolean {
    const lap = this.lapState as LapState;
    const k = lap.k;
    const count = this.cfg.boundaries.length;
    const penalty = lap.lap === 0 ? this.penaltyMs : 0;
    const split = Math.round(tCross - lap.startT) + penalty;
    const sectorMs = k === 0 ? split : split - lap.splits[k - 1];
    lap.splits.push(split);
    lap.k += 1;

    const ref = this.cfg.reference;
    const refSector = ref && ref[k] != null ? (k === 0 ? ref[0] : ref[k] - ref[k - 1]) : null;
    const pbs = this.cfg.personalBests as (number | null)[]; // always an array, see the constructor
    const records = this.cfg.sectorRecords;
    const isPublic = records != null;
    let colour = sectorColour(sectorMs, pbs[k], records?.[k], isPublic, refSector);
    // A jump-start first sector can't be purple (no record or best from a jumped start).
    if (k === 0 && lap.lap === 0 && this.jumpStart && colour === 'purple') {
      colour = isPublic ? (pbs[k] == null || sectorMs < pbs[k]! ? 'green' : 'yellow') : refSector != null && sectorMs < refSector ? 'green' : 'yellow';
    }
    if (pbs[k] == null || sectorMs < pbs[k]!) pbs[k] = sectorMs;
    if (records && colour === 'purple') records[k] = sectorMs;
    out.push({
      type: 'sector',
      lap: lap.lap,
      k,
      count,
      splitMs: split,
      sectorMs,
      deltaMs: ref && ref[k] != null ? split - ref[k] : null,
      colour,
    });

    // Gate point for the trace, so lap profiles end exactly on the line.
    const gate = this.cfg.route.pointAt(this.cfg.boundaries[k]);
    lap.trace.push({
      t: Math.round(tCross - lap.startT),
      s: this.cfg.boundaries[k],
      v: fix.speed ?? 0,
      lat: gate.lat,
      lon: gate.lon,
      acc: fix.accuracy,
    });

    if (lap.k < count) return false;

    const result = this.lapResult(lap);
    this.lapsDone.push(result);
    if (this.cfg.isLoop) {
      out.push({ type: 'lapComplete', result });
      this.beginLap(tCross, out);
      // Carry the finish point over as the new lap's first trace point.
      this.lapState!.trace.push({ t: 0, s: 0, v: fix.speed ?? 0, lat: gate.lat, lon: gate.lon, acc: fix.accuracy });
    } else {
      this.lapState = null;
      this.phase = 'finished';
      out.push({ type: 'lapComplete', result });
      out.push({ type: 'finished', result });
    }
    void s;
    return true;
  }

  private recordTrace(fix: Fix, s: number): void {
    const lap = this.lapState;
    if (!lap) return;
    const prev = lap.trace[lap.trace.length - 1];
    let v = fix.speed;
    if (v == null) {
      v = prev ? Math.max(0, (s - prev.s) / Math.max(0.001, (fix.t - lap.startT - prev.t) / 1000)) : 0;
    }
    lap.trace.push({
      t: Math.round(fix.t - lap.startT),
      s: Math.round(s * 10) / 10,
      v: Math.round(v * 100) / 100,
      lat: fix.lat,
      lon: fix.lon,
      acc: fix.accuracy,
    });
  }

  private lapResult(lap: LapState): LapResult {
    const durS = lap.trace.length > 1 ? (lap.trace[lap.trace.length - 1].t - lap.trace[0].t) / 1000 : 0;
    const first = lap.lap === 0;
    return {
      lap: lap.lap,
      startT: lap.startT,
      splitTimesMs: [...lap.splits],
      totalMs: lap.splits[lap.splits.length - 1],
      penaltyMs: first ? this.penaltyMs : 0,
      jumpStart: first && this.jumpStart,
      jumpDistanceM: first ? this.jumpDistanceM : null,
      countdownS: first && this.cfg.startType === 'standing' ? this.cfg.countdownS : null,
      valid: true,
      gpsAvgAccuracyM: lap.fixCount ? Math.round((lap.accSum / lap.fixCount) * 10) / 10 : 0,
      gpsRateHz: durS > 0 ? Math.round((lap.fixCount / durS) * 100) / 100 : 0,
      trace: lap.trace,
    };
  }

  private invalidate(reason: InvalidReason, out: TimerEvent[]): void {
    this.lapState = null;
    // Completed laps of a loop session stay valid; only the lap in progress is lost.
    this.phase = this.lapsDone.length ? 'finished' : 'invalid';
    out.push({ type: 'invalidated', reason });
  }
}

/** Linear interpolation of the time at which s reached target. */
function interp(s0: number, t0: number, s1: number, t1: number, target: number): number {
  if (s1 === s0) return t1;
  return t0 + ((target - s0) / (s1 - s0)) * (t1 - t0);
}

/**
 * Integrate Doppler speed from startT to endT (speed assumed 0 at startT,
 * linear between fixes). Fixes heading against the route count as zero, so
 * rolling back on a hill never adds distance.
 */
export function integrateForwardSpeed(fixes: Fix[], startT: number, endT: number, routeHeading: number): number {
  const pts: { t: number; v: number }[] = [{ t: startT, v: 0 }];
  for (const f of fixes) {
    if (f.t <= startT) continue;
    const forward = f.heading == null || headingDiff(f.heading, routeHeading) < 90;
    pts.push({ t: f.t, v: forward ? Math.max(0, f.speed ?? 0) : 0 });
  }
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.t >= endT) break;
    const tb = Math.min(b.t, endT);
    const vb = b.t === a.t ? b.v : a.v + ((b.v - a.v) * (tb - a.t)) / (b.t - a.t);
    d += ((a.v + vb) / 2) * ((tb - a.t) / 1000);
  }
  // If GO came after the last fix, extrapolate at the last known speed.
  const last = pts[pts.length - 1];
  if (last.t < endT && pts.length > 1) d += last.v * ((endT - last.t) / 1000);
  return d;
}
