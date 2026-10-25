import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearCache } from './data';
import { auth, db } from './firebase';
import type { Profile, Role } from './types';

interface Session {
  /** undefined while Firebase is still restoring the session. */
  user: User | null | undefined;
  profile: Profile | null | undefined;
  role: Role;
  isCreator: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [role, setRole] = useState<Role>('driver');

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        clearCache(); // one user's reads never show for the next
        setUser(u);
      }),
    [],
  );

  useEffect(() => {
    if (!user) {
      setProfile(user === null ? null : undefined);
      setRole('driver');
      return;
    }
    setProfile(undefined);
    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as Profile) : null),
      () => setProfile(null),
    );
    const unsubRole = onSnapshot(
      doc(db, 'roles', user.uid),
      (snap) => setRole(snap.exists() ? (snap.data().role as Role) : 'driver'),
      () => setRole('driver'),
    );
    return () => {
      unsubProfile();
      unsubRole();
    };
  }, [user]);

  const value: Session = {
    user,
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

/** Profile is guaranteed inside the signed-in app shell. */
export function useMe(): { user: User; profile: Profile; role: Role; isCreator: boolean; isAdmin: boolean; isOwner: boolean } {
  const s = useSession();
  if (!s.user || !s.profile) throw new Error('useMe outside the signed-in app');
  return { user: s.user, profile: s.profile, role: s.role, isCreator: s.isCreator, isAdmin: s.isAdmin, isOwner: s.isOwner };
}
