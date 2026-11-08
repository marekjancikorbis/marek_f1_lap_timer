import { useCallback, useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { RouteMap } from '../components/RouteMap';
import type { Route } from '../lib/types';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { DriveController, type DriveState } from '../drive/controller';
import { clearPendingDrive, takePendingDrive } from '../drive/store';
import { I, STRIP_LABEL } from '../components/ui';
import { formatDelta, formatDistance, formatLap, formatSeconds } from '../lib/format';

export default function Drive() {
  const { routeId = '' } = useParams();
  const nav = useNavigate();
  const [cfg] = useState(() => takePendingDrive(routeId));
  const [ctl, setCtl] = useState<DriveController | null>(null);
  const [s, setS] = useState<DriveState | null>(null);
  // Turning the phone sideways switches to delta only, upright back to the full HUD.
  const [mode, setMode] = useState(() => cfg?.mode ?? 'hud');
  // Like TikTok: the app stays locked upright and gravity alone decides, turning the screen in CSS,
  // so it works with the phone's rotation lock on and while the OS ignores a shaking car.
  const turn = useSideways();
  const sideways = turn !== null;
  // Where the portrait lock can't hold (iOS), the OS may rotate too: then don't turn it twice.
  const landscape = useLandscape();
  const firstOrientation = useRef(true);
  useEffect(() => {
    if (firstOrientation.current) {
      firstOrientation.current = false;
      if (!sideways) return;
    }
    setMode(sideways ? 'delta' : 'hud');
  }, [sideways]);

  useEffect(() => {
    if (!cfg) return;
    const c = new DriveController(cfg);
    setCtl(c);
    const unsub = c.subscribe(setS);
    void c.start();
    return () => {
      unsub();
      c.dispose();
    };
  }, [cfg]);

  // Point-to-point: go to the summary once the finished lap is saved.
  useEffect(() => {
    if (s?.finished && s.savedRunIds.length && !cfg?.route.isLoop) {
      clearPendingDrive();
      nav(`/run/${s.savedRunIds[s.savedRunIds.length - 1]}`, { replace: true });
    }
  }, [s?.finished, s?.savedRunIds, cfg, nav]);

  if (!cfg) return <Navigate to={`/drive/${routeId}`} replace />;
  if (!s || !ctl) return <div className="dv" />;

  async function stop() {
    const ids = await ctl!.stop();
    // The signal cut this lap short: ask whether to keep it first.
    if (!ctl!.state.partial) leave(ids);
  }

  function leave(ids: string[]) {
    clearPendingDrive();
    if (ids.length) nav(`/run/${ids[ids.length - 1]}`, { replace: true });
    else nav(`/r/${routeId}`, { replace: true });
  }

  async function savePartial() {
    const id = await ctl!.savePartial();
    leave(id ? [id] : ctl!.state.savedRunIds);
  }

  const standing = cfg.route.startType === 'standing';
  const running = s.phase === 'running';
  const jumpBanner = s.jumpBannerUntil > Date.now();
  const flag = s.lastSector ? `flag-${s.lastSector.colour}` : '';
  const delta = running && mode === 'delta';

  const gps = <GpsChip ok={s.gpsOk} accuracy={s.accuracy} clear={delta} />;
  return (
    <div className={`dv ${turn && !landscape ? `turn-${turn}` : ''} ${delta ? `delta ${flag}` : ''}`}>
      {/* Loaded from the start (one map load per drive), shown under the HUD once the lap is running. */}
      <DriveMap route={cfg.route} pos={s.pos} speed={s.speed} show={running && mode === 'hud'} />
      <header className="dv-top">
        {delta ? (
          <>
            <span className="glass chip clear ellipsis" style={{ maxWidth: '50%' }}>{cfg.route.name}</span>
            {gps}
          </>
        ) : (
          <>
            <span style={{ display: 'flex', gap: 6 }}>
              {gps}
              {cfg.replay && <span className="glass chip" style={{ height: 40, borderRadius: 20, color: 'var(--s-y)' }}>Simulated</span>}
            </span>
            {running ? (
              <span className="t" style={{ fontSize: 24 }}>
                {s.speed != null ? Math.round(s.speed * 3.6) : '–'}
                <span className="lbl"> km/h</span>
              </span>
            ) : (
              <span className="lbl">
                {s.phase === 'ready' || s.phase === 'countdown'
                  ? `Armed · ${standing ? 'standing' : 'rolling'} start`
                  : cfg.reference
                    ? `vs ${cfg.reference.label}`
                    : 'Clock only'}
              </span>
            )}
          </>
        )}
      </header>

      {s.gpsError && !s.gpsOk && <p className="dv-note err">{s.gpsError}</p>}

      {/* ---------------- before the start ---------------- */}
      {(s.phase === 'waiting' || s.phase === 'armed') && !s.invalidReason && (
        <section className="dv-center">
          {standing ? (
            <>
              <div className="lbl" style={{ fontSize: 15 }}>Stop at the start line</div>
              <ToStart rel={s.startRel} zoneM={ctl.timer.cfg.th.STANDING_ZONE_M} />
              <p className="lbl dv-sub">The countdown button appears once you&rsquo;ve been still at the line for 2 seconds.</p>
            </>
          ) : s.phase === 'armed' ? (
            <>
              <div className="t acc" style={{ fontSize: 96 }}>Armed</div>
              <p className="lbl dv-sub">The timer starts as you cross the line.</p>
            </>
          ) : (
            <>
              <div className="lbl" style={{ fontSize: 15 }}>Drive to the start</div>
              <ToStart rel={s.startRel} zoneM={ctl.timer.cfg.th.STANDING_ZONE_M} />
              <p className="lbl dv-sub">Approach the start line in the route&rsquo;s direction. Timing arms within 50 m.</p>
            </>
          )}
        </section>
      )}

      {s.phase === 'ready' && (
        <section className="dv-center">
          <p className="lbl" style={{ fontSize: 15 }}>At the line and stationary</p>
          <button className="solid" style={{ width: 200, height: 200, borderRadius: '50%', fontSize: 22, display: 'grid', alignContent: 'center', gap: 6 }} onClick={() => ctl.startCountdown()}>
            Start countdown
            <span style={{ fontSize: 13, opacity: 0.7 }}>{cfg.countdownS} s · lights out = GO</span>
          </button>
        </section>
      )}

      {s.phase === 'countdown' && s.goT && <Countdown goT={s.goT} n={cfg.countdownS} onCancel={() => ctl.cancelCountdown()} />}

      {/* ---------------- running ---------------- */}
      {running && mode === 'hud' && <Hud s={s} ctl={ctl} reference={cfg.reference?.label ?? null} />}
      {delta && <DeltaOnly s={s} reference={cfg.reference?.label ?? null} />}

      {jumpBanner && (
        <div className="glass sheet dv-banner" role="alert">
          <I n="flag" />
          <span>
            <b>Jump start · +{formatSeconds(s.penaltyMs, 0)}</b>
            <span className="lbl" style={{ display: 'block' }}>
              Moved {s.jumpDistanceM != null ? `${Math.round(s.jumpDistanceM)} m ` : ''}before GO. Timed from GO.
            </span>
          </span>
        </div>
      )}

      {s.partial && (
        <section className="dv-center">
          <div className="lbl" style={{ fontSize: 15 }}>GPS lost before the finish</div>
          <div className="t" style={{ fontSize: 72 }}>{s.partial.lastSplitMs != null ? formatLap(s.partial.lastSplitMs) : formatDistance(s.partial.distanceM)}</div>
          <div className="lbl">
            {s.bigThisLap.length} of {ctl.bigEnds.length} sectors timed
          </div>
          <SectorPills s={s} ctl={ctl} />
          <p className="lbl dv-sub">
            The signal dropped out {formatDistance(Math.max(0, cfg.route.lengthM - s.partial.distanceM))} from the finish. Keep the{' '}
            {formatDistance(s.partial.distanceM)} you drove to view and compare it. A partial {cfg.route.isLoop ? 'lap' : 'run'} can&rsquo;t be posted or set a best.
          </p>
          {s.laps.length > 0 && <p className="lbl">Your {s.laps.length} completed {s.laps.length === 1 ? 'lap is' : 'laps are'} saved.</p>}
        </section>
      )}

      {s.invalidReason && !s.partial && (
        <section className="dv-center">
          <div className="t" style={{ fontSize: 64, color: '#ff9a9d' }}>Run stopped</div>
          <p className="lbl dv-sub">{s.invalidReason}</p>
          {s.laps.length > 0 && <p className="lbl">Your {s.laps.length} completed {s.laps.length === 1 ? 'lap is' : 'laps are'} saved.</p>}
        </section>
      )}

      {s.phase === 'finished' && !s.invalidReason && !s.partial && s.laps.length > 0 && (
        <section className="dv-center">
          <div className="t acc" style={{ fontSize: 80 }}>Finished</div>
          <p className="lbl" style={{ fontSize: 15 }}>
            {s.laps.length} {s.laps.length === 1 ? 'lap' : 'laps'} · best {formatLap(Math.min(...s.laps.map((l) => l.totalMs)))}
          </p>
        </section>
      )}

      {cfg.route.isLoop && s.laps.length > 0 && running && !delta && (
        <div className="lbl" style={{ textAlign: 'center', marginTop: 14 }}>
          Lap {s.lap + 1} · last {formatLap(s.laps[s.laps.length - 1].totalMs)}
        </div>
      )}

      <footer className="dv-bottom">
        {s.partial ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <b style={{ textAlign: 'center' }}>{cfg.route.isLoop ? 'Keep this lap?' : 'Keep this run?'}</b>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="solid quiet" onClick={() => leave(ctl.state.savedRunIds)}>
                Discard
              </button>
              <button className="solid" onClick={savePartial}>
                Keep
              </button>
            </div>
          </div>
        ) : s.invalidReason || s.phase === 'finished' ? (
          <button className="solid" onClick={stop}>
            {s.laps.length ? 'See results' : 'Back to route'}
          </button>
        ) : delta ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, opacity: 0.8 }}>
              <I n="phone" size={18} />
              Turn upright for full HUD
            </span>
            <HoldToStop onStop={stop} label="Hold to exit" compact />
          </div>
        ) : running || s.phase === 'countdown' ? (
          <>
            {running && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <span className="glass chip lift" style={{ height: 36, fontSize: 14, color: 'var(--ink)', background: 'color-mix(in srgb, var(--night) 82%, transparent)' }}>
                  <I n="phone" size={18} style={{ transform: 'rotate(90deg)' }} />
                  Turn sideways for delta only
                </span>
              </div>
            )}
            <HoldToStop onStop={stop} label={cfg.route.isLoop && s.laps.length ? 'Hold to finish session' : 'Hold to stop'} />
          </>
        ) : (
          <HoldToStop onStop={stop} label="Hold to exit" />
        )}
      </footer>
    </div>
  );
}

