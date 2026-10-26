import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, WhoText } from '../components/ui';
import { followerIds, followingIds, getProfileByUsername, getProfiles } from '../lib/data';
import type { Profile } from '../lib/types';

export default function FollowList() {
  const { username = '', list = 'followers' } = useParams();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followers = list === 'followers';

  useEffect(() => {
    setPeople(null);
    (async () => {
      try {
        const p = await getProfileByUsername(username);
        if (!p) return setPeople([]);
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
      <ScreenHead back title={followers ? 'Followers' : 'Following'} />
      <p className="mute" style={{ marginTop: -8, marginBottom: 16 }}>
        @{username}
      </p>
      {error && <p className="notice error">{error}</p>}
      {people === null ? (
        <Loading />
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
              <FollowButton userId={p.id} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
