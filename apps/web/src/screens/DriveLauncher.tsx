import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeCourse } from '../components/HomeCourse';
import { RouteThumb } from '../components/RouteShape';
import { Empty, errorMessage, Loading, useToast } from '../components/ui';
import { getRoutes, myRoutes, routeStats, type RouteStats } from '../lib/data';
import { formatDistance } from '../lib/format';
import { useMe } from '../lib/session';
import type { Route } from '../lib/types';

/** The Drive tab: the routes you can drive right now, one tap from pre-drive. */
export default function DriveLauncher() {
  const { profile } = useMe();
  const toast = useToast();
  const [stats, setStats] = useState<RouteStats | null>(null);
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map());
  const [own, setOwn] = useState<Route[]>([]);

  useEffect(() => {
    (async () => {
      const [mine, built] = await Promise.all([routeStats(profile.id), myRoutes(profile.id)]);
      const ids = [...new Set([...Object.keys(mine), ...(profile.homeRouteId ? [profile.homeRouteId] : [])])];
      setRoutes(await getRoutes(ids));
      setOwn(built.filter((r) => !r.hidden));
      setStats(mine);
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setStats({});
    });
  }, [profile.id, profile.homeRouteId, toast]);

  const recent = useMemo(() => new Map(Object.entries(stats ?? {})), [stats]);

  if (stats === null) return <Loading />;

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
        <span className="launch-shape" aria-hidden="true">
          <RouteThumb route={r} />
        </span>
        <span className="grow">
          <strong className="ellipsis">{r.name}</strong>
          <span className="mute ellipsis small-text">
            {r.isPublic ? 'Public' : 'Private'} ·{' '}
            {stats ? `last driven ${new Date(stats.last).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : `${formatDistance(r.lengthM)} · not driven yet`}
          </span>
        </span>
        <ChevronRight size={22} aria-hidden="true" />
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

      {builtRoutes.length > 0 && (
        <>
          <h2 className="section-title">Your routes</h2>
          <div className="list">{builtRoutes.map(row)}</div>
        </>
      )}

      {!home && recentRoutes.length === 0 && builtRoutes.length === 0 ? (
        <Empty title="No routes yet" action={<Link to="/explore" className="btn primary lg">Find a route on the map</Link>}>
          Pick a public route on the map and drive it. After that it's one tap from here.
        </Empty>
      ) : (
        <Link to="/explore" className="btn block" style={{ marginTop: 14 }}>
          <Search size={18} aria-hidden="true" /> Find a route on the map
        </Link>
      )}
    </main>
  );
}
