import { BadgeCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Empty, errorMessage, Loading, ScreenHead } from '../components/ui';
import { markNotificationsSeen, notifications } from '../lib/data';
import { formatLap, timeAgo } from '../lib/format';
import { useMe } from '../lib/session';
import type { Notification } from '../lib/types';

export default function Notifications() {
  const { profile, role } = useMe();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once on open, so what was new stays marked while you look.
  const [seenAt] = useState(() => profile.notifSeenAt?.toMillis() ?? 0);

  useEffect(() => {
    notifications(profile, role)
      .then((list) => {
        setItems(list);
        void markNotificationsSeen(profile.id).catch(() => undefined);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setItems([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, role]);

  return (
    <main className="screen">
      <ScreenHead back title="Notifications" />
      {error && <p className="notice error">{error}</p>}
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        !error && <Empty title="Nothing yet">New followers, beaten times and request decisions show up here.</Empty>
      ) : (
        <div className="list">
          {items.map((n) => (
            <Link key={n.id} to={linkOf(n)} className={`list-item notif${n.at > seenAt ? ' unread' : ''}`}>
              {n.kind === 'decided' ? (
                <span className="notif-icon" aria-hidden="true">
                  <BadgeCheck size={22} />
                </span>
              ) : (
                <Avatar name={nameOf(n)} hue={n.kind === 'follow' ? n.avatarHue : n.kind === 'beaten' ? n.post.avatarHue : undefined} size={40} />
              )}
              <span className="grow">
                <Text n={n} />
                <span className="mute notif-time">{timeAgo(n.at ? new Date(n.at) : null)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function Text({ n }: { n: Notification }) {
  const role = n.kind === 'decided' || n.kind === 'request' ? (n.request === 'creator' ? 'a creator' : 'an admin') : '';
  switch (n.kind) {
    case 'follow':
      return (
        <span>
          <strong>{n.username}</strong> followed you
        </span>
      );
    case 'beaten':
      return (
        <span>
          <strong>{n.post.username}</strong> beat your {formatLap(n.myBestMs)} on <strong>{n.post.routeName}</strong> with{' '}
          {formatLap(n.post.totalMs)}
        </span>
      );
    case 'decided':
      return <span>Your request to become {role} was {n.approved ? 'approved' : 'turned down'}</span>;
    case 'request':
      return (
        <span>
          <strong>{n.username}</strong> asked to become {role}
        </span>
      );
  }
}

function nameOf(n: Notification): string {
  if (n.kind === 'beaten') return n.post.username;
  return n.kind === 'decided' ? '' : n.username;
}

function linkOf(n: Notification): string {
  if (n.kind === 'follow') return `/u/${n.username}`;
  if (n.kind === 'beaten') return `/lap/${n.post.id}`;
  if (n.kind === 'decided') return '/settings';
  return '/admin';
}
