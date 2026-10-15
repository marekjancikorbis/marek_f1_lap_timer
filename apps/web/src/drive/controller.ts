import {
  computeSectorBoundaries,
  LapTimer,
  lapProfileFromTrace,
  simulateDrive,
  simulateTrackDrive,
  type Fix,
  type GpsLog,
  type MotionSample,
  type LapResult,
  type PreparedRoute,
  type TimerEvent,
} from '@laptimer/timing';
import { markRouteHasRuns, newRunId, saveRun } from '../lib/data';
import { flatToLatLon, preparedFor } from '../lib/geo';
import type { Route, Run, SectorColourName } from '../lib/types';
import { saveLog } from './gpslogs';
import { Sounds } from './sounds';

/** No fix for this long and the HUD says the signal is lost (fixes normally come every ≤1 s). */
const GPS_LOST_MS = 3000;

export type DisplayMode = 'hud' | 'delta';

export interface DriveConfig {
  route: Route;
  uid: string;
  reference: { splits: number[]; label: string; ref: string } | null;
  /** Fastest posted sectors (purple); null on private routes, which have no purple. */
  records: (number | null)[] | null;
  /** Your best sector times on this route so far (green). */
  personalBests: (number | null)[];
  countdownS: number;
  mode: DisplayMode;
  voice: boolean;
  replay: boolean;
  /** Replay this recorded session instead of a generated one. */
  replayLog?: GpsLog | null;
}

export interface SectorInfo {
  k: number;
  count: number;
  splitMs: number;
  sectorMs: number;
  deltaMs: number | null;
  colour: SectorColourName;
}

export interface DriveState {
  phase: LapTimer['phase'];
  lap: number;
  /** Absolute start time of the running lap (Date.now() base). */
  lapStartT: number | null;
  penaltyMs: number;
  goT: number | null;
  lastSector: SectorInfo | null;
  sectorsThisLap: SectorInfo[];
  speed: number | null;
  accuracy: number | null;
  distanceToGateM: number | null;
  nextSector: number;
  jumpBannerUntil: number;
  reactionMs: number | null;
  gpsOk: boolean;
  gpsError: string | null;
  invalidReason: string | null;
  savedRunIds: string[];
  finished: boolean;
  laps: LapResult[];
}

/** Compact trace for storage: t, s, v, lat, lon per point. */
function packTrace(lap: LapResult): number[] {
  return lap.trace.flatMap((p) => [p.t, Math.round(p.s * 10) / 10, Math.round(p.v * 100) / 100, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]);
}

function spoken(ms: number): string {
  const v = Math.abs(ms) / 1000;
  const whole = Math.floor(v);
  const tenths = Math.round((v - whole) * 10);
  const sign = ms < 0 ? 'minus' : 'plus';
  return `${sign} ${whole === 0 ? 'zero' : whole} point ${tenths === 10 ? 9 : tenths}`;
}

export class DriveController {
  readonly timer: LapTimer;
  readonly prepared: PreparedRoute;
  readonly sounds = new Sounds();
  readonly sessionId = crypto.randomUUID();
  state: DriveState;
  private listeners = new Set<(s: DriveState) => void>();
  private watchId: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private replayTimer: number | null = null;
  private rafId: number | null = null;
  private motionHandler = (e: DeviceMotionEvent) => this.onMotion(e);
  private visibilityHandler = () => this.onVisibility();
  /** Raw session record for real drives (null in replay), kept for desk replays and test fixtures. */
  private log: GpsLog | null = null;
  /** Wall-clock time the last fix arrived, to notice a lost signal between fixes. */
  private lastFixAt = 0;

