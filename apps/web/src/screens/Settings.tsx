import { useEffect, useRef, useState } from 'react';
import { AndroidAppButton, InstallButton } from '../components/InstallButton';
import { Avatar, errorMessage, I, ScreenHead, useToast } from '../components/ui';
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

  const card = { borderRadius: 28, padding: '16px 18px' } as const;
  const usePct = usage ? Math.max(usage.mapLoads / USAGE_CAP.mapLoads, usage.directions / USAGE_CAP.directions, usage.staticMaps / USAGE_CAP.staticMaps) * 100 : 0;
  const requestBox = (label: string, placeholder: string, primary: boolean) => (
    <>
      <label>
        <span className="visually-hidden">{label}</span>
        <textarea className="field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`${label}: ${placeholder}`} />
      </label>
      <button className={primary ? 'solid' : 'solid quiet'} disabled={busy} onClick={sendRequest}>
        {primary ? 'Request creator access' : 'Request admin access'}
      </button>
    </>
  );

  return (
    <main className="ph soft">
      <div className="sb" />
      <ScreenHead back title="Settings" />
      <div style={{ padding: '16px 16px 0', display: 'grid', gap: 12 }}>
        <div className="glass lift" style={{ ...card, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Avatar key={photoKey} name={profile.username} hue={profile.avatarHue} size={52} uid={profile.id} />
            {editName ? (
              <div style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0 }}>
                <label className="field" style={{ height: 44, flex: 1, minWidth: 0 }}>
                  <span className="visually-hidden">Display name</span>
                  <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={profile.username} enterKeyHint="done" />
                </label>
                <button
                  className="chip"
                  style={{ height: 44, borderRadius: 22, background: 'var(--main)', color: 'var(--on-main)' }}
                  disabled={savingName || !name.trim() || name.trim() === nameOf(profile)}
                  onClick={() => void saveName().then(() => setEditName(false))}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <button style={{ flex: 1, textAlign: 'left', minWidth: 0 }} onClick={() => setEditName(true)} aria-label={`Display name ${nameOf(profile)}. Change`}>
                <b className="ellipsis" style={{ display: 'block' }}>{nameOf(profile)}</b>
                <div className="lbl ellipsis">@{profile.username}</div>
              </button>
            )}
            {!editName && (
              <button className="lbl" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                {photoBusy ? 'Checking…' : 'Photo'}
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
          {editName && <p className="lbl">Shown on your profile, laps and leaderboards. Your @{profile.username} stays the same.</p>}
          {hasPhoto ? (
            <button className="lbl" style={{ justifySelf: 'start' }} onClick={() => void changePhoto(null, true)}>
              Remove photo
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} role="radiogroup" aria-label="Avatar colour">
              {HUES.map((h) => (
                <button
                  key={h}
                  role="radio"
                  aria-checked={profile.avatarHue === h}
                  aria-label={`Hue ${h}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: `oklch(86% 0.07 ${h})`,
                    boxShadow: profile.avatarHue === h ? '0 0 0 2px var(--night), 0 0 0 4px var(--ink)' : 'none',
                  }}
                  onClick={() => setHue(h)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="glass lift" style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Theme</span>
            <span className="lbl">Colours the whole app</span>
          </div>
          <div className="themes" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`theme${theme === t.id ? ' on' : ''}`} onClick={() => setTheme(t.id)}>
                <i style={{ background: swatch(t.swatches) }} aria-hidden="true" />
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="glass lift rows" style={{ borderRadius: 28, padding: '4px 18px' }}>
          <div style={{ gridTemplateColumns: '1fr auto' }}>
            <span>
              Countdown
              <span className="lbl" style={{ display: 'block' }}>Lights go out this long after Start</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }} role="group" aria-label="Countdown seconds">
              <button className="ib" style={{ width: 36, height: 36 }} aria-label="Shorter" disabled={countdown <= 3} onClick={() => setCountdown(countdown - 1)}>
                <I n="minus" size={18} />
              </button>
              <b className="t" style={{ fontSize: 19, minWidth: 34, textAlign: 'center' }}>{countdown} s</b>
              <button className="ib" style={{ width: 36, height: 36 }} aria-label="Longer" disabled={countdown >= 10} onClick={() => setCountdown(countdown + 1)}>
                <I n="plus" size={18} />
              </button>
            </span>
          </div>
          <button style={{ gridTemplateColumns: '1fr auto', textAlign: 'left' }} onClick={() => setShowLogs((v) => !v)} aria-expanded={showLogs}>
            <span>
              GPS logs
              <span className="lbl" style={{ display: 'block' }}>Your last 5 real drives, kept on this phone</span>
            </span>
            <b className="t" style={{ fontSize: 19 }}>{logs.length}</b>
          </button>
          {showLogs && logs.length === 0 && (
            <p className="lbl" style={{ display: 'block' }}>No drives recorded yet. Replay them from Drive, More options, Simulate, or send them to the developer to test timing.</p>
          )}
          {showLogs &&
            logs.map((l) => (
              <div key={l.recordedAt} style={{ gridTemplateColumns: '1fr auto auto' }}>
                <span style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{l.route.name}</b>
                  <span className="lbl">
                    {new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {l.fixes.length} fixes
                  </span>
                </span>
                <button className="chip" style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }} onClick={() => downloadLog(l)}>
                  Save
                </button>
                <button
                  className="chip"
                  style={{ background: 'color-mix(in srgb, #ff5a5f 20%, transparent)', color: '#ff9a9d' }}
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

        {usage && (
          <div className="glass lift" style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Map use</span>
              <b className="t" style={{ fontSize: 19 }}>{Math.round(usePct)}%</b>
            </div>
            <div style={{ height: 6, borderRadius: 3, marginTop: 12, background: 'color-mix(in srgb, var(--ink) 12%, transparent)' }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usePct)} aria-label="Map use this month">
              <i style={{ display: 'block', width: `${Math.min(100, usePct)}%`, height: '100%', borderRadius: 3, background: usePct > 90 ? '#ff5a5f' : 'var(--main-hi)' }} />
            </div>
            <p className="lbl" style={{ marginTop: 10 }}>
              Map loads {usage.mapLoads.toLocaleString()} / {USAGE_CAP.mapLoads.toLocaleString()} · road snapping {usage.directions.toLocaleString()} /{' '}
              {USAGE_CAP.directions.toLocaleString()} · route card maps {usage.staticMaps.toLocaleString()} / {USAGE_CAP.staticMaps.toLocaleString()}. Resets{' '}
              {usage.resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}; the app pauses at the limit to stay free.
            </p>
          </div>
        )}

        <div className="glass lift" style={{ ...card, display: 'grid', gap: 12 }}>
          <span>Route creation</span>
          {role === 'owner' ? (
            <p className="lbl">You&rsquo;re the owner. Unlimited public routes, shown as Official. Only you decide admin requests.</p>
          ) : role === 'admin' ? (
            <p className="lbl">You&rsquo;re an admin. Up to 5 public routes, shown as Official, and you handle creator requests.</p>
          ) : role === 'creator' ? (
            adminRequest === undefined ? null : adminRequest?.status === 'pending' ? (
              <p className="lbl">You&rsquo;re a creator with one public route. Admin request pending.</p>
            ) : (
              <>
                <p className="lbl">
                  You&rsquo;re a creator: you can build routes and publish one of them. Admins publish up to 5 routes as Official and approve new creators; the owner decides.
                </p>
                {adminRequest?.status === 'rejected' && <p style={{ color: 'var(--s-y)' }}>Your last admin request was declined. You can ask again.</p>}
                {requestBox('Note for the owner (optional)', 'which events do you organise?', false)}
              </>
            )
          ) : request === undefined ? null : request?.status === 'pending' ? (
            <p className="lbl">Request pending. The admin will review it.</p>
          ) : (
            <>
              {request?.status === 'rejected' && <p style={{ color: 'var(--s-y)' }}>Your last request was declined. You can ask again.</p>}
              <p className="lbl">You can build private routes that only you see. Publishing a route, with a leaderboard, is for approved creators.</p>
              {requestBox('Note for the admin (optional)', 'which track or event do you want to time?', true)}
            </>
          )}
        </div>

        <InstallButton className="solid quiet" />
        <AndroidAppButton className="solid quiet" />
        <button className="solid danger" style={{ marginTop: 12 }} onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}

/** A theme's colours as one round swatch, split like a pie. */
function swatch(colours: readonly string[]) {
  const n = colours.length;
  return `conic-gradient(from 225deg, ${colours.map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(', ')})`;
}
