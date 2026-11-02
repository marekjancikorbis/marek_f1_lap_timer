import { Link } from 'react-router-dom';
import { formatLap, formatSeconds, timeAgo } from '../lib/format';
import { postBigColours } from '../lib/laps';
import type { Post, Route } from '../lib/types';
import { Avatar, SectorStrip } from './ui';

interface Props {
  post: Post;
  route: Route | null | undefined;
  /** Kept for callers; comparing lives on the lap's own page. */
  canCompare?: boolean;
  showAuthor?: boolean;
}

/** A posted lap: who, the time first, the lap's sector stripe, and one action to race it. */
export function LapCard({ post, route, showAuthor = true }: Props) {
  const created = post.createdAt?.toDate() ?? null;
  const colours = postBigColours(post, route);
  const p1 = post.positionAtPost === 1;
  const chip = p1 ? <span className="badge purple">Record</span> : post.isPB ? <span className="badge green">New PB</span> : null;

  // On a driver's own profile: a row with the route, when and where it placed, and the time on the right.
  if (!showAuthor)
    return (
      <Link to={`/lap/${post.id}`} className="list-item lap-row" aria-label={`${post.routeName}, ${formatLap(post.totalMs)}, lap details`}>
        <span className="grow">
          <strong className="ellipsis">{post.routeName}</strong>
          <span className="mute small-text">
            Posted {timeAgo(created)}
            {post.positionAtPost != null && ` · P${post.positionAtPost}`}
            {post.penaltyMs > 0 && ` · +${formatSeconds(post.penaltyMs, 0)}`}
          </span>
          {colours.length > 0 && (
            <span className="lap-row-stripe">
              <SectorStrip colours={colours} />
            </span>
          )}
        </span>
        <strong className={`num lap-row-time ${p1 ? 'fastest' : ''}`}>{formatLap(post.totalMs)}</strong>
      </Link>
    );

  return (
    <article className="lap-card">
      <Link to={`/u/${post.username}`} aria-label={post.username}>
        <Avatar name={post.username} hue={post.avatarHue} size={44} uid={post.userId} />
      </Link>
      <Link to={`/lap/${post.id}`} className="lap-card-main" aria-label={`${post.routeName}, ${formatLap(post.totalMs)}, lap details`}>
        <span className="lap-card-meta ellipsis">
          {post.username} · {post.routeName} · {timeAgo(created)}
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className={`lap-card-time num ${p1 ? 'fastest' : ''}`}>{formatLap(post.totalMs)}</span>
          {chip}
          {post.penaltyMs > 0 && <span className="badge red">+{formatSeconds(post.penaltyMs, 0)}</span>}
        </span>
        {colours.length > 0 && (
          <span className="lap-card-stripe">
            <SectorStrip colours={colours} />
          </span>
        )}
      </Link>
      <Link className="btn sm" to={`/drive/${post.routeId}?ref=post:${post.id}`}>
        Race
      </Link>
    </article>
  );
}