  constructor(readonly cfg: DriveConfig) {
    this.prepared = preparedFor(cfg.route);
    const boundaries = cfg.route.boundaries?.length ? cfg.route.boundaries : computeSectorBoundaries(this.prepared.lengthM, cfg.route.sectorLengthM);
    this.timer = new LapTimer({
      route: this.prepared,
      boundaries,
      isLoop: cfg.route.isLoop,
      startType: cfg.route.startType,
      reference: cfg.reference?.splits ?? null,
      sectorRecords: cfg.records,
      personalBests: cfg.personalBests,
      countdownS: cfg.countdownS,
    });
    if (!cfg.replay) {
      this.log = {
        version: 1,
        recordedAt: Date.now(),
        userAgent: navigator.userAgent,
        route: {
          id: cfg.route.id,
          name: cfg.route.name,
          coords: flatToLatLon(cfg.route.coords),
          isLoop: cfg.route.isLoop,
          startType: cfg.route.startType,
          boundaries,
        },
        countdownS: cfg.countdownS,
        fixes: [],
        motion: [],
        controls: [],
      };
    }
    this.state = {
      phase: this.timer.phase,
      lap: 0,
      lapStartT: null,
      penaltyMs: 0,
      goT: null,
      lastSector: null,
      sectorsThisLap: [],
      speed: null,
      accuracy: null,
      distanceToGateM: null,
      nextSector: 0,
      jumpBannerUntil: 0,
      reactionMs: null,
      gpsOk: false,
      gpsError: null,
      invalidReason: null,
      savedRunIds: [],
      finished: false,
      laps: [],
    };
  }

