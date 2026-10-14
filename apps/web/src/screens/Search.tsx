import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { Avatar, Empty, errorMessage, Spinner } from '../components/ui';
import { getRole, postCount, searchUsers } from '../lib/data';
import type { Profile, Role } from '../lib/types';
import { ROLE_LABEL } from '../lib/format';

export default function Search() {
  const [q, setQ] = useState(() => sessionStorage.getItem('search-q') ?? '');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem('search-q', q);
    const term = q.trim();
    if (!term) {
      setResults(null);
      return;
    }
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await searchUsers(term);
        setResults(r);
        setError(null);
        const entries = await Promise.all(r.map(async (p) => [p.id, await postCount(p.id).catch(() => 0)] as const));
        setCounts(Object.fromEntries(entries));
        const roleEntries = await Promise.all(r.map(async (p) => [p.id, await getRole(p.id)] as const));
        setRoles(Object.fromEntries(roleEntries));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <main className="screen">
      <header className="screen-head">
        <h1>Search</h1>
      </header>
      <label className="search-box">
        <SearchIcon size={20} aria-hidden="true" />
        <span className="visually-hidden">Search drivers by username</span>
        <input
          className="input"
          type="search"
          placeholder="Search drivers by username"
          value={q}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {busy && <Spinner label="Searching" />}
      </label>

      {error && <p className="notice error" style={{ marginTop: 16 }}>{error}</p>}

      {results === null ? (
        <p className="mute" style={{ marginTop: 24, textAlign: 'center' }}>
          Type the start of a username to find a driver.
        </p>
      ) : results.length === 0 && !busy ? (
        <Empty title="No drivers found">Nobody's username starts with "{q.trim()}".</Empty>
      ) : (
        <div className="list" style={{ marginTop: 16 }}>
          {results.map((p) => (
            <div className="list-item" key={p.id}>
              <Link to={`/u/${p.username}`} className="row grow" style={{ gap: 12, textDecoration: 'none' }}>
                <Avatar name={p.username} hue={p.avatarHue} size={40} />
                <span className="grow">
                  <strong>{p.username}</strong>
                  {roles[p.id] && roles[p.id] !== 'driver' && (
                    <span className="badge outline" style={{ marginLeft: 8 }}>
                      {ROLE_LABEL[roles[p.id] as keyof typeof ROLE_LABEL]}
                    </span>
                  )}
                  <br />
                  <span className="mute" style={{ fontSize: 14 }}>
                    {counts[p.id] ?? '–'} posted {counts[p.id] === 1 ? 'lap' : 'laps'}
                  </span>
                </span>
              </Link>
              <FollowButton userId={p.id} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
