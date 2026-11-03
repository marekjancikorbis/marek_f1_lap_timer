import { ChevronLeft } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getPhoto, getProfile } from '../lib/data';
import { useMe } from '../lib/session';
import { PageSkeleton } from './Skeleton';
import { nameOf } from '../lib/format';
import type { SectorColourName } from '../lib/types';

// ---------------------------------------------------------------- avatar

/** Initials on the driver's colour, or their photo once it loads (pass uid). */
export function Avatar({ name, hue = 210, size = 36, uid }: { name: string; hue?: number; size?: number; uid?: string }) {
  const photo = useLoaded(uid, getPhoto);
  // petra_r -> PR, Tomáš Kolář -> TK, perf -> PE
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)) || '?';
  const ring = size >= 64 ? 5 : size >= 40 ? 3 : 2;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: photo ? `center / cover url(${photo})` : `oklch(50% 0.15 ${hue})`,
        // A roundel: an off-white ring inside a hairline, around initials or a photo.
        boxShadow: `inset 0 0 0 ${ring}px var(--card), 0 0 0 ${ring > 2 ? 1.5 : 1}px var(--hairline-2)`,
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

export function SectorStrip({ colours, height = 10 }: { colours: (SectorColourName | null)[]; height?: number }) {
  return (
    // The lap's livery: one slanted band per sector; a sector without a time is an empty outline.
    <div
      className="lap-stripe"
      role="img"
      aria-label={colours.map((c, i) => `Sector ${i + 1} ${c ? STRIP_LABEL[c] : 'no data'}`).join(', ')}
    >
      {colours.map((c, i) => (
        <span key={i} className={c ? undefined : 'empty'} style={{ height, background: c ? STRIP[c] : undefined }} />
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
        {title && (typeof title === 'string' ? <h1 className={back ? 'bar-title ellipsis' : undefined}>{title}</h1> : title)}
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------- tab bar

export function TabBar() {
  const { profile } = useMe();
  const tabs = [
    { to: '/', label: 'Feed', icon: 'M4 6h16M4 12h16M4 18h10', end: true },
    { to: '/explore', label: 'Explore', icon: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-4-4' },
    { to: '/drive', label: 'Drive', icon: '', end: true },
    { to: '/routes', label: 'Routes', icon: 'M5 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM19 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7 18h7a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h7' },
    // Your profile's own address, not /me (a redirect), so the tab lights up there.
    { to: `/u/${profile.username}`, label: 'Profile', icon: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21c1.2-4.5 14.8-4.5 16 0' },
  ];
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        {tabs.map(({ to, label, icon, end }) =>
          to === '/drive' ? (
            // Driving is the main job: a raised button in the middle.
            <NavLink key={to} to={to} end={end} className="tab-go" aria-label={label}>
              <span className="tab-go-btn" aria-hidden="true">
                GO
              </span>
            </NavLink>
          ) : (
            <NavLink key={to} to={to} end={end}>
              <TabIcon d={icon} />
              {label}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}

/** The tab bar's own glyphs, drawn as in the mockups. */
function TabIcon({ d }: { d: string }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
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
    <div className="empty">
      {icon && <div className="empty-glyph">{icon}</div>}
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
