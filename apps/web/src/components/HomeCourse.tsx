import { Link } from 'react-router-dom';
import { formatLap } from '../lib/format';
import type { Route } from '../lib/types';

/** Your home course with your PB on a navy panel: the most common trip, one tap from pre-drive. */
export function HomeCourse({ route, pb }: { route: Route; pb: number | null }) {
  return (
    <Link to={`/drive/${route.id}`} className="home-course navy" aria-label={`Drive ${route.name}, your home course`}>
      <span className="livery thin" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="grow">
        <span className="cap">Home course</span>
        <strong className="home-course-name">{route.name}</strong>
        <span className="home-course-pb">
          {pb != null ? (
            <>
              <span className="num">{formatLap(pb)}</span>
              <span className="mute">your best</span>
            </>
          ) : (
            <span className="mute">Not driven yet</span>
          )}
        </span>
        <span className="btn primary home-course-go">Drive</span>
      </span>
    </Link>
  );
}
