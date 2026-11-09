import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearCache } from './data';
import { auth, db } from './firebase';
import type { Profile, Role } from './types';

interface Session {
  /** undefined while Firebase is still confirming the session (a server round trip on every launch). */
  user: User | null | undefined;
  /**
   * Who the app is showing: the signed-in user, or before Firebase has answered, the account that was
   * signed in last time on this phone (optimistic launch). null: signed out.
   */
  uid: string | null | undefined;
  profile: Profile | null | undefined;
  role: Role;
  isCreator: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/**
 * Optimistic launch: the last signed-in account and its profile, kept on the phone, so the app opens
 * straight into Home instead of waiting for Firebase to check the session with its server. That check
 * still runs behind it; if the session is no longer valid, it signs out then.
 */
const KEY = 'ps-session';
type Snapshot = { uid: string; profile: Profile };
function readSnapshot(): Snapshot | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Snapshot | null;
    return v?.uid && v.profile?.id === v.uid ? v : null;
  } catch {
    return null;
  }
}
function writeSnapshot(v: Snapshot | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or full storage: the app just opens the slow way.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snap] = useState(readSnapshot);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [uid, setUid] = useState<string | null | undefined>(snap?.uid);
  const [profile, setProfile] = useState<Profile | null | undefined>(snap?.profile);
  const [role, setRole] = useState<Role>('driver');

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        const next = u?.uid ?? null;
        setUid((shown) => {
          if (shown !== next) clearCache(); // one user's reads never show for the next
          return next;
        });
        if (!u) writeSnapshot(null);
        setUser(u);
      }),
    [],
  );

  useEffect(() => {
    if (!uid) {
      setProfile(uid === null ? null : undefined);
      setRole('driver');
      return;
    }
    setProfile((p) => (p?.id === uid ? p : undefined));
    // Right after sign-up the listener can start before the new sign-in reaches Firestore and be refused once;
    // a refused listener stops for good, so listen again (otherwise Pick a username never moves on).
    let unsubProfile = () => {};
    let retry = 0;
    let tries = 0;
    const listen = () => {
      unsubProfile = onSnapshot(
        doc(db, 'users', uid),
        (d) => {
          // A copy from the phone's cache that has no profile yet isn't an answer: wait for the server.
          if (!d.exists() && d.metadata.fromCache) return;
          const p = d.exists() ? ({ id: d.id, ...d.data() } as Profile) : null;
          setProfile(p);
          writeSnapshot(p ? { uid, profile: p } : null);
        },
        () => {
          setProfile(null);
          if (tries++ < 5) retry = window.setTimeout(listen, 1000 * tries);
        },
      );
    };
    listen();
    const unsubRole = onSnapshot(
      doc(db, 'roles', uid),
      (snap) => setRole(snap.exists() ? (snap.data().role as Role) : 'driver'),
      () => setRole('driver'),
    );
    return () => {
      window.clearTimeout(retry);
      unsubProfile();
      unsubRole();
    };
  }, [uid]);

  const value: Session = {
    user,
    uid,
    profile,
    role,
    isCreator: role === 'creator' || role === 'admin' || role === 'owner',
    isAdmin: role === 'admin' || role === 'owner',
    isOwner: role === 'owner',
    signOut: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Profile is guaranteed inside the signed-in app shell (the Firebase user may still be on its way: see uid). */
export function useMe(): { profile: Profile; role: Role; isCreator: boolean; isAdmin: boolean; isOwner: boolean } {
  const s = useSession();
  if (!s.uid || !s.profile) throw new Error('useMe outside the signed-in app');
  return { profile: s.profile, role: s.role, isCreator: s.isCreator, isAdmin: s.isAdmin, isOwner: s.isOwner };
}
