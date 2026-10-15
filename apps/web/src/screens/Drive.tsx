import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { DriveController, type DriveState } from '../drive/controller';
import { clearPendingDrive, takePendingDrive } from '../drive/store';
import { formatDelta, formatDistance, formatLap, formatSpeed } from '../lib/format';

export default function Drive() {
  const { routeId = '' } = useParams();
  const nav = useNavigate();
  const [cfg] = useState(() => takePendingDrive(routeId));
  const [ctl, setCtl] = useState<DriveController | null>(null);
  const [s, setS] = useState<DriveState | null>(null);

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
  if (!s || !ctl) return <div className="drive" />;

  async function stop() {
    const ids = await ctl!.stop();
    clearPendingDrive();
    if (ids.length) nav(`/run/${ids[ids.length - 1]}`, { replace: true });
    else nav(`/r/${routeId}`, { replace: true });
  }

  const standing = cfg.route.startType === 'standing';
  const running = s.phase === 'running';
  const jumpBanner = s.jumpBannerUntil > Date.now();
  const colourClass = s.lastSector ? `flag-${s.lastSector.colour}` : '';

  return (
    <div className={`drive ${cfg.mode === 'delta' && running ? `delta-mode ${colourClass}` : ''}`}>
      <header className="drive-top">
        <span className="drive-route ellipsis">{cfg.route.name}</span>
        <span className="row" style={{ gap: 10 }}>
          {cfg.replay && <span className="badge yellow">Simulated</span>}
          <GpsDot ok={s.gpsOk} accuracy={s.accuracy} />
        </span>
      </header>

      {s.gpsError && !s.gpsOk && <p className="drive-gps-error">{s.gpsError}</p>}

      {/* ---------------- before the start ---------------- */}
      {(s.phase === 'waiting' || s.phase === 'armed') && !s.invalidReason && (
        <section className="drive-center">
          {standing ? (
            <>
              <h1 className="drive-big-label">Stop at the start line</h1>
              <ToStart rel={s.startRel} zoneM={ctl.timer.cfg.th.STANDING_ZONE_M} />
              <p className="drive-sub">The countdown button appears once you've been still at the line for 2 seconds.</p>
            </>
          ) : s.phase === 'armed' ? (
            <>
              <h1 className="drive-big-label armed">Armed</h1>
              <p className="drive-sub">The timer starts as you cross the line.</p>
            </>
          ) : (
            <>
              <h1 className="drive-big-label">Drive to the start</h1>
              <ToStart rel={s.startRel} zoneM={ctl.timer.cfg.th.STANDING_ZONE_M} />
              <p className="drive-sub">Approach the start line in the route's direction. Timing arms within 50 m.</p>
            </>
          )}
          <Speed speed={s.speed} />
        </section>
      )}

      {s.phase === 'ready' && (
        <section className="drive-center">
          <p className="drive-sub">At the line and stationary.</p>
          <button className="countdown-btn" onClick={() => ctl.startCountdown()}>
            Start countdown
            <small>{cfg.countdownS} s · lights out = GO</small>
          </button>
        </section>
      )}

      {s.phase === 'countdown' && s.goT && <Countdown goT={s.goT} n={cfg.countdownS} onCancel={() => ctl.cancelCountdown()} />}

      {/* ---------------- running ---------------- */}
      {running && cfg.mode === 'hud' && <Hud s={s} ctl={ctl} reference={cfg.reference?.label ?? null} />}
      {running && cfg.mode === 'delta' && <DeltaOnly s={s} />}

      {jumpBanner && (
        <div className="jump-banner" role="alert">
          JUMP START +{(s.penaltyMs / 1000).toFixed(1)} s
        </div>
      )}

      {s.invalidReason && (
        <section className="drive-center">
          <h1 className="drive-big-label" style={{ color: 'var(--red-ink)' }}>
            Run stopped
          </h1>
          <p className="drive-sub">{s.invalidReason}</p>
          {s.laps.length > 0 && <p className="drive-sub">Your {s.laps.length} completed {s.laps.length === 1 ? 'lap is' : 'laps are'} saved.</p>}
        </section>
      )}

      {s.phase === 'finished' && !s.invalidReason && s.laps.length > 0 && (
        <section className="drive-center">
          <h1 className="drive-big-label armed">Finished</h1>
          <p className="drive-sub num">
            {s.laps.length} {s.laps.length === 1 ? 'lap' : 'laps'} · best {formatLap(Math.min(...s.laps.map((l) => l.totalMs)))}
          </p>
        </section>
      )}

      {cfg.route.isLoop && s.laps.length > 0 && running && (
        <div className="drive-laps num">
          Lap {s.lap + 1} · last {formatLap(s.laps[s.laps.length - 1].totalMs)}
        </div>
      )}

      <footer className="drive-bottom">
        {s.invalidReason || s.phase === 'finished' ? (
          <button className="btn primary lg block" onClick={stop}>
            {s.laps.length ? 'See results' : 'Back to route'}
          </button>
        ) : running || s.phase === 'countdown' ? (
          <HoldToStop onStop={stop} label={cfg.route.isLoop && s.laps.length ? 'Hold to finish session' : 'Hold to stop'} />
        ) : (
          <button className="btn lg block drive-exit" onClick={stop}>
            <X size={20} aria-hidden="true" /> Exit
          </button>
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
  return (
    <div className={`drive-to-start ${atLine ? 'at-line' : ''}`}>
      <strong className="num">{atLine ? 'At the line' : formatDistance(Math.hypot(rel.a, rel.c))}</strong>
      {!atLine && <span>{hint}</span>}
    </div>
  );
}

function GpsDot({ ok, accuracy }: { ok: boolean; accuracy: number | null }) {
  const good = ok && accuracy != null && accuracy <= 10;
  const fair = ok && accuracy != null && accuracy <= 20;
  return (
    <span className="gps" aria-label={ok ? `GPS accuracy ${Math.round(accuracy ?? 0)} metres` : 'No GPS'}>
      <span className={`gps-dot ${good ? 'good' : fair ? 'fair' : 'bad'}`} />
      {ok && accuracy != null ? `±${Math.round(accuracy)} m` : 'GPS'}
    </span>
  );
}

function Speed({ speed }: { speed: number | null }) {
  return (
    <div className="drive-speed">
      <span className="num">{formatSpeed(speed)}</span>
      <span>km/h</span>
    </div>
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

function Hud({ s, ctl, reference }: { s: DriveState; ctl: DriveController; reference: string | null }) {
  const elapsed = useElapsed(s, ctl);
  const last = s.lastSector;
  const count = ctl.timer.cfg.boundaries.length;
  return (
    <section className="hud">
      <div className="hud-time num">
        <span ref={elapsed}>0.0</span>
      </div>
      <div className={`hud-delta num ${last?.deltaMs == null ? '' : last.deltaMs <= 0 ? 'ahead' : 'behind'}`}>
        {last?.deltaMs != null ? formatDelta(last.deltaMs) : reference ? '±0.00' : '—'}
        <small>{reference ? `vs ${reference}` : 'no reference'}</small>
      </div>
      <div className="hud-grid">
        <div className={`hud-cell ${last ? `flag-${last.colour}` : ''}`}>
          <span>Last sector</span>
          <strong className="num">{last ? formatLap(last.sectorMs) : '—'}</strong>
          {last && <em className="num">{last.deltaMs != null ? formatDelta(last.deltaMs) : last.colour}</em>}
        </div>
        <div className="hud-cell">
          <span>Sector</span>
          <strong className="num">
            {Math.min(s.nextSector + 1, count)}/{count}
          </strong>
          <em className="num">{s.distanceToGateM != null ? `${formatDistance(s.distanceToGateM)} to gate` : ''}</em>
        </div>
        <div className="hud-cell">
          <span>Speed</span>
          <strong className="num">{formatSpeed(s.speed)}</strong>
          <em>km/h</em>
        </div>
      </div>
      <div className="hud-strip" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => {
          const sec = s.sectorsThisLap.find((x) => x.k === i);
          return <span key={i} className={sec ? `flag-${sec.colour}` : i === s.nextSector ? 'current' : ''} />;
        })}
      </div>
    </section>
  );
}

function DeltaOnly({ s }: { s: DriveState }) {
  const last = s.lastSector;
  return (
    <section className="delta-only" aria-live="polite">
      <div className="delta-value num">{last?.deltaMs != null ? formatDelta(last.deltaMs) : last ? formatLap(last.sectorMs) : 'GO'}</div>
      <div className="delta-caption num">
        {last ? `Sector ${last.k + 1} of ${last.count} · ${last.colour}` : 'Delta shows at the first sector end'}
      </div>
    </section>
  );
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
    <section className="countdown" aria-live="assertive">
      <div className={`lights n${Math.min(n, 10)}`}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < lit ? 'on' : ''} />
        ))}
      </div>
      <div className="countdown-num num">{seconds}</div>
      <button className="btn ghost" onClick={onCancel}>
        Cancel countdown
      </button>
    </section>
  );
}

function HoldToStop({ onStop, label }: { onStop: () => void; label: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const begin = () => {
    setHolding(true);
    timer.current = window.setTimeout(onStop, 800);
  };
  const end = () => {
    setHolding(false);
    if (timer.current) window.clearTimeout(timer.current);
  };
  return (
    <button
      className={`hold-stop ${holding ? 'holding' : ''}`}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onStop()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{label}</span>
    </button>
  );
}
