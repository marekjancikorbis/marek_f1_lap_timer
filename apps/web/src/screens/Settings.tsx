import { useEffect, useRef, useState } from 'react';
import { Avatar, errorMessage, ScreenHead, useToast } from '../components/ui';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getMyRequest, getPhoto, NAME_MAX, requestCreatorAccess, setDisplayName, setPhoto, squarePhoto, updateMyProfile } from '../lib/data';
import { nameOf } from '../lib/format';
import { useMe, useSession } from '../lib/session';
import type { CreatorRequest } from '../lib/types';
import { readUsage, type UsageState } from '../lib/usage';
import { USAGE_CAP } from '../lib/config';
import { deleteLog, downloadLog, listLogs } from '../drive/gpslogs';

const HUES = [210, 265, 145, 30, 0, 330, 185, 55];

export default function Settings() {
  const { profile, role, user } = useMe();
  const [adminRequest, setAdminRequest] = useState<CreatorRequest | null | undefined>(undefined);
  const { signOut } = useSession();
  const toast = useToast();
  const [request, setRequest] = useState<CreatorRequest | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [logs, setLogs] = useState(listLogs);
  const [name, setName] = useState(nameOf(profile));
  const [savingName, setSavingName] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  /** Bumped after a photo change so the avatar loads it again. */
  const [photoKey, setPhotoKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPhoto(profile.id).then((p) => setHasPhoto(!!p), () => undefined);
  }, [profile.id, photoKey]);

  async function saveName() {
    setSavingName(true);
    try {
      await setDisplayName(profile.id, name);
      toast('Name saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSavingName(false);
    }
  }

  async function changePhoto(file: File | null, remove = false) {
    try {
      await setPhoto(profile.id, remove || !file ? null : await squarePhoto(file));
      setPhotoKey((k) => k + 1);
      toast(remove ? 'Photo removed' : 'Photo saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  useEffect(() => {
    getMyRequest(profile.id).then(setRequest).catch(() => setRequest(null));
    if (role === 'creator') getMyRequest(profile.id, 'admin').then(setAdminRequest).catch(() => setAdminRequest(null));
    readUsage().then(setUsage).catch(() => undefined);
  }, [profile.id, role]);

  async function sendRequest() {
    setBusy(true);
    try {
      const kind = role === 'creator' ? 'admin' : 'creator';
      await requestCreatorAccess(profile.id, profile.username, note, kind);
      const sent = { id: profile.id, username: profile.username, note, status: 'pending' as const, createdAt: null };
      if (kind === 'admin') setAdminRequest(sent);
      else setRequest(sent);
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
          <Avatar key={photoKey} name={profile.username} hue={profile.avatarHue} size={56} uid={profile.id} />
          <div className="grow">
            <strong style={{ fontSize: 18 }}>{nameOf(profile)}</strong>
            <p className="mute" style={{ fontSize: 14 }}>
              @{profile.username} · {user.email}
            </p>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            {hasPhoto ? 'Change photo' : 'Add photo'}
          </button>
          {hasPhoto && (
            <button className="btn ghost sm" onClick={() => void changePhoto(null, true)}>
              Remove photo
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (f) void changePhoto(f);
            }}
          />
        </div>
        <label className="field">
          <span>Display name</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={profile.username} />
            <button className="btn sm" disabled={savingName || !name.trim() || name.trim() === nameOf(profile)} onClick={saveName}>
              {savingName ? 'Saving…' : 'Save'}
            </button>
          </div>
          <small>Shown on your profile, laps and leaderboards. Your @{profile.username} stays the same.</small>
        </label>
        <div>
          <p style={{ fontWeight: 500, marginBottom: 8 }}>Avatar colour (without a photo)</p>
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
        {role === 'owner' ? (
          <p>
            You're the <strong>owner</strong>. Unlimited public routes, shown as Official. Only you decide admin requests.
          </p>
        ) : role === 'admin' ? (
          <p>
            You're an <strong>admin</strong>. Up to 5 public routes, shown as Official, and you handle creator requests.
          </p>
        ) : role === 'creator' ? (
          adminRequest === undefined ? null : adminRequest?.status === 'pending' ? (
            <p>
              You're a <strong>creator</strong> with one public route. <span className="badge yellow">Admin request pending</span>
            </p>
          ) : (
            <>
              <p>
                You're a <strong>creator</strong>. You can build routes and publish one of them.
              </p>
              {adminRequest?.status === 'rejected' && <p className="notice warn">Your last admin request was declined. You can ask again.</p>}
              <p className="mute">Admins publish up to 5 routes as Official and approve new creators. The owner decides.</p>
              <label className="field">
                <span>Note for the owner (optional)</span>
                <textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Which events do you organise?" />
              </label>
              <button className="btn" disabled={busy} onClick={sendRequest}>
                Request admin access
              </button>
            </>
          )
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