/** Straight-line distance to the start line and which way it is, so the driver can find it before timing. */
function ToStart({ rel, zoneM }: { rel: { a: number; c: number } | null; zoneM: number }) {
  if (!rel) return null;
  const atLine = Math.abs(rel.a) <= zoneM && rel.c <= zoneM;
  const hint = atLine
    ? 'at the start line'
    : rel.a > 0
      ? 'past the start line, turn back'
      : rel.c > -rel.a
        ? 'to the start line, off to the side'
        : 'to the start line';
  const [num, unit] = formatDistance(Math.hypot(rel.a, rel.c)).split(' ');
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
      {atLine ? (
        <div className="t" style={{ fontSize: 72, color: 'var(--s-g)' }}>At the line</div>
      ) : (
        <div className="t" style={{ fontSize: 120 }}>
          {num}
          <span className="lbl" style={{ fontSize: 22 }}> {unit}</span>
        </div>
      )}
      {!atLine && hint !== 'to the start line' && <span className="lbl" style={{ fontSize: 15, color: 'var(--s-y)' }}>{hint}</span>}
    </div>
  );
}

function GpsChip({ ok, accuracy, clear }: { ok: boolean; accuracy: number | null; clear?: boolean }) {
  const good = ok && accuracy != null && accuracy <= 10;
  const fair = ok && accuracy != null && accuracy <= 20;
  return (
    <span
      className={`glass chip${clear ? ' clear' : ''}`}
      style={clear ? undefined : { height: 40, borderRadius: 20 }}
      aria-label={ok ? `GPS accuracy ${Math.round(accuracy ?? 0)} metres` : 'No GPS'}
    >
      <span className="dot" style={{ background: clear ? 'currentColor' : good ? 'var(--s-g)' : fair ? 'var(--s-y)' : '#ff5a5f' }} />
      {ok && accuracy != null ? `±${Math.round(accuracy)} m` : 'No GPS'}
    </span>
  );
}

