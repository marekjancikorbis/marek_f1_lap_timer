import { Link } from 'react-router-dom';
import { formatLap, formatSeconds, timeAgo } from '../lib/format';
import type { Post, Route } from '../lib/types';
import { RouteShape } from './RouteShape';
import { Avatar, SectorStrip } from './ui';

interface Props {
  post: Post;
  route: Route | null | undefined;
  canCompare: boolean;
  showAuthor?: boolean;
}

export function LapCard({ post, route, canCompare, showAuthor = true }: Props) {
  const created = post.createdAt?.toDate() ?? null;
  return (
    <article className="lap-card">
      {showAuthor && (
        <header className="lap-card-head">
          <Link to={`/u/${post.username}`} className="row lap-card-who">
            <Avatar name={post.username} hue={post.avatarHue} size={36} />
            <span className="grow">
              <strong>{post.username}</strong>
              <span className="mute"> · {timeAgo(created)}</span>
            </span>
          </Link>
        </header>
      )}
      <Link to={`/r/${post.routeId}`} className="lap-card-route">
        {post.routeName}
      </Link>
      <Link to={`/lap/${post.id}`} className="lap-card-map" aria-label={`Lap detail, ${post.routeName}`}>
        {route ? (
          <RouteShape route={route} colours={post.sectorColours} height={168} label={`${post.routeName}, sectors coloured by this lap`} />
        ) : (
          <div className="skeleton" style={{ height: 168 }} />
        )}
      </Link>
      <div className="lap-card-time">
        <span className="num">{formatLap(post.totalMs)}</span>
        <span className="row wrap" style={{ gap: 6 }}>
          {post.positionAtPost != null && <span className={`badge ${post.positionAtPost === 1 ? 'purple' : ''}`}>P{post.positionAtPost}</span>}
          {post.isPB && <span className="badge ink">New PB</span>}
          {post.penaltyMs > 0 && <span className="badge red">+{formatSeconds(post.penaltyMs, 0)} jump start</span>}
        </span>
      </div>
      <SectorStrip colours={post.sectorColours} />
      {(post.caption || post.car) && (
        <p className="lap-card-caption">
          {post.caption}
          {post.car && <span className="mute">{post.caption ? ' · ' : ''}{post.car}</span>}
        </p>
      )}
      <div className="lap-card-actions">
        {canCompare && (
          <Link className="btn" to={`/compare/${post.routeId}?a=best&b=post:${post.id}`}>
            Compare with my best
          </Link>
        )}
        <Link className="btn primary" to={`/drive/${post.routeId}?ref=post:${post.id}`}>
          Race against
        </Link>
        <Link className="btn ghost" to={`/lap/${post.id}`}>
          Details
        </Link>
      </div>
    </article>
  );
}
