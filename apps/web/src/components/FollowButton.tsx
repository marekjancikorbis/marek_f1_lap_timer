import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { follow, unfollow } from '../lib/data';
import { db } from '../lib/firebase';
import { useMe } from '../lib/session';
import { errorMessage, useToast } from './ui';

export function FollowButton({ userId, size = 'sm', onChange }: { userId: string; size?: 'sm' | 'lg'; onChange?: (following: boolean) => void }) {
  const { profile } = useMe();
  const toast = useToast();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (userId === profile.id) return;
    return onSnapshot(
      doc(db, 'follows', `${profile.id}_${userId}`),
      (s) => setFollowing(s.exists()),
      () => setFollowing(false),
    );
  }, [profile.id, userId]);

  if (userId === profile.id) return null;

  async function toggle() {
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic
    try {
      if (next) await follow(profile.id, userId);
      else await unfollow(profile.id, userId);
      onChange?.(next);
    } catch (e) {
      setFollowing(!next);
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`btn ${size === 'sm' ? 'sm' : ''} ${following ? '' : 'primary'}`}
      onClick={toggle}
      disabled={busy || following === null}
      aria-pressed={!!following}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
