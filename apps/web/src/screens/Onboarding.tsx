import { useState, type FormEvent } from 'react';
import { createProfile, USERNAME_RE, usernameTaken } from '../lib/data';
import { useSession } from '../lib/session';
import { Avatar, errorMessage, SectorStrip } from '../components/ui';

export function Onboarding() {
  const { user, signOut } = useSession();
  const [username, setUsername] = useState(() => suggestUsername(user?.displayName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = USERNAME_RE.test(username);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || !valid) return;
    setBusy(true);
    setError(null);
    try {
      if (await usernameTaken(username)) {
        setError(`"${username}" is taken. Try another.`);
        return;
      }
      await createProfile(user.uid, username);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen no-tabs onboarding">
      <span className="onboarding-stripe">
        <SectorStrip colours={['purple', 'green', 'yellow']} height={10} />
      </span>
      <h1>Pick a username</h1>
      <p className="mute" style={{ marginTop: 8 }}>
        Other drivers find you by it and see it on every lap you post. It can't be changed later; your display name (in Settings) can.
      </p>
      <div className="row" style={{ gap: 14, marginTop: 20 }}>
        <Avatar name={username || '?'} size={56} />
        <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontSize: 18 }}>{username || 'your_name'}</strong>
          <span className="mute small-text">Your roundel until you add a photo</span>
        </span>
      </div>
      <form className="stack" style={{ marginTop: 24 }} onSubmit={submit} noValidate>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            value={username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            aria-invalid={username.length > 0 && !valid}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
            placeholder="e.g. tomas_k"
          />
          <small>3–20 characters: letters, numbers, _ and .</small>
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary lg block" disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={signOut}>
          Use a different account
        </button>
      </form>
    </main>
  );
}

/** "Jana Nováková" → "Jana_Novakova": a starting point from the Google name, if it makes a valid username. */
export function suggestUsername(name: string | null | undefined): string {
  const s = (name ?? '')
    // NFD splits "á" into "a" + accent; the accent goes with the other non-username characters below.
    .normalize('NFD')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.]/g, '')
    .slice(0, 20);
  return USERNAME_RE.test(s) ? s : '';
}
