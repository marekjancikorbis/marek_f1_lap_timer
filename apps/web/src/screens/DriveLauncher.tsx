import { Map as MapIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeCourse } from '../components/HomeCourse';
import { RouteShape } from '../components/RouteShape';
import { Empty, errorMessage, Loading, useToast } from '../components/ui';
import { allMyRuns, getRoutes, myRoutes } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { Route, Run } from '../lib/types';

/** The Drive tab: the routes you can drive right now, one tap from pre-drive. */
export default function DriveLauncher() {
  const { profile, isCreator } = useMe();
  const toast = useToast();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map());
  const [own, setOwn] = useState<Route[]>([]);

  useEffect(() => {
    (async () => {
      const [mine, built] = await Promise.all([allMyRuns(profile.id), isCreator ? myRoutes(profile.id) : Promise.resolve([])]);
      const ids = [...new Set([...mine.map((r) => r.routeId), ...(profile.homeRouteId ? [profile.homeRouteId] : [])])];
      setRoutes(await getRoutes(ids));
      setOwn(built.filter((r) => !r.hidden));
      setRuns(mine);
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setRuns([]);
    });
  }, [profile.id, profile.homeRouteId, isCreator, toast]);

  const recent = useMemo(() => {
    const by = new Map<string, { last: number; laps: number; pb: number | null }>();
    for (const r of runs ?? []) {
      const row = by.get(r.routeId) ?? { last: 0, laps: 0, pb: null };
      row.last = Math.max(row.last, r.startedAt);
      row.laps += 1;
      if (r.valid) row.pb = Math.min(row.pb ?? Infinity, r.totalMs);
      by.set(r.routeId, row);
    }
    return by;
  }, [runs]);

  if (runs === null) return <Loading />;

  const home = profile.homeRouteId ? routes.get(profile.homeRouteId) : undefined;
  const drivable = (r: Route | undefined): r is Route => !!r && !r.hidden && (r.isPublic || r.ownerId === profile.id);
  const recentRoutes = [...recent.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .map(([id]) => routes.get(id))
    .filter(drivable)
    .filter((r) => r.id !== home?.id)
    .slice(0, 6);
  const shownIds = new Set([home?.id, ...recentRoutes.map((r) => r.id)]);
  const builtRoutes = own.filter((r) => !shownIds.has(r.id));

  const row = (r: Route) => {
    const stats = recent.get(r.id);
    return (
      <Link key={r.id} to={`/drive/${r.id}`} className="list-item">
        <span className="logbook-shape" aria-hidden="true">
          <RouteShape route={r} height={44} ticks={false} />
        </span>
        <span className="grow">
          <strong className="ellipsis">{r.name}</strong>
          <span className="mute ellipsis small-text">
            {stats ? `${formatDate(stats.last)} · ${stats.laps} ${stats.laps === 1 ? 'lap' : 'laps'}` : `${r.isPublic ? 'Public' : 'Private'} · ${formatDistance(r.lengthM)} · not driven yet`}
          </span>
        </span>
        <strong className="num logbook-time">{stats?.pb != null ? formatLap(stats.pb) : '—'}</strong>
      </Link>
    );
  };

  return (
    <main className="screen">
      <header className="screen-head">
        <h1>Where are you driving?</h1>
      </header>

      {home && drivable(home) && (
        <HomeCourse route={home} pb={recent.get(home.id)?.pb ?? null} />
      )}

      {recentRoutes.length > 0 && (
        <>
          <h2 className="section-title">Recently driven</h2>
          <div className="list">{recentRoutes.map(row)}</div>
        </>
      )}

      {isCreator && (
        <>
          <h2 className="section-title row between">
            Your routes
            <Link to="/routes/new" className="section-link">
              New route
            </Link>
          </h2>
          {builtRoutes.length > 0 ? <div className="list">{builtRoutes.map(row)}</div> : <p className="mute">Routes you build show up here.</p>}
        </>
      )}

      {!home && recentRoutes.length === 0 && builtRoutes.length === 0 ? (
        <Empty title="No routes yet" action={<Link to="/explore" className="btn primary lg">Find a route on the map</Link>}>
          Pick a public route on the map and drive it. After that it's one tap from here.
        </Empty>
      ) : (
        <Link to="/explore" className="btn block" style={{ marginTop: 16 }}>
          <MapIcon size={18} aria-hidden="true" /> Find a route on the map
        </Link>
      )}
    </main>
  );
}