  subscribe(fn: (s: DriveState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(patch: Partial<DriveState>) {
    this.state = { ...this.state, ...patch, phase: this.timer.phase };
    this.listeners.forEach((l) => l(this.state));
  }

  // -------------------------------------------------------------- lifecycle

  async start() {
    await this.sounds.unlock();
    void this.requestWakeLock();
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('devicemotion', this.motionHandler);
    if (this.cfg.replayLog) this.startLogReplay(this.cfg.replayLog);
    else if (this.cfg.replay) this.startReplay();
    else this.startGps();
    const loop = () => {
      const now = Date.now();
      this.handle(this.timer.tick(now));
      if (this.state.gpsOk && now - this.lastFixAt > GPS_LOST_MS) {
        this.emit({ gpsOk: false, speed: null, gpsError: 'GPS signal lost. Timing carries on when it returns; after 30 s the run ends.' });
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    if (this.replayTimer != null) window.clearTimeout(this.replayTimer);
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('devicemotion', this.motionHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    void this.wakeLock?.release().catch(() => undefined);
    this.sounds.close();
    window.speechSynthesis?.cancel();
    this.saveLog();
  }

  private saveLog() {
    if (this.log?.fixes.length) saveLog(this.log);
  }

  private async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* not supported or denied: the HUD still works, the screen may dim */
    }
  }

  private onVisibility() {
    if (document.visibilityState === 'visible') void this.requestWakeLock();
    // The browser may kill a hidden tab: keep what was recorded so far.
    else this.saveLog();
  }

  // -------------------------------------------------------------- inputs

  private startGps() {
    if (!navigator.geolocation) {
      this.emit({ gpsError: 'This device has no GPS access.' });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        const fix: Fix = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          // The fix's own timestamp, never the time we received it.
          t: p.timestamp,
          accuracy: p.coords.accuracy,
          speed: p.coords.speed,
          heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
        };
        this.onFix(fix);
      },
      (err) => {
        this.emit({
          gpsOk: false,
          gpsError: err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Allow it in your browser settings.' : 'Waiting for GPS…',
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  /**
   * Desk-test mode: synthesise a drive along the route in real time, so the
   * whole flow (countdown, sectors, delta, summary) can be tried without a car.
   */
  private startReplay() {
    const standing = this.cfg.route.startType === 'standing';
    const t0 = Date.now();
    // Rolling: corner-limited speeds, braking zones and drifting GPS error, with grip
    // and top speed varied per run so laps and sector colours differ.
    const fixes = !standing
      ? simulateTrackDrive(this.prepared, {
          vMaxKmh: 140 + Math.random() * 50,
          latAccel: 7 + Math.random() * 3,
          leadInM: 120,
          laps: this.cfg.route.isLoop ? 2 : 1,
          loop: this.cfg.route.isLoop,
          startT: t0,
          noiseM: 2.5,
          speedNoise: 0.3,
          jitterMs: 30,
          seed: Math.floor(Math.random() * 1e6),
        }).fixes
      : simulateDrive(this.prepared, {
      speedKmh: 70 + Math.random() * 30,
      leadInM: standing ? 0 : 120,
      holdS: standing ? 3 : 0,
      laps: this.cfg.route.isLoop ? 2 : 1,
      loop: this.cfg.route.isLoop,
      startT: t0,
      noiseM: 1.5,
      seed: Math.floor(Math.random() * 1e6),
      sectorPace: Array.from({ length: 12 }, () => 0.85 + Math.random() * 0.3),
      sectorLengthM: this.cfg.route.sectorLengthM,
    });
    let i = 0;
    let offset = 0;
    let launched = !standing;
    const step = () => {
      if (i >= fixes.length) return;
      const f = fixes[i];
      // Standing start: hold at the line until the countdown is tapped and GO
      // passes, then shift the rest of the drive to launch just after GO.
      if (!launched) {
        if (this.state.goT == null || Date.now() < this.state.goT + 300) {
          this.onFix({ ...f, t: Date.now(), speed: 0 });
          // Gravity only: the at-rest baseline the jump-start detector needs.
          this.handle(this.timer.motion({ t: Date.now(), x: 0, y: 0, z: 9.81 }));
          this.replayTimer = window.setTimeout(step, 1000);
          return;
        }
        launched = true;
        while (i < fixes.length && (fixes[i].speed ?? 0) === 0) i++;
        // The launch happens now, at the last stationary fix; the first moving fix follows one interval later.
        offset = Date.now() - fixes[i - 1].t;
        this.simulateLaunchMotion();
        this.replayTimer = window.setTimeout(step, Math.max(0, fixes[i].t + offset - Date.now()));
        return;
      }
      const fix = { ...fixes[i], t: fixes[i].t + offset };
      i++;
      this.onFix(fix);
      const next = fixes[i];
      if (next) this.replayTimer = window.setTimeout(step, Math.max(0, next.t + offset - Date.now()));
      else this.replayTimer = window.setTimeout(() => this.endReplay(), 1000);
    };
    step();
  }

  /** Desk-test a real recorded session, shifted to start now, including its countdown taps. */
  private startLogReplay(log: GpsLog) {
    const items: { t: number; run: () => void }[] = [
      ...log.fixes.map((f) => ({ t: f.t, run: () => this.onFix({ ...f, t: f.t + offset }) })),
      ...log.motion.map((m) => ({ t: m.t, run: () => this.handle(this.timer.motion({ ...m, t: m.t + offset })) })),
      ...log.controls.map((c) => ({ t: c.t, run: () => (c.type === 'countdown' ? this.startCountdown(c.t + offset) : this.cancelCountdown()) })),
    ].sort((a, b) => a.t - b.t);
    if (!items.length) return;
    const offset = Date.now() - items[0].t;
    let i = 0;
    const step = () => {
      // Run everything due now; motion comes at ~60 Hz, faster than timers fire.
      while (i < items.length && items[i].t + offset <= Date.now()) items[i++].run();
      if (i < items.length) this.replayTimer = window.setTimeout(step, Math.max(0, items[i].t + offset - Date.now()));
      else this.replayTimer = window.setTimeout(() => this.endReplay(), 1000);
    };
    step();
  }

  /** The recorded/generated data ran out: end the session like a Stop, keeping completed laps. */
  private endReplay() {
    this.handle(this.timer.stop());
    this.emit({ finished: true });
  }

  private simulateLaunchMotion() {
    const start = Date.now();
    const id = window.setInterval(() => {
      const t = Date.now();
      this.handle(this.timer.motion({ t, x: 3, y: 0, z: 9.81 }));
      if (t - start > 800) window.clearInterval(id);
    }, 20);
  }

  private onMotion(e: DeviceMotionEvent) {
    if (this.cfg.replay) return;
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const sample: MotionSample = { t: Date.now(), x: a.x, y: a.y, z: a.z };
    if (this.log && this.motionMatters(sample.t)) this.log.motion.push(sample);
    this.handle(this.timer.motion(sample));
  }

  /** The engine only uses motion around a standing start; recording more would fill storage. */
  private motionMatters(t: number): boolean {
    const p = this.timer.phase;
    if (this.cfg.route.startType !== 'standing') return false;
    return p === 'ready' || p === 'countdown' || (p === 'running' && this.state.lap === 0 && this.state.goT != null && t < this.state.goT + 10_000);
  }

  private onFix(fix: Fix) {
    this.lastFixAt = Date.now();
    this.log?.fixes.push(fix);
    const events = this.timer.push(fix);
    this.emit({
      gpsOk: true,
      gpsError: null,
      speed: fix.speed,
      accuracy: fix.accuracy,
      distanceToGateM: this.timer.distanceToNextGateM,
      nextSector: this.timer.nextSector,
    });
    this.handle(events);
  }

  // -------------------------------------------------------------- controls

  /** The only tap during a run: start the countdown while stopped at the line. */
  startCountdown(tap = Date.now()) {
    const goT = this.timer.startCountdown(tap);
    if (goT == null) return;
    this.log?.controls.push({ t: tap, type: 'countdown' });
    this.sounds.countdown(this.cfg.countdownS);
    this.emit({ goT });
  }

  cancelCountdown() {
    this.log?.controls.push({ t: Date.now(), type: 'cancel' });
    this.sounds.stop();
    this.handle(this.timer.cancelCountdown());
    this.emit({ goT: null });
  }

  /** Stop: keeps completed laps, discards the lap in progress. */
  async stop(): Promise<string[]> {
    this.handle(this.timer.stop());
    this.emit({ finished: true });
    this.dispose();
    return this.state.savedRunIds;
  }

  // -------------------------------------------------------------- events

  private handle(events: TimerEvent[]) {
    for (const ev of events) {
      switch (ev.type) {
        case 'started':
          if (ev.lap === 0 && this.cfg.route.startType === 'rolling') this.sounds.gate();
          this.emit({ lap: ev.lap, lapStartT: ev.t, sectorsThisLap: [], goT: this.state.goT });
          break;
        case 'jumpStart':
          this.sounds.alarm();
          navigator.vibrate?.([200, 100, 200]);
          this.emit({ penaltyMs: ev.penaltyMs, jumpBannerUntil: Date.now() + 4000 });
          break;
        case 'reaction':
          this.emit({ reactionMs: ev.reactionMs });
          break;
        case 'sector': {
          const info: SectorInfo = { k: ev.k, count: ev.count, splitMs: ev.splitMs, sectorMs: ev.sectorMs, deltaMs: ev.deltaMs, colour: ev.colour };
          this.sounds.gate(ev.colour);
          navigator.vibrate?.(ev.colour === 'purple' ? [60, 40, 60] : 60);
          if (this.cfg.voice) this.say(ev.k, ev.deltaMs, ev.colour);
          this.emit({ lastSector: info, sectorsThisLap: [...this.state.sectorsThisLap, info] });
          break;
        }
        case 'lapComplete':
          void this.persist(ev.result);
          this.emit({ laps: [...this.state.laps, ev.result], penaltyMs: 0 });
          break;
        case 'finished':
          this.sounds.finish();
          this.emit({ finished: true });
          break;
        case 'invalidated':
          this.sounds.alarm();
          this.emit({
            invalidReason:
              ev.reason === 'off_route' ? 'You left the route.' : ev.reason === 'gps_gap' ? 'GPS signal was lost for too long.' : 'Stopped before the finish.',
          });
          break;
        case 'ready':
          this.sounds.tick();
          break;
      }
    }
  }

  private say(k: number, delta: number | null, colour: SectorColourName) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const parts = [`Sector ${k + 1}`];
    if (delta != null) parts.push(spoken(delta));
    if (colour === 'purple') parts.push('purple');
    synth.cancel();
    const u = new SpeechSynthesisUtterance(parts.join(', '));
    u.rate = 1.15;
    synth.speak(u);
  }

  private async persist(lap: LapResult) {
    const id = newRunId(this.cfg.uid);
    const run: Omit<Run, 'createdAt'> = {
      id,
      routeId: this.cfg.route.id,
      shapeVersion: this.cfg.route.shapeVersion ?? 0,
      routeName: this.cfg.route.name,
      sessionId: this.sessionId,
      lap: lap.lap,
      startedAt: Math.round(lap.startT),
      totalMs: lap.totalMs,
      splitTimesMs: lap.splitTimesMs,
      penaltyMs: lap.penaltyMs,
      reactionMs: lap.reactionMs,
      jumpStart: lap.jumpStart,
      jumpDistanceM: lap.jumpDistanceM,
      countdownS: lap.countdownS,
      valid: lap.valid,
      gpsAvgAccuracyM: lap.gpsAvgAccuracyM,
      gpsRateHz: lap.gpsRateHz,
      profile: lapProfileFromTrace(lap.trace, this.prepared.lengthM),
      trace: packTrace(lap),
      posted: false,
      replay: this.cfg.replay,
      referenceRef: this.cfg.reference?.ref ?? null,
    };
    await saveRun(this.cfg.uid, run);
    if (this.cfg.route.ownerId === this.cfg.uid) void markRouteHasRuns(this.cfg.route);
    this.emit({ savedRunIds: [...this.state.savedRunIds, id] });
  }
}
