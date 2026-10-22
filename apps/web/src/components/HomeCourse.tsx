import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatLap } from '../lib/format';
import type { Route } from '../lib/types';
import { RouteShape } from './RouteShape';

/** Your home course with your PB: the most common trip, one tap from pre-drive. */
export function HomeCourse({ route, pb }: { route: Route; pb: number | null }) {
  return (
    <Link to={`/drive/${route.id}`} className="home-course" aria-label={`Drive ${route.name}, your home course`}>
      <span className="grow">
        <span className="home-course-k">Your home course</span>
        <strong className="home-course-name">{route.name}</strong>
        <span className="home-course-pb">
          {pb != null ? (
            <>
              PB <span className="num">{formatLap(pb)}</span>
            </>
          ) : (
            'Not driven yet'
          )}
        </span>
        <span className="btn primary sm home-course-go">
          <Play size={16} fill="currentColor" aria-hidden="true" /> Drive
        </span>
      </span>
      <span className="home-course-shape" aria-hidden="true">
        <RouteShape route={route} height={96} ticks={false} />
      </span>
    </Link>
  );
}
