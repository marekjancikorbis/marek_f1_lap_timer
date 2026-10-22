import { BarChart3, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatLap, formatSeconds, timeAgo } from '../lib/format';
import { bigRoute, postBigColours } from '../lib/laps';
import type { Post, Route } from '../lib/types';
import { RouteShape } from './RouteShape';
import { Avatar, SectorStrip } from './ui';

interface Props {
  post: Post;
  route: Route | null | undefined;
  canCompare: boolean;
  showAuthor?: boolean;
}

/** A posted lap in the feed: the time first, the route shape beside it, one action to race it. */
export function LapCard({ post, route, canCompare, showAuthor = true }: Props) {
  const created = post.createdAt?.toDate() ?? null;
  const colours = postBigColours(post, route);
  const p1 = post.positionAtPost === 1;
  return (
    <article className="lap-card">
      {showAuthor && (
        <Link to={`/u/${post.username}`} className="row lap-card-who">
          <Avatar name={post.username} hue={post.avatarHue} size={34} />
          <span className="grow">
            <strong>{post.username}</strong>
            <span className="mute"> · {timeAgo(created)}</span>
          </span>
        </Link>
      )}
      <Link to={`/lap/${post.id}`} className="lap-card-body" aria-label={`${post.routeName}, ${formatLap(post.totalMs)}, lap details`}>
        <span className="lap-card-main">
          <span className="lap-card-route">{post.routeName}</span>
          <span className={`lap-card-time num ${p1 ? 'fastest' : ''}`}>{formatLap(post.totalMs)}</span>
          <span className="row wrap" style={{ gap: 6 }}>
            {post.positionAtPost != null && <span className={`badge ${p1 ? 'purple' : ''}`}>P{post.positionAtPost}</span>}
            {post.isPB && <span className="badge ink">New PB</span>}
            {post.penaltyMs > 0 && <span className="badge red">+{formatSeconds(post.penaltyMs, 0)} jump start</span>}
          </span>
        </span>
        <span className="lap-card-shape">
          {route ? (
            <RouteShape route={bigRoute(route)} colours={colours} height={120} label={`${post.routeName}, sectors coloured by this lap`} />
          ) : (
            <span className="skeleton" style={{ display: 'block', height: 96 }} />
          )}
        </span>
      </Link>
      {colours.length > 0 && <SectorStrip colours={colours} height={6} />}
      {(post.caption || post.car) && (
        <p className="lap-card-caption">
          {post.caption}
          {post.car && <span className="mute">{post.caption ? ' · ' : ''}{post.car}</span>}
        </p>
      )}
      <div className="lap-card-actions">
        <Link className="btn primary grow" to={`/drive/${post.routeId}?ref=post:${post.id}`}>
          <Flag size={17} aria-hidden="true" /> Race this lap
        </Link>
        {canCompare && (
          <Link className="btn grow" to={`/compare/${post.routeId}?a=best&b=post:${post.id}`}>
            <BarChart3 size={17} aria-hidden="true" /> Compare
          </Link>
        )}
      </div>
    </article>
  );
}
