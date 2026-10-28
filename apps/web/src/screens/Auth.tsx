import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import { auth } from '../lib/firebase';
import { errorMessage } from '../components/ui';
import { Hero } from '../components/Hero';
import { InstallButton } from '../components/InstallButton';
import { isStandalone } from '../lib/install';

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Coming back from a Google redirect: success signs in via the session listener; show any failure here.
  useEffect(() => {
    getRedirectResult(auth).catch((err) => setError(errorMessage(err)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth, email.trim(), password);
      else await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setBusy(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      // An installed app (home-screen PWA) can't open popups on iOS: go to Google and back instead.
      if (isStandalone()) await signInWithRedirect(auth, provider);
      else await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-blocked') await signInWithRedirect(auth, provider).catch((e) => setError(errorMessage(e)));
      else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) {
      setError('Enter your email first, then tap "Forgot password".');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo(`Password reset email sent to ${email.trim()}.`);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="auth">
      <Hero />
      <form className="stack auth-form" onSubmit={submit} noValidate>
        <div className="segmented" role="group" aria-label="Account">
          <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>
            Sign in
          </button>
          <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>
            Create account
          </button>
        </div>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {mode === 'up' && <small>At least 6 characters.</small>}
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {info && <p className="notice info">{info}</p>}
        <button className="btn primary lg block" disabled={busy || !email || password.length < 6}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="btn lg block" onClick={google} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Continue with Google
        </button>
        {mode === 'in' && (
          <button type="button" className="btn ghost sm" onClick={reset} style={{ alignSelf: 'center' }}>
            Forgot password
          </button>
        )}
      </form>
      <InstallButton className="btn ghost block" />
    </main>
  );
}

