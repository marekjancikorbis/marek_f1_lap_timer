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
            {who} beat your time on {n.routeName}
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

  const ago = (n: Notice) => timeAgo(n.createdAt?.toDate()).replace(' ago', '');
  const isNew = (n: Notice) => !!data && (!data.seenAt || (n.createdAt != null && n.createdAt.toMillis() > data.seenAt.toMillis()));
  const beaten = data?.notices.filter((n) => n.type === 'beaten' && isNew(n)) ?? [];
  const rest = data?.notices.filter((n) => !beaten.includes(n)) ?? [];
  return (
    <main className="ph soft docked">
      <div className="sb" />
      <div style={{ padding: '8px 20px 0' }}>
        <h1 className="title">Notifications</h1>
      </div>
      {error && <p className="err" style={{ padding: '12px 24px 0' }}>{error}</p>}
      {data === null ? (
        <div style={{ padding: '16px 24px 0' }}>
          <SkeletonRows />
        </div>
      ) : data.notices.length === 0 ? (
        <Empty title="Nothing yet">New followers, laps that beat yours and news from the moderators show up here.</Empty>
      ) : (
        <>
          {beaten.length > 0 && (
            <div style={{ padding: '16px 16px 0', display: 'grid', gap: 10 }}>
              {beaten.map((n) => {
                if (n.type !== 'beaten') return null;
                const { text, to } = describe(n);
                return (
                  <div key={n.id} className="glass lift" style={{ borderRadius: 28, padding: '16px 18px', display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12, alignItems: 'center' }}>
                    <Link to={`/u/${n.fromName}`} aria-label={n.fromName}>
                      <Avatar name={n.fromName} size={40} uid={n.fromId} />
                    </Link>
                    <Link to={to ?? `/u/${n.fromName}`} style={{ minWidth: 0 }}>
                      <div className="lbl">{text}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 3 }}>
                        <span className="t" style={{ fontSize: 22 }}>{formatLap(n.totalMs)}</span>
                        <span className="t acc" style={{ fontSize: 15 }}>{formatDelta(n.totalMs - n.theirMs, 2)}</span>
                      </div>
                    </Link>
                    <Link className="chip" style={{ background: 'var(--main)', color: 'var(--on-main)' }} to={`/drive/${n.routeId}?ref=post:${n.postId}`}>
                      Race
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
          <div className="rows" style={{ padding: '8px 24px 0' }}>
            {rest.map((n) => {
              const { text, to } = describe(n);
              const pic =
                n.type === 'follow' || n.type === 'beaten' ? (
                  <Link to={`/u/${n.fromName}`} aria-label={n.fromName}>
                    <Avatar name={n.fromName} uid={n.fromId} />
                  </Link>
                ) : (
                  <span className="av" style={{ background: 'var(--main)', color: 'var(--on-main)' }} aria-hidden>
                    ✓
                  </span>
                );
              const body = (
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{text}</b>
                  <div className="lbl">
                    {n.type === 'beaten' && `${formatLap(n.totalMs)} · `}
                    {isNew(n) ? 'New · ' : ''}
                    {ago(n)}
                  </div>
                </div>
              );
              return (
                <div key={n.id} style={n.type === 'follow' || n.type === 'beaten' ? undefined : { gridTemplateColumns: '36px 1fr' }}>
                  {pic}
                  {to ? (
                    <Link to={to} style={{ minWidth: 0 }}>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                  {n.type === 'follow' && <FollowButton userId={n.fromId} back />}
                  {n.type === 'beaten' && (
                    <Link className="chip" style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }} to={`/drive/${n.routeId}?ref=post:${n.postId}`}>
                      Race
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
