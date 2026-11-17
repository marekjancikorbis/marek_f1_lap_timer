import { useState, type FormEvent } from 'react';
import { createProfile, USERNAME_RE, usernameTaken } from '../lib/data';
import { useSession } from '../lib/session';
import { errorMessage, I } from '../components/ui';

const initials = (u: string) => (u.split(/[_.]/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();

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
    <main className="ph soft col">
      <div className="sb" />
      <div style={{ padding: '36px 20px 0' }}>
        <div className="k">Step 2 of 2</div>
        <h1 className="h1" style={{ marginTop: 6 }}>Pick a username</h1>
        <p className="sub" style={{ marginTop: 8 }}>
          Shown on every lap you post. It can't be changed later; your display name can.
        </p>
      </div>
      <div style={{ display: 'grid', justifyItems: 'center', marginTop: 52 }}>
        <span className="av" style={{ width: 104, height: 104, fontSize: 34, background: 'var(--main)', color: 'var(--on-main)' }}>
          {initials(username)}
        </span>
      </div>
      <form style={{ display: 'contents' }} onSubmit={submit} noValidate>
        <div style={{ padding: '40px 20px 0', display: 'grid', gap: 8 }}>
          <label className="k" htmlFor="onb-username" style={{ paddingLeft: 18 }}>Username</label>
          <label className="field" style={{ justifyContent: 'space-between', ...(valid ? { boxShadow: 'inset 0 0 0 2px var(--s-g)' } : null) }}>
            <span className="mute" aria-hidden="true">@</span>
            <input
              id="onb-username"
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              enterKeyHint="go"
              aria-invalid={username.length > 0 && !valid}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              placeholder="your_name"
              style={{ marginLeft: -8 }}
            />
            {valid && <I n="check" sm style={{ color: 'var(--s-g)' }} />}
          </label>
          <p className="sub" style={{ paddingLeft: 18 }}>
            3–20 letters, numbers, _ and .
          </p>
          {error && (
            <p className="err" role="alert" style={{ paddingLeft: 18 }}>
              {error}
            </p>
          )}
        </div>
        <div style={{ margin: 'auto 20px 0', paddingTop: 32, display: 'grid', gap: 10 }}>
          <button className="solid" disabled={!valid || busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
          <button type="button" className="sub" style={{ justifySelf: 'center', padding: 8, minHeight: 44 }} onClick={signOut}>
            Use a different account
          </button>
        </div>
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
