import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { SkeletonRows } from '../components/Skeleton';
import { Avatar, Empty, errorMessage, ScreenHead, Segmented } from '../components/ui';
import { followCounts, followerIds, followingIds, getProfileByUsername, getProfiles } from '../lib/data';
import { useMe } from '../lib/session';
import type { Profile } from '../lib/types';

export default function FollowList() {
  const { username = '', list = 'followers' } = useParams();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followers = list === 'followers';
  const nav = useNavigate();
  const { profile: me } = useMe();
  const [counts, setCounts] = useState<{ followers: number; following: number } | null>(null);

  useEffect(() => {
    setPeople(null);
    (async () => {
      try {
        const p = await getProfileByUsername(username);
        if (!p) return setPeople([]);
        followCounts(p.id).then(setCounts, () => undefined);
        const ids = followers ? await followerIds(p.id) : await followingIds(p.id);
        const map = await getProfiles(ids);
        setPeople(ids.map((id) => map.get(id)).filter((x): x is Profile => !!x));
      } catch (e) {
        setError(errorMessage(e));
        setPeople([]);
      }
    })();
  }, [username, followers]);

  return (
    <main className="ph soft">
      <div className="sb" />
      <ScreenHead back title={`@${username}`} />
      <div style={{ padding: '14px 16px 0' }}>
        <Segmented
          label="Show"
          value={followers ? 'followers' : 'following'}
          onChange={(v) => nav(`/u/${username}/${v}`, { replace: true })}
          options={[
            { value: 'followers', label: counts ? `${counts.followers} ${counts.followers === 1 ? 'follower' : 'followers'}` : 'Followers' },
            { value: 'following', label: counts ? `${counts.following} following` : 'Following' },
          ]}
        />
      </div>
      {error && <p className="err" style={{ padding: '12px 24px 0' }}>{error}</p>}
      <div style={{ padding: '10px 24px 0' }}>
        {people === null ? (
          <SkeletonRows />
        ) : people.length === 0 ? (
          <Empty title={followers ? 'No followers yet' : 'Not following anyone'} />
        ) : (
          <div className="rows">
            {people.map((p) => (
              <div key={p.id}>
                <Link to={`/u/${p.username}`} aria-label={p.username}>
                  <Avatar name={p.username} hue={p.avatarHue} uid={p.id} />
                </Link>
                <Link to={`/u/${p.username}`} style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{p.username}</b>
                  {p.displayName && p.displayName !== p.username && <div className="lbl ellipsis">{p.displayName}</div>}
                </Link>
                <FollowButton userId={p.id} back={followers && username === me.username} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
