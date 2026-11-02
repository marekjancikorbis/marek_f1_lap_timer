import { Shield } from 'lucide-react';
import { FollowButton } from '../components/FollowButton';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';
import { Avatar, Empty, errorMessage, ScreenHead, UserName } from '../components/ui';
import { listNotices, markNoticesSeen } from '../lib/data';
import { formatDelta, formatLap, timeAgo } from '../lib/format';
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
            {who} beat your time on <strong>{n.routeName}</strong>
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
        <>
          {(['New', 'Earlier'] as const).map((group) => {
            const isNew = (n: Notice) => !data.seenAt || (n.createdAt != null && n.createdAt.toMillis() > data.seenAt.toMillis());
            const list = data.notices.filter((n) => isNew(n) === (group === 'New'));
            if (!list.length) return null;
            return (
              <section key={group}>
                <h2 className="section-title">{group}</h2>
                <div className="list">
                  {list.map((n) => {
                    const { text, to } = describe(n);
                    const main = (
                      <span className="grow notice-text">
                        <span>{text}</span>
                        {n.type === 'beaten' ? (
                          <span className="row" style={{ gap: 10, marginTop: 6 }}>
                            <strong className="num">{formatLap(n.totalMs)}</strong>
                            <strong className="num fastest small-text">{formatDelta(n.totalMs - n.theirMs, 2)}</strong>
                            <span className="mute small-text">· {timeAgo(n.createdAt?.toDate())}</span>
                          </span>
                        ) : (
                          <span className="mute small-text">{timeAgo(n.createdAt?.toDate())}</span>
                        )}
                      </span>
                    );
                    return (
                      <div key={n.id} className={`list-item${group === 'New' ? ' unread' : ''}`} style={n.type === 'beaten' ? { alignItems: 'flex-start' } : undefined}>
                        {n.type === 'follow' || n.type === 'beaten' ? (
                          <Link to={`/u/${n.fromName}`} aria-label={n.fromName}>
                            <Avatar name={n.fromName} size={44} uid={n.fromId} />
                          </Link>
                        ) : (
                          <span className="mod-roundel" aria-hidden>
                            <Shield size={20} />
                          </span>
                        )}
                        {to ? (
                          <Link to={to} className="grow notice-link">
                            {main}
                          </Link>
                        ) : (
                          main
                        )}
                        {n.type === 'beaten' && (
                          <Link className="btn primary sm" to={`/drive/${n.routeId}?ref=post:${n.postId}`}>
                            Race
                          </Link>
                        )}
                        {n.type === 'follow' && <FollowButton userId={n.fromId} back />}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
