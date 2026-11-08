import { Capacitor } from '@capacitor/core';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { auth } from '../lib/firebase';
import { errorMessage } from '../components/ui';
import { AndroidAppButton, InstallButton } from '../components/InstallButton';
import { isStandalone } from '../lib/install';

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      // The Android app: Google blocks its sign-in page inside apps, so Android's own account picker
      // signs in and the web SDK takes over with its token.
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { credential } = await FirebaseAuthentication.signInWithGoogle();
        if (credential?.idToken) await signInWithCredential(auth, GoogleAuthProvider.credential(credential.idToken));
        return;
      }
      // An installed app (home-screen PWA) can't open popups on iOS: go to Google and back instead.
      if (isStandalone()) await signInWithRedirect(auth, provider);
      else await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-blocked') await signInWithRedirect(auth, provider).catch((e) => setError(errorMessage(e)));
      // The app's account picker reports closing it as an error whose message says "cancel".
      else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request' && !/cancel/i.test((err as Error).message ?? ''))
        setError(errorMessage(err));
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
    <main className="ph soft col">
      <div className="sb" />
      <div style={{ padding: '0 28px', margin: 'auto 0 28px' }}>
        <h1 className="t" style={{ fontSize: 54, lineHeight: 0.92 }}>
          Purple
          <br />
          Sector
        </h1>
        <p className="lbl" style={{ fontSize: 16, marginTop: 14 }}>
          Time your drives. Race the lap to beat.
        </p>
      </div>
      <form className="glass sheet sheet-b static" style={{ padding: '24px 20px 20px', display: 'grid', gap: 10 }} onSubmit={submit} noValidate>
        <label className="field">
          <span className="visually-hidden">Email</span>
          <input type="email" autoComplete="email" inputMode="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="visually-hidden">Password</span>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            placeholder={mode === 'up' ? 'Password, 6 characters or more' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <button type="button" className="mute" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </label>
        {error && (
          <p className="err" role="alert" style={{ padding: '0 6px' }}>
            {error}
          </p>
        )}
        {info && <p className="lbl" style={{ padding: '0 6px' }}>{info}</p>}
        <button className="solid" style={{ marginTop: 6 }} disabled={busy || !email || password.length < 6}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="solid quiet" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Create account' : 'I have an account'}
        </button>
        <div className="lbl" style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
          <button type="button" onClick={google} disabled={busy}>
            Continue with Google
          </button>
          {mode === 'in' && (
            <button type="button" onClick={reset}>
              Forgot password
            </button>
          )}
          <InstallButton className="" />
          <AndroidAppButton className="" />
        </div>
      </form>
    </main>
  );
}

