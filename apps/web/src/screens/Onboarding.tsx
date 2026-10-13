import { useState, type FormEvent } from 'react';
import { createProfile, USERNAME_RE, usernameTaken } from '../lib/data';
import { useSession } from '../lib/session';
import { errorMessage } from '../components/ui';

export function Onboarding() {
  const { user, signOut } = useSession();
  const [username, setUsername] = useState('');
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
      <h1>Pick a username</h1>
      <p className="mute" style={{ marginTop: 8 }}>
        It's how other drivers find you and how your laps are signed on leaderboards.
      </p>
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
