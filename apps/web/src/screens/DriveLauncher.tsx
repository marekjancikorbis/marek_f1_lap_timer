import { useEffect, useMemo, useState } from 'react';
import { RouteGlyph } from '../components/RouteShape';
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
        <div className="k">Drive</div>
        <h1 className="h1" style={{ marginTop: 6 }}>Where to?</h1>
      </div>
      {lead ? (
        <div style={{ padding: '18px 16px 0' }}>
          <div className="glass hot card" style={{ borderRadius: 28, padding: 20 }}>
            <div className="between">
              <span className="k">{lead.id === home?.id ? 'Home course' : 'Last driven'}</span>
              <span className="k">{formatDistance(lead.lengthM)}</span>
            </div>
            <div className="h2 ellipsis" style={{ marginTop: 8, fontSize: 22 }}>{lead.name}</div>
            <div className="between" style={{ marginTop: 12, alignItems: 'center' }}>
              <span className="t t2">{recent.get(lead.id)?.pb != null ? formatLap(recent.get(lead.id)!.pb) : 'Not driven'}</span>
              <RouteGlyph route={lead} strokeWidth={56} style={{ width: 76, height: 52, flex: 'none' }} />
            </div>
            <Link className="solid inv" style={{ marginTop: 18 }} to={`/drive/${lead.id}`}>
              <I n="flag" sm />
              Drive
            </Link>
          </div>
        </div>
      ) : (
        <Empty title="No routes yet" action={<Link to="/explore" className="solid">Find a route on the map</Link>}>
          Pick a public route on the map and drive it. After that it&rsquo;s one tap from here.
        </Empty>
      )}
      {(others.length > 0 || lead) && <div className="k" style={{ padding: '22px 24px 0' }}>Recent</div>}
      <div className="rows" style={{ padding: '2px 24px 0' }}>
        {others.map((r) => {
          const st = recent.get(r.id);
          return (
            <Link key={r.id} to={`/drive/${r.id}`} style={{ gridTemplateColumns: '60px 1fr auto' }}>
              <RouteGlyph route={r} strokeWidth={56} style={{ width: 60, height: 42 }} />
              <div style={{ minWidth: 0 }}>
                <div className="h2 ellipsis">{r.name}</div>
                <div className="sub">{st ? `${day(st.last)}${st.pb != null ? ` · best ${formatLap(st.pb)}` : ''}` : `${formatDistance(r.lengthM)} · not driven yet`}</div>
              </div>
              <I n="fwd" style={{ color: 'var(--ink-2)' }} />
            </Link>
          );
        })}
        {lead && (
          <Link to="/explore" style={{ gridTemplateColumns: '60px 1fr auto' }}>
            <span />
            <div>
              <div className="h2">Find a route</div>
              <div className="sub">On the map</div>
            </div>
            <I n="search" style={{ color: 'var(--ink-2)' }} />
          </Link>
        )}
      </div>
    </main>
  );
}