/** Elapsed time, updated every frame straight into the DOM. */
function useElapsed(s: DriveState, ctl: DriveController) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const e = ctl.timer.elapsedAt(Date.now());
      const text = formatLap(e ?? 0).replace(/(\.\d)\d\d$/, '$1');
      // Tenths change 10×/s; skipping identical writes saves layout work (and battery) at 60 fps.
      if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [ctl, s.lapStartT]);
  return ref;
}

/**
 * The map under the HUD, as in the mockup: it fades in below the delta, follows the car (kept at its centre)
 * and turns with the direction of travel once moving. Each fix eases the map over about the time to the
 * next fix, so it glides instead of jumping; with reduced motion Mapbox jumps instead.
 */
function DriveMap({ route, pos, speed, show }: { route: Route; pos: DriveState['pos']; speed: number | null; show: boolean }) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const last = useRef(0);
  const keep = useCallback((m: mapboxgl.Map) => {
    mapRef.current = m;
    m.jumpTo({ zoom: 16 });
    return () => {
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !pos) return;
    const now = performance.now();
    const gap = Math.min(1000, Math.max(100, now - last.current));
    last.current = now;
    // Below walking pace the GPS course is noise: keep the map's last direction.
    const turning = (speed ?? 0) > 3 && pos.heading != null;
    m.easeTo({ center: [pos.lon, pos.lat], zoom: 16, bearing: turning ? pos.heading! : m.getBearing(), duration: gap, easing: (t) => t });
  }, [pos, speed]);
  return (
    <div className={`dv-map${show ? ' on' : ''}`} aria-hidden="true">
      <RouteMap route={route} height="100%" extra={keep} />
      <span className="dv-car" />
    </div>
  );
}

