import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { SkeletonRows } from '../components/Skeleton';
import { Avatar, Empty, errorMessage, ScreenHead, Segmented, WhoText } from '../components/ui';
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
    <main className="screen">
      <ScreenHead back title={`@${username}`} />
      <Segmented
        label="Show"
        value={followers ? 'followers' : 'following'}
        onChange={(v) => nav(`/u/${username}/${v}`, { replace: true })}
        options={[
          { value: 'followers', label: `Followers${counts ? ` ${counts.followers}` : ''}` },
          { value: 'following', label: `Following${counts ? ` ${counts.following}` : ''}` },
        ]}
      />
      <div style={{ height: 14 }} />
      {error && <p className="notice error">{error}</p>}
      {people === null ? (
        <SkeletonRows />
      ) : people.length === 0 ? (
        <Empty title={followers ? 'No followers yet' : 'Not following anyone'} />
      ) : (
        <div className="list">
          {people.map((p) => (
            <div className="list-item" key={p.id}>
              <Link to={`/u/${p.username}`} className="row grow" style={{ gap: 12, textDecoration: 'none' }}>
                <Avatar name={p.username} hue={p.avatarHue} size={40} uid={p.id} />
                <WhoText p={p} />
              </Link>
              <FollowButton userId={p.id} back={followers && username === me.username} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
