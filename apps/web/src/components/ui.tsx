import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { goBack } from '../lib/navStack';
import { getPhoto, getProfile } from '../lib/data';
import { useMe } from '../lib/session';
import { PageSkeleton } from './Skeleton';
import { nameOf } from '../lib/format';
import type { SectorColourName } from '../lib/types';

// ---------------------------------------------------------------- avatar

/** Initials on the driver's pastel colour (the mockup's .av), or their photo once it loads (pass uid). */
export function Avatar({ name, hue = 210, size = 36, uid }: { name: string; hue?: number; size?: number; uid?: string }) {
  const photo = useLoaded(uid, getPhoto);
  // petra_r -> PR, Tomáš Kolář -> TK, perf -> PE
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)) || '?';
  return (
    <span
      className="av"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size / 3),
        background: photo ? `center / cover url(${photo})` : `oklch(86% 0.07 ${hue})`,
      }}
    >
      {!photo && initials.toUpperCase()}
    </span>
  );
}

/**
 * A driver's current display name, where only their @handle was stored (posts, notifications).
 * The @handle follows whenever the name differs from it, so nobody can pass as someone else by name.
 */
export function UserName({ uid, fallback }: { uid: string; fallback: string }) {
  const p = useLoaded(uid, getProfile);
  const name = p ? nameOf(p) : fallback;
  return (
    <>
      {name}
      {name !== fallback && <span className="mute"> @{fallback}</span>}
    </>
  );
}

/** Display name over @handle, for lists of drivers. */
export function WhoText({ p }: { p: { username: string; displayName?: string } }) {
  return (
    <span style={{ minWidth: 0 }}>
      <b className="ellipsis" style={{ display: 'block' }}>{nameOf(p)}</b>
      <span className="lbl ellipsis" style={{ display: 'block' }}>@{p.username}</span>
    </span>
  );
}

function useLoaded<T>(id: string | undefined, load: (id: string) => Promise<T | null>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    setValue(null);
    if (!id) return;
    let live = true;
    load(id).then((v) => live && setValue(v), () => undefined);
    return () => {
      live = false;
    };
  }, [id, load]);
  return value;
}

// ---------------------------------------------------------------- sector strip

const STRIP: Record<SectorColourName, string> = { purple: 'var(--s-p)', green: 'var(--s-g)', yellow: 'var(--s-y)' };
export const STRIP_LABEL: Record<SectorColourName, string> = { purple: 'best ever', green: 'faster', yellow: 'slower' };

/** The mockup's .st: one short bar per sector; a sector without a time stays faint. */
export function SectorStrip({ colours, height = 5, wide }: { colours: (SectorColourName | null)[]; height?: number; wide?: boolean }) {
  return (
    <div className="st" role="img" aria-label={colours.map((c, i) => `Sector ${i + 1} ${c ? STRIP_LABEL[c] : 'no data'}`).join(', ')}>
      {colours.map((c, i) => (
        <i key={i} className={c ? c[0] : undefined} style={{ height, ...(wide ? { flex: 1, width: 'auto' } : null) }} />
      ))}
    </div>
  );
}

export const COLOUR_VAR: Record<SectorColourName, string> = STRIP;

// ---------------------------------------------------------------- head / back

/** A detail screen's top: the glass back button (and any buttons on the right), then the title. */
export function ScreenHead({ title, back, right }: { title?: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="head">
      {(back || right) && (
        <div className="head-bar">
          {back ? (
            <button
              className="glass ib"
              aria-label="Back"
              onClick={() => (typeof back === 'string' ? nav(back) : goBack(nav))}
            >
              <I n="back" />
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>{right}</div>
        </div>
      )}
      {title && (typeof title === 'string' ? <h1 className="title">{title}</h1> : title)}
    </header>
  );
}

// ---------------------------------------------------------------- tab bar

export function TabBar() {
  const { profile } = useMe();
  // One route's laps belong to Times, though they live under the route's address.
  const inTimes = /^\/r\/[^/]+\/history/.test(useLocation().pathname);
  const tabs: { to: string; label: string; icon: IconName; end?: boolean }[] = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/explore', label: 'Explore', icon: 'map' },
    { to: '/drive', label: 'Drive', icon: 'flag', end: true },
    { to: '/routes', label: 'Times', icon: 'watch' },
    // Your profile's own address, not /me (a redirect), so the tab lights up there.
    { to: `/u/${profile.username}`, label: 'Profile', icon: 'user' },
  ];
  return (
    <nav className="glass dock" aria-label="Main">
      {tabs.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          className={({ isActive }) => `tab${to === '/drive' ? ' go' : ''}${isActive || (inTimes && to === '/routes') ? ' on' : ''}`}
        >
          <I n={icon} />
        </NavLink>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- icons (the mockup's own set)

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />,
  flag: <path d="M5 21V4h12l-2 4 2 4H5" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  back: <path d="m15 5-7 7 7 7" />,
  fwd: <path d="m9 5 7 7-7 7" />,
  share: <path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6" />,
  vol: <path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />,
  mute: <path d="M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  routes: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h8" />
    </>
  ),
  watch: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  loc: <path d="M12 2 4 21l8-4 8 4z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
} as const;
export type IconName = keyof typeof ICONS;

/** One of the mockup's line icons (svg.i: 22 px, round caps, stroke 1.9). */
export function I({ n, size, style }: { n: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size, ...style } : style}>
      {ICONS[n]}
    </svg>
  );
}

// ---------------------------------------------------------------- spinner / empty

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

/** A whole screen loading: a grey sketch of the screen at this address instead of a lone spinner. */
export function Loading() {
  return <PageSkeleton path={useLocation().pathname} />;
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-note">
      {icon}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- controls

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** The mockup's .seg: a glass track, the chosen side a lighter pill. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="glass sheet seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : undefined} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sheet

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={ref} className="glass sheet sheet-b modal" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toast

type ToastFn = (message: string, kind?: 'info' | 'error') => void;
const ToastCtx = createContext<ToastFn>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; kind: 'info' | 'error' } | null>(null);
  const show = useCallback<ToastFn>((message, kind = 'info') => {
    const id = Date.now();
    setToast({ id, message, kind });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), kind === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`glass sheet toast ${toast.kind === 'error' ? 'error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Human message for Firestore / Auth errors. */
export function errorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('permission-denied')) return "You don't have permission to do that.";
  if (code.includes('unavailable') || code.includes('network')) return 'No connection. Try again when you have signal.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
    return 'Email or password is wrong.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead.';
  if (code === 'auth/weak-password') return 'Use a password of at least 6 characters.';
  if (code === 'auth/invalid-email') return 'That email address looks wrong.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'auth/popup-closed-by-user') return 'Sign-in window was closed.';
  if (code === 'auth/account-exists-with-different-credential')
    return 'This email already has an account with a password. Sign in with email and password.';
  if (code === 'auth/unauthorized-domain') return "Sign-in isn't allowed from this web address.";
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found')
    return 'This sign-in method is not enabled yet.';
  if (code.includes('failed-precondition')) return 'The database is still building an index. Try again in a minute.';
  return (e as Error)?.message || 'Something went wrong.';
}
