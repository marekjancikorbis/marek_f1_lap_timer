import { Fix, LapResult, LapTimer, MotionSample, StartType, TimerEvent } from './engine';
import { LatLon } from './geo';
import { PreparedRoute } from './route';

/**
 * Everything the phone saw during one drive session, so the session can be
 * replayed through the engine later: in the app (desk test) or as a test fixture.
 */
export interface GpsLog {
  version: 1;
  recordedAt: number;
  userAgent: string;
  route: {
    id: string;
    name: string;
    coords: LatLon[];
    isLoop: boolean;
    startType: StartType;
    boundaries: number[];
  };
  countdownS: number;
  fixes: Fix[];
  /** Only around a standing start, where the engine uses it. */
  motion: MotionSample[];
  controls: { t: number; type: 'countdown' | 'cancel' }[];
}

export interface LogReplay {
  events: TimerEvent[];
  laps: readonly LapResult[];
  phase: LapTimer['phase'];
}

/** Feed a recorded session through a fresh LapTimer, in time order. */
export function replayLog(log: GpsLog, reference: number[] | null = null): LogReplay {
  const timer = new LapTimer({
    route: new PreparedRoute(log.route.coords),
    boundaries: log.route.boundaries,
    isLoop: log.route.isLoop,
    startType: log.route.startType,
    countdownS: log.countdownS,
    reference,
  });
  type Item = { t: number; run: () => TimerEvent[] };
  const items: Item[] = [
    ...log.fixes.map((f) => ({ t: f.t, run: () => timer.push(f) })),
    ...log.motion.map((m) => ({ t: m.t, run: () => timer.motion(m) })),
    ...log.controls.map((c) => ({
      t: c.t,
      run: (): TimerEvent[] => {
        if (c.type === 'cancel') return timer.cancelCountdown();
        timer.startCountdown(c.t);
        return [];
      },
    })),
  ];
  // Stable sort keeps a fix before motion before a control at the same ms.
  items.sort((a, b) => a.t - b.t);
  const events = items.flatMap((i) => [...timer.tick(i.t), ...i.run()]);
  return { events, laps: timer.laps, phase: timer.phase };
}
