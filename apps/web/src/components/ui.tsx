import { ChevronLeft, Map, Play, Rss, Timer, User } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getPhoto, getProfile } from '../lib/data';
import { nameOf } from '../lib/format';
import type { SectorColourName } from '../lib/types';

// ---------------------------------------------------------------- avatar

/** Initials on the driver's colour, or their photo once it loads (pass uid). */
export function Avatar({ name, hue = 210, size = 36, uid }: { name: string; hue?: number; size?: number; uid?: string }) {
  const photo = useLoaded(uid, getPhoto);
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?';
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: photo ? `center / cover url(${photo})` : `oklch(42% 0.09 ${hue})`,
        boxShadow: `inset 0 0 0 1px oklch(60% 0.1 ${hue} / 0.5)`,
      }}
    >
      {!photo && initials}
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
      {name !== fallback && <span className="handle"> @{fallback}</span>}
    </>
  );
}

/** Display name over @handle, for lists of drivers. */
export function WhoText({ p }: { p: { username: string; displayName?: string } }) {
  return (
    <span className="grow who-text">
      <strong className="ellipsis">{nameOf(p)}</strong>
      <span className="mute ellipsis small-text">@{p.username}</span>
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

const STRIP: Record<SectorColourName, string> = { purple: 'var(--purple)', green: 'var(--green)', yellow: 'var(--yellow)' };
export const STRIP_LABEL: Record<SectorColourName, string> = { purple: 'best ever', green: 'faster', yellow: 'slower' };

export function SectorStrip({ colours, height = 8 }: { colours: (SectorColourName | null)[]; height?: number }) {
  return (
    <div
      role="img"
      aria-label={colours.map((c, i) => `Sector ${i + 1} ${c ? STRIP_LABEL[c] : 'no data'}`).join(', ')}
      style={{ display: 'flex', gap: 3 }}
    >
      {colours.map((c, i) => (
        <span key={i} style={{ flex: 1, height, borderRadius: 2, background: c ? STRIP[c] : 'var(--hairline-2)' }} />
      ))}
    </div>
  );
}

export const COLOUR_VAR: Record<SectorColourName, string> = STRIP;

// ---------------------------------------------------------------- head / back

export function ScreenHead({ title, back, right }: { title?: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="screen-head">
      <div className="row grow">
        {back && (
          <button
            className="icon-btn back"
            aria-label="Back"
            onClick={() => (typeof back === 'string' ? nav(back) : window.history.length > 1 ? nav(-1) : nav('/'))}
          >
            <ChevronLeft size={26} />
          </button>
        )}
        {title && (typeof title === 'string' ? <h1 style={{ fontSize: back ? '1.5rem' : undefined }}>{title}</h1> : title)}
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------- tab bar

export function TabBar() {
  const tabs = [
    { to: '/', label: 'Feed', icon: Rss, end: true },
    { to: '/explore', label: 'Explore', icon: Map },
    { to: '/drive', label: 'Drive', icon: Play, end: true },
    { to: '/times', label: 'My times', icon: Timer },
    { to: '/me', label: 'Profile', icon: User },
  ];
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        {tabs.map(({ to, label, icon: Icon, end }) =>
          to === '/drive' ? (
            // Driving is the main job: a raised button in the middle.
            <NavLink key={to} to={to} end={end} className="tab-go">
              <span className="tab-go-btn">
                <Icon size={26} fill="currentColor" aria-hidden="true" />
              </span>
              {label}
            </NavLink>
          ) : (
            <NavLink key={to} to={to} end={end}>
              <Icon size={22} strokeWidth={2} aria-hidden="true" />
              {label}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- spinner / empty

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading() {
  return (
    <div className="center-fill">
      <Spinner />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
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
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
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
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
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
          <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
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
