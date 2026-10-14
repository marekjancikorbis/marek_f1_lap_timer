import { useEffect, useState } from 'react';
import { Avatar, errorMessage, ScreenHead, useToast } from '../components/ui';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getMyRequest, requestCreatorAccess, updateMyProfile } from '../lib/data';
import { useMe, useSession } from '../lib/session';
import type { CreatorRequest } from '../lib/types';
import { readUsage, type UsageState } from '../lib/usage';
import { USAGE_CAP } from '../lib/config';
import { deleteLog, downloadLog, listLogs } from '../drive/gpslogs';

const HUES = [210, 265, 145, 30, 0, 330, 185, 55];

export default function Settings() {
  const { profile, role, user } = useMe();
  const { signOut } = useSession();
  const toast = useToast();
  const [request, setRequest] = useState<CreatorRequest | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [logs, setLogs] = useState(listLogs);

  useEffect(() => {
    getMyRequest(profile.id).then(setRequest).catch(() => setRequest(null));
    readUsage().then(setUsage).catch(() => undefined);
  }, [profile.id]);

  async function sendRequest() {
    setBusy(true);
    try {
      await requestCreatorAccess(profile.id, profile.username, note);
      setRequest({ id: profile.id, username: profile.username, note, status: 'pending', createdAt: null });
      toast('Request sent');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setHue(h: number) {
    try {
      await updateMyProfile(profile.id, { avatarHue: h });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function setCountdown(s: number) {
    try {
      await updateMyProfile(profile.id, { countdownS: s });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const countdown = profile.countdownS ?? DEFAULT_COUNTDOWN_S;

  return (
    <main className="screen">
      <ScreenHead back title="Settings" />

      <h2 className="section-title">Profile</h2>
      <div className="panel stack">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={profile.username} hue={profile.avatarHue} size={56} />
          <div className="grow">
            <strong style={{ fontSize: 18 }}>{profile.username}</strong>
            <p className="mute" style={{ fontSize: 14 }}>
              {user.email}
            </p>
          </div>
        </div>
        <div>
          <p style={{ fontWeight: 500, marginBottom: 8 }}>Avatar colour</p>
          <div className="row wrap" role="radiogroup" aria-label="Avatar colour">
            {HUES.map((h) => (
              <button
                key={h}
                role="radio"
                aria-checked={profile.avatarHue === h}
                aria-label={`Hue ${h}`}
                className="hue-dot"
                style={{ background: `oklch(42% 0.09 ${h})` }}
                onClick={() => setHue(h)}
              />
            ))}
          </div>
        </div>
      </div>

      <h2 className="section-title">Driving</h2>
      <div className="panel stack">
        <label className="field">
          <span>
            Standing-start countdown: <strong className="num" style={{ fontSize: 18 }}>{countdown} s</strong>
          </span>
          <input type="range" min={3} max={10} step={1} value={countdown} onChange={(e) => setCountdown(Number(e.target.value))} />
          <small>Lights go out exactly this long after you tap Start. The timer starts at GO.</small>
        </label>
      </div>

      <h2 className="section-title">GPS logs</h2>
      <div className="panel stack">
        <small className="mute">The raw GPS of your last 5 real drives, kept on this phone. Replay them from Drive → Simulate, or send them to the developer to test timing.</small>
        {logs.length === 0 && <p className="mute">No drives recorded yet.</p>}
        {logs.map((l) => (
          <div key={l.recordedAt} className="row" style={{ gap: 8 }}>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong className="ellipsis" style={{ display: 'block' }}>{l.route.name}</strong>
              <span className="mute" style={{ fontSize: 13 }}>
                {new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {l.fixes.length} fixes
              </span>
            </span>
            <button className="btn" onClick={() => downloadLog(l)}>
              Download
            </button>
            <button
              className="btn danger"
              onClick={() => {
                deleteLog(l.recordedAt);
                setLogs(listLogs());
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <h2 className="section-title">Route creation</h2>
      <div className="panel stack">
        {role !== 'driver' ? (
          <p>
            You're a <strong>{role}</strong>. You can build routes and publish one of them.
          </p>
        ) : request === undefined ? null : request?.status === 'pending' ? (
          <p>
            <span className="badge yellow">Request pending</span>
            <span className="mute" style={{ display: 'block', marginTop: 8 }}>
              The admin will review your request.
            </span>
          </p>
        ) : (
          <>
            {request?.status === 'rejected' && <p className="notice warn">Your last request was declined. You can ask again.</p>}
            <p className="mute">Only approved creators can build routes. Everyone can drive public routes.</p>
            <label className="field">
              <span>Note for the admin (optional)</span>
              <textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Which track or event do you want to time?" />
            </label>
            <button className="btn primary" disabled={busy} onClick={sendRequest}>
              Request creator access
            </button>
          </>
        )}
      </div>

      {usage && (
        <>
          <h2 className="section-title">Map usage this month</h2>
          <div className="panel stack">
            <UsageBar label="Map loads" value={usage.mapLoads} cap={USAGE_CAP.mapLoads} />
            <UsageBar label="Road snapping" value={usage.directions} cap={USAGE_CAP.directions} />
            <UsageBar label="Route card maps" value={usage.staticMaps} cap={USAGE_CAP.staticMaps} />
            <small className="mute">
              Resets {usage.resetsAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. The app pauses at the limit to stay free.
            </small>
          </div>
        </>
      )}

      <button className="btn danger block" style={{ marginTop: 32 }} onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}

function UsageBar({ label, value, cap }: { label: string; value: number; cap: number }) {
  const pct = Math.min(100, (value / cap) * 100);
  return (
    <div>
      <div className="row between" style={{ fontSize: 14, marginBottom: 6 }}>
        <span>{label}</span>
        <span className="num mute">
          {value.toLocaleString()} / {cap.toLocaleString()}
        </span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={value} aria-label={label}>
        <span style={{ width: `${pct}%`, background: pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--green)' }} />
      </div>
    </div>
  );
}
