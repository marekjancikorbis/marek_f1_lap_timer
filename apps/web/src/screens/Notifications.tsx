import { ShieldAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';
import { Avatar, Empty, errorMessage, ScreenHead, UserName } from '../components/ui';
import { listNotices, markNoticesSeen } from '../lib/data';
import { formatLap, timeAgo } from '../lib/format';
import { useMe } from '../lib/session';
import type { Notice } from '../lib/types';

const ACCESS: Record<string, string> = {
  approve_request: 'Your creator access request was approved. You can build routes now.',
  reject_request: 'Your creator access request was declined.',
  grant_creator: "You're now a creator. You can build routes.",
  revoke_creator: 'Your creator access was removed.',
  approve_admin_request: 'Your admin request was approved.',
  reject_admin_request: 'Your admin request was declined.',
  grant_admin: "You're now an admin.",
  revoke_admin: 'Your admin access was removed.',
};

/** What a notification says and where tapping it goes. */
function describe(n: Notice): { text: ReactNode; to?: string } {
  const who = (
    <strong>
      <UserName uid={n.fromId} fallback={n.fromName} />
    </strong>
  );
  switch (n.type) {
    case 'follow':
      return { text: <>{who} started following you</>, to: `/u/${n.fromName}` };
    case 'beaten':
      return {
        text: (
          <>
            {who} beat your {formatLap(n.theirMs)} on <strong>{n.routeName}</strong> with {formatLap(n.totalMs)}
          </>
        ),
        to: `/lap/${n.postId}`,
      };
    case 'access':
      return { text: ACCESS[n.action] ?? 'Your access changed.', to: '/settings' };
    case 'postRemoved':
      return { text: <>A moderator removed your {formatLap(n.totalMs)} lap on <strong>{n.routeName}</strong></> };
    case 'route':
      return {
        text: <>A moderator {n.action} your route <strong>{n.routeName}</strong></>,
        to: n.action === 'deleted' ? undefined : `/r/${n.routeId}`,
      };
  }
}

export default function Notifications() {
  const { profile } = useMe();
  const [data, setData] = useState<Awaited<ReturnType<typeof listNotices>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listNotices(profile.id)
      .then((d) => {
        setData(d);
        void markNoticesSeen(profile.id).catch(() => undefined);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setData({ notices: [], seenAt: null });
      });
  }, [profile.id]);

  return (
    <main className="screen">
      <ScreenHead back title="Notifications" />
      {error && <p className="notice error">{error}</p>}
      {data === null ? (
        <SkeletonRows />
      ) : data.notices.length === 0 ? (
        <Empty title="Nothing yet">New followers, laps that beat yours and news from the moderators show up here.</Empty>
      ) : (
        <div className="list">
          {data.notices.map((n) => {
            const { text, to } = describe(n);
            const unread = !data.seenAt || (n.createdAt != null && n.createdAt.toMillis() > data.seenAt.toMillis());
            const body = (
              <>
                {n.type === 'follow' || n.type === 'beaten' ? (
                  <Avatar name={n.fromName} size={40} uid={n.fromId} />
                ) : (
                  <span className="icon-btn" aria-hidden>
                    <ShieldAlert size={22} />
                  </span>
                )}
                <span className="grow notice-text">
                  {text}
                  <br />
                  <span className="mute" style={{ fontSize: 13 }}>
                    {timeAgo(n.createdAt?.toDate())}
                  </span>
                </span>
              </>
            );
            const cls = `list-item${unread ? ' unread' : ''}`;
            return to ? (
              <Link key={n.id} to={to} className={cls}>
                {body}
              </Link>
            ) : (
              <div key={n.id} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