/** One pill per big sector: tinted by its flag once timed, the current one labelled. */
function SectorPills({ s, ctl }: { s: DriveState; ctl: DriveController }) {
  const ends = ctl.bigEnds;
  const current = ends.findIndex((e) => e >= s.nextSector);
  return (
    <div className="dv-pills" style={{ gridTemplateColumns: `repeat(${ends.length}, 1fr)` }}>
      {ends.map((_, b) => {
        const big = s.bigThisLap.find((x) => x.k === b);
        return (
          <div key={b} className={`glass ${big ? `tint-${big.colour[0]}` : ''}`} style={{ height: 84, borderRadius: 42, display: 'grid', placeItems: 'center' }}>
            {big ? (
              <span className="t" style={{ fontSize: ends.length > 4 ? 18 : 24 }}>
                {big.deltaMs != null ? formatDelta(big.deltaMs) : formatLap(big.sectorMs)}
                <span className="visually-hidden"> sector {b + 1}, {STRIP_LABEL[big.colour]}</span>
              </span>
            ) : (
              <span className="lbl" style={{ fontSize: 16, color: b === current ? 'var(--ink)' : undefined }}>S{b + 1}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const FLAG_INK: Record<string, string> = { purple: 'var(--s-p)', green: 'var(--s-g)', yellow: 'var(--s-y)' };

function Hud({ s, ctl, reference }: { s: DriveState; ctl: DriveController; reference: string | null }) {
  const elapsed = useElapsed(s, ctl);
  const last = s.lastSector;
  return (
    <section style={{ display: 'grid' }} aria-live="polite">
      <div style={{ textAlign: 'center', paddingTop: 22 }}>
        <div className="t" style={{ fontSize: 40, color: 'var(--ink-2)' }}>
          <span ref={elapsed}>0.0</span>
        </div>
        <div className="t dv-delta" style={{ fontSize: "min(144px, 36vw)", marginTop: 6, color: last ? FLAG_INK[last.colour] : 'var(--ink)' }}>
          {last?.deltaMs != null ? formatDelta(last.deltaMs) : reference ? '±0.00' : '—'}
        </div>
        <div className="lbl">{reference ? `vs ${reference}` : 'Clock only'}</div>
      </div>
      <div style={{ padding: '22px 4px 0' }}>
        <SectorPills s={s} ctl={ctl} />
      </div>
    </section>
  );
}

function DeltaOnly({ s, reference }: { s: DriveState; reference: string | null }) {
  const last = s.lastSector;
  return (
    <section style={{ textAlign: 'center', marginTop: 6, flex: 1, display: 'grid', alignContent: 'center' }} aria-live="polite">
      <div className="t dv-delta-big">{last?.deltaMs != null ? formatDelta(last.deltaMs) : last ? formatLap(last.sectorMs) : 'GO'}</div>
      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6, opacity: 0.8 }}>
        {last ? (reference ? `vs ${reference}` : 'Clock only') : 'The gap shows at the first minisector'}
      </div>
    </section>
  );
}

/** True while the screen is wider than tall. */
function useLandscape() {
  const [on, setOn] = useState(() => window.matchMedia('(orientation: landscape)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setOn(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return on;
}

// shortcut: iOS reports motion with the opposite sign to the spec (and Android); sniffed, not measured.
const MOTION_SIGN = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? -1 : 1;

/** Which way to turn the content so it reads upright on a sideways phone, from gravity; null while upright. */
function useSideways() {
  const [turn, setTurn] = useState<'cw' | 'ccw' | null>(null);
  useEffect(() => {
    let x = 0;
    let y = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null) return;
      // Low-pass (about half a second) so bumps and kerbs don't flip the view.
      x += (a.x - x) * 0.03;
      y += (a.y - y) * 0.03;
      if (Math.hypot(x, y) < 5) return; // lying flat: keep the current view
      // 3:1 (about 70°) with a dead band between: a cornering car adds at most ~1 g sideways, which can't cross it.
      if (Math.abs(x) > 3 * Math.abs(y)) setTurn(x * MOTION_SIGN > 0 ? 'cw' : 'ccw');
      else if (Math.abs(y) > 3 * Math.abs(x)) setTurn(null);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);
  return turn;
}

function Countdown({ goT, n, onCancel }: { goT: number; n: number; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let id = 0;
    const loop = () => {
      setNow(Date.now());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  const remaining = Math.max(0, goT - now);
  const lit = Math.min(n, Math.floor((n * 1000 - remaining) / 1000) + 1);
  const seconds = Math.ceil(remaining / 1000);
  return (
    <section className="dv-center" aria-live="assertive">
      <div className="dv-lights">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < lit ? 'on' : ''} />
        ))}
      </div>
      <div className="t" style={{ fontSize: 160 }}>{seconds}</div>
      <p className="lbl dv-sub">Timing starts when you move off after GO. Moving more than 10 m early adds 5 s.</p>
      <button className="solid quiet" style={{ width: 'auto', padding: '0 24px' }} onClick={onCancel}>
        Cancel countdown
      </button>
    </section>
  );
}

/** Hold to stop: the fill grows under the finger and the drive ends when it is full, so a bump can't end it. */
function HoldToStop({ onStop, label, compact }: { onStop: () => void; label: string; compact?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const begin = () => {
    setHolding(true);
    navigator.vibrate?.(8);
    timer.current = window.setTimeout(() => {
      navigator.vibrate?.(30);
      onStop();
    }, 800);
  };
  const end = () => {
    setHolding(false);
    if (timer.current) window.clearTimeout(timer.current);
  };
  return (
    <button
      className={`dv-hold ${compact ? 'glass clear compact' : 'glass sheet'} ${holding ? 'holding' : ''}`}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onStop()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="dv-fill" aria-hidden="true" />
      <span style={{ position: 'relative' }}>{label}</span>
    </button>
  );
}
