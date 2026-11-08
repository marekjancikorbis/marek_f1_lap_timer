import { Camera, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AndroidAppButton, InstallButton } from '../components/InstallButton';
import { Avatar, errorMessage, ScreenHead, useToast } from '../components/ui';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getMyRequest, getPhoto, NAME_MAX, requestCreatorAccess, setDisplayName, setPhoto, squarePhoto, updateMyProfile } from '../lib/data';
import { nameOf } from '../lib/format';
import { useMe, useSession } from '../lib/session';
import type { CreatorRequest } from '../lib/types';
import { readUsage, type UsageState } from '../lib/usage';
import { USAGE_CAP } from '../lib/config';
import { useTheme } from '../lib/theme';
import { THEMES } from '../lib/themes';
import { deleteLog, downloadLog, listLogs } from '../drive/gpslogs';

const HUES = [30, 185, 265, 330, 145, 210];

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
  const [editName, setEditName] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
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
    setPhotoBusy(true);
    try {
      await setPhoto(profile.id, remove || !file ? null : await squarePhoto(file));
      setPhotoKey((k) => k + 1);
      toast(remove ? 'Photo removed' : 'Photo saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPhotoBusy(false);
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

  const [theme, setTheme] = useTheme();

  return (
    <main className="screen">
      <ScreenHead back title="Settings" />

      <h2 className="section-title">Profile</h2>
      <div className="list">
        <button className="list-item" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
          <Avatar key={photoKey} name={profile.username} hue={profile.avatarHue} size={56} uid={profile.id} />
          <span className="grow">
            <strong>{photoBusy ? 'Checking photo…' : hasPhoto ? 'Change photo' : 'Add photo'}</strong>
            <span className="mute small-text">{hasPhoto ? `@${profile.username} · ${user.email}` : 'Or keep your roundel'}</span>
          </span>
          <Camera size={22} aria-hidden="true" />
        </button>
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
        {hasPhoto && (
          <button className="list-item" onClick={() => void changePhoto(null, true)}>
            <span className="grow">
              <strong>Remove photo</strong>
              <span className="mute small-text">Show your roundel instead</span>
            </span>
          </button>
        )}
        {editName ? (
          <div className="list-item settings-col">
            <span className="mute small-text">Display name</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={profile.username} aria-label="Display name" />
              <button
                className="btn primary sm"
                disabled={savingName || !name.trim() || name.trim() === nameOf(profile)}
                onClick={() => void saveName().then(() => setEditName(false))}
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
            <span className="mute small-text">Shown on your profile, laps and leaderboards. Your @{profile.username} stays the same.</span>
          </div>
        ) : (
          <button className="list-item" onClick={() => setEditName(true)}>
            <span className="grow">
              <span className="mute small-text">Display name</span>
              <strong>{nameOf(profile)}</strong>
            </span>
            <Pencil size={20} aria-hidden="true" />
          </button>
        )}
        <div className="list-item settings-col">
          <span className="mute small-text">Avatar colour (without a photo)</span>
          <div className="row wrap" role="radiogroup" aria-label="Avatar colour" style={{ gap: 10 }}>
            {HUES.map((h) => (
              <button
                key={h}
                role="radio"
                aria-checked={profile.avatarHue === h}
                aria-label={`Hue ${h}`}
                className="hue-dot"
                style={{ background: `oklch(50% 0.15 ${h})` }}
                onClick={() => setHue(h)}
              />
            ))}
          </div>
        </div>
      </div>

      <h2 className="section-title">Theme</h2>
      <div className="list">
        <div className="themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className="theme-opt" onClick={() => setTheme(t.id)}>
              <i style={{ background: swatch(t.swatches) }} aria-hidden="true" />
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <h2 className="section-title">Driving</h2>
      <div className="list">
        <div className="list-item">
          <span className="grow">
            <strong>Countdown</strong>
            <span className="mute small-text">Lights go out this long after Start</span>
          </span>
          <span className="stepper" role="group" aria-label="Countdown seconds">
            <button className="icon-btn" aria-label="Shorter" disabled={countdown <= 3} onClick={() => setCountdown(countdown - 1)}>
              <ChevronLeft size={18} />
            </button>
            <strong>{countdown} s</strong>
            <button className="icon-btn" aria-label="Longer" disabled={countdown >= 10} onClick={() => setCountdown(countdown + 1)}>
              <ChevronRight size={18} />
            </button>
          </span>
        </div>
        <button className="list-item" onClick={() => setShowLogs((v) => !v)} aria-expanded={showLogs}>
          <span className="grow">
            <strong>GPS logs</strong>
            <span className="mute small-text">Your last 5 real drives, kept on this phone</span>
          </span>
          <span className="badge">{logs.length}</span>
          <ChevronRight size={18} aria-hidden="true" style={{ transform: showLogs ? 'rotate(90deg)' : undefined }} />
        </button>
        {showLogs && (
          <>
            {logs.length === 0 && (
              <p className="list-item mute small-text">No drives recorded yet. Replay them from Drive → Simulate, or send them to the developer to test timing.</p>
            )}
            {logs.map((l) => (
              <div key={l.recordedAt} className="list-item">
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="ellipsis">{l.route.name}</strong>
                  <span className="mute small-text">
                    {new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {l.fixes.length} fixes
                  </span>
                </span>
                <button className="btn sm" onClick={() => downloadLog(l)}>
                  Download
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    deleteLog(l.recordedAt);
                    setLogs(listLogs());
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <h2 className="section-title">Route creation</h2>
      <div className="list">
        <div className="list-item settings-col">
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
            <p className="mute">You can build private routes that only you see. Publishing a route, with a leaderboard, is for approved creators.</p>
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
          <div className="list-item settings-col">
            <span className="mute small-text">
              Map usage this month · resets {usage.resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
            </span>
            <UsageBar label="Map loads" value={usage.mapLoads} cap={USAGE_CAP.mapLoads} />
            <UsageBar label="Road snapping" value={usage.directions} cap={USAGE_CAP.directions} />
            <UsageBar label="Route card maps" value={usage.staticMaps} cap={USAGE_CAP.staticMaps} />
            <span className="mute small-text">The app pauses at the limit to stay free.</span>
          </div>
        )}
      </div>

      <InstallButton className="btn block install-cta" />
      <AndroidAppButton className="btn block install-cta" />

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
        <span style={{ width: `${pct}%`, background: pct > 90 ? 'var(--red)' : 'var(--navy)' }} />
      </div>
    </div>
  );
}

/** A theme's colours as one round swatch, split like a pie. */
function swatch(colours: readonly string[]) {
  const n = colours.length;
  return `conic-gradient(from 225deg, ${colours.map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(', ')})`;
}
