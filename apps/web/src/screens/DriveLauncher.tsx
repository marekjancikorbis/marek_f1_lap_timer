import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, errorMessage, I, Loading, useToast } from '../components/ui';
import { getRoutes, myRoutes, routeStats, type RouteStats } from '../lib/data';
import { formatDistance, formatLap } from '../lib/format';
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

  // The big card: the home course, else the route driven last.
  const lead = home && drivable(home) ? home : recentRoutes[0];
  const others = [...recentRoutes.filter((r) => r.id !== lead?.id), ...builtRoutes];
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <main className="ph soft docked">
      <div className="sb" />
      <div style={{ padding: '8px 20px 0' }}>
        <h1 className="title">Where to?</h1>
      </div>
      {lead ? (
        <div style={{ padding: '18px 16px 0' }}>
          <div className="glass lift" style={{ borderRadius: 28, padding: '22px 20px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }} className="lbl">
              <span className="ellipsis">{lead.name}</span>
              <span style={{ flex: 'none' }}>{lead.id === home?.id ? 'Home course' : 'Last driven'}</span>
            </div>
            <div className="t" style={{ fontSize: 56, marginTop: 10 }}>
              {recent.get(lead.id)?.pb != null ? formatLap(recent.get(lead.id)!.pb) : formatDistance(lead.lengthM)}
            </div>
            <Link className="solid" style={{ marginTop: 18 }} to={`/drive/${lead.id}`}>
              Drive
            </Link>
          </div>
        </div>
      ) : (
        <Empty title="No routes yet" action={<Link to="/explore" className="solid">Find a route on the map</Link>}>
          Pick a public route on the map and drive it. After that it&rsquo;s one tap from here.
        </Empty>
      )}
      <div className="rows" style={{ padding: '16px 24px 0' }}>
        {others.map((r) => {
          const st = recent.get(r.id);
          return (
            <Link key={r.id} to={`/drive/${r.id}`} style={{ gridTemplateColumns: '1fr auto' }}>
              <div style={{ minWidth: 0 }}>
                <b className="ellipsis" style={{ display: 'block' }}>{r.name}</b>
                <div className="lbl">{st ? day(st.last) : `${formatDistance(r.lengthM)} · not driven yet`}</div>
              </div>
              <I n="fwd" style={{ color: 'var(--ink-2)' }} />
            </Link>
          );
        })}
        {lead && (
          <Link to="/explore" style={{ gridTemplateColumns: '1fr auto' }}>
            <div>
              <b>Find a route</b>
              <div className="lbl">On the map</div>
            </div>
            <I n="search" style={{ color: 'var(--ink-2)' }} />
          </Link>
        )}
      </div>
    </main>
  );
}
