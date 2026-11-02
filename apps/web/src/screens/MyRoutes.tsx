import { Globe, Lock, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RouteShape } from '../components/RouteShape';
import { Empty, errorMessage, Loading, ScreenHead, Segmented, Sheet, useToast } from '../components/ui';
import { getMyRequest, getRoutes, myRoutes, publicLimit, requestCreatorAccess, routeStats, setRoutePublic, type RouteStats } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { CreatorRequest, Route } from '../lib/types';

/** Routes: every lap you've driven, by route, and the routes you've built. */
export default function MyRoutes() {
  const { profile, role, isCreator } = useMe();
  const toast = useToast();
  const [own, setOwn] = useState<Route[] | null>(null);
  const [driven, setDriven] = useState<Route[]>([]);
  const [stats, setStats] = useState<RouteStats>({});
  const [request, setRequest] = useState<CreatorRequest | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'laps' | 'built'>('built');

  const load = useCallback(async () => {
    try {
      const [mine, myStats] = await Promise.all([myRoutes(profile.id), routeStats(profile.id)]);
      setOwn(mine);
      setStats(myStats);
      const ownIds = new Set(mine.map((r) => r.id));
      const others = Object.keys(myStats).filter((id) => !ownIds.has(id));
      setDriven([...(await getRoutes(others)).values()]);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setOwn([]);
    }
  }, [profile.id, toast]);

  useEffect(() => {
    void load();
    if (!isCreator) getMyRequest(profile.id).then(setRequest).catch(() => setRequest(null));
  }, [load, isCreator, profile.id]);

  const pbs = useMemo(
    () => new Map(Object.entries(stats).flatMap(([id, s]) => (s.pb == null ? [] : [[id, s.pb] as const]))),
    [stats],
  );

  // One row per route you've driven, most recent first.
  const logbook = useMemo(() => {
    const routes = new Map([...(own ?? []), ...driven].map((r) => [r.id, r]));
    return Object.entries(stats)
      .flatMap(([id, s]) => {
        const route = routes.get(id);
        return route ? [{ route, laps: s.laps, last: s.last, posted: s.posted }] : [];
      })
      .sort((a, b) => b.last - a.last);
  }, [own, driven, stats]);
  const total = Object.values(stats).reduce((t, s) => ({ laps: t.laps + s.laps, posted: t.posted + s.posted }), { laps: 0, posted: 0 });

  async function setPublic(route: Route, makePublic: boolean) {
    setBusy(true);
    try {
      await setRoutePublic(profile, role, own ?? [], route, makePublic);
      // A creator's one public route is swapped; with more allowed, the others stay.
      setOwn((rs) =>
        rs?.map((r) =>
          r.id === route.id ? { ...r, isPublic: makePublic } : makePublic && limit === 1 && r.isPublic ? { ...r, isPublic: false } : r,
        ) ?? null,
      );
      toast(makePublic ? `${route.name} is public` : `${route.name} is private`);
      setConfirm(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const limit = publicLimit(role);
  const publicCount = own?.filter((r) => r.isPublic).length ?? 0;
  // Only a creator (one public route) gets the replace prompt; admins see their count instead.
  const currentPublic = limit === 1 ? own?.find((r) => r.isPublic) : undefined;

  if (own === null) return <Loading />;

  return (
    <main className="screen">
      <ScreenHead
        title="Routes"
        right={
          <Link to="/routes/new" className="btn primary sm">
            <Plus size={18} aria-hidden="true" /> Build
          </Link>
        }
      />
      <Segmented
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'built', label: 'Routes I built' },
          { value: 'laps', label: 'My laps' },
        ]}
      />

      {tab === 'laps' ? (
        logbook.length === 0 ? (
          <Empty title="No laps yet" action={<Link to="/drive" className="btn primary lg">Start a drive</Link>}>
            Every lap you drive is saved here, grouped by route, with your best time.
          </Empty>
        ) : (
          <>
            <p className="statline">
              <span>
                <strong className="num">{total.laps}</strong> {total.laps === 1 ? 'lap' : 'laps'}
              </span>
              <span>
                <strong className="num">{logbook.length}</strong> {logbook.length === 1 ? 'route' : 'routes'}
              </span>
              <span>
                <strong className="num">{total.posted}</strong> posted
              </span>
            </p>
            <div className="list">
              {logbook.map(({ route: r, laps, last, posted }) => (
                <Link key={r.id} to={`/r/${r.id}/history`} className="list-item logbook-row">
                  <span className="logbook-shape" aria-hidden="true">
                    <RouteShape route={r} height={48} ticks={false} />
                  </span>
                  <span className="grow">
                    <strong className="ellipsis">{r.name}</strong>
                    <span className="mute ellipsis small-text">
                      {laps} {laps === 1 ? 'lap' : 'laps'} · last {formatDate(last)}
                      {posted > 0 && ` · ${posted} posted`}
                    </span>
                  </span>
                  <span className="logbook-pb">
                    <strong className="num">{pbs.has(r.id) ? formatLap(pbs.get(r.id)) : '—'}</strong>
                    <span className="mute small-text">{pbs.has(r.id) ? 'PB' : 'no valid lap'}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )
      ) : (
        <div style={{ marginTop: 16 }}>
          {own.length === 0 ? (
            <Empty title="No routes yet" action={<Link to="/routes/new" className="btn primary lg">Build a route</Link>}>
              Draw a route on the map, split it into sectors, then drive it.
            </Empty>
          ) : (
            <div className="stack">
              {limit > 1 && (
                <p className="mute" style={{ fontSize: 14 }}>
                  {limit === Infinity ? `${publicCount} public · no limit` : `${publicCount} of ${limit} public routes`}
                </p>
              )}
              {own.map((r) => (
                <article key={r.id} className="panel route-card">
                  <Link to={`/r/${r.id}`} className="route-card-shape" aria-label={r.name}>
                    <RouteShape route={r} height={64} ticks={false} />
                  </Link>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/r/${r.id}`} className="route-card-name ellipsis">
                      {r.name}
                    </Link>
                    <span className="mute small-text">
                      {formatDistance(r.lengthM)} · {r.isLoop ? 'lap' : 'point to point'} · {r.startType === 'standing' ? 'standing' : 'rolling'}
                      {pbs.has(r.id) && ` · PB ${formatLap(pbs.get(r.id))}`}
                    </span>
                    <span className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                      {r.isPublic ? (
                        <span className="badge ink">
                          <Globe size={12} aria-hidden="true" /> Public
                        </span>
                      ) : (
                        <span className="badge outline">
                          <Lock size={12} aria-hidden="true" /> Private
                        </span>
                      )}
                      {r.hidden && <span className="badge red">Hidden by an admin</span>}
                      {isCreator &&
                        !r.hidden &&
                        (r.isPublic ? (
                          <button className="btn sm chip-btn" disabled={busy} onClick={() => void setPublic(r, false)}>
                            Make private
                          </button>
                        ) : (
                          <button className="btn sm chip-btn" disabled={busy || (limit > 1 && publicCount >= limit)} onClick={() => setConfirm(r)}>
                            Publish
                          </button>
                        ))}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!isCreator && (
            <div style={{ marginTop: 16 }}>
              <DriverPanel request={request} onRequested={setRequest} />
            </div>
          )}
        </div>
      )}

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} label="Make route public">
        {confirm && (
          <div className="stack">
            <h2>Make “{confirm.name}” public?</h2>
            {currentPublic && currentPublic.id !== confirm.id && (
              <p className="notice warn">
                You can have one public route. “{currentPublic.name}” will become private, and its leaderboard will no longer be shown.
              </p>
            )}
            <p>Everyone will see it on the map and can drive it and post laps to its leaderboard.</p>
            <p className="notice info">The start and end points become visible to everyone. Don't publish a route that starts at your home.</p>
            <p className="mute" style={{ fontSize: 14 }}>
              Once published, the route's shape and sectors can't be edited, so times stay comparable.
            </p>
            <button className="btn primary lg block" disabled={busy} onClick={() => setPublic(confirm, true)}>
              {currentPublic && currentPublic.id !== confirm.id ? 'Replace and publish' : 'Publish'}
            </button>
            <button className="btn block" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        )}
      </Sheet>
    </main>
  );
}

function DriverPanel({ request, onRequested }: { request: CreatorRequest | null | undefined; onRequested: (r: CreatorRequest) => void }) {
  const { profile } = useMe();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await requestCreatorAccess(profile.id, profile.username, note);
      onRequested({ id: profile.id, username: profile.username, note, status: 'pending', createdAt: null });
      setOpen(false);
      toast('Request sent');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel navy stack request-card">
      <span className="livery thin" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <h3>Want to publish a route?</h3>
      <p className="mute">Publishing, with a leaderboard, is for approved creators. Ask the admin and say which track or event you want to time.</p>
      <div>
        {request?.status === 'pending' ? (
          <button className="btn sm" disabled>
            Request pending
          </button>
        ) : (
          <button className="btn primary sm" onClick={() => setOpen(true)} disabled={request === undefined}>
            Request creator access
          </button>
        )}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} label="Request creator access">
        <div className="stack">
          <h2>Request creator access</h2>
          <label className="field">
            <span>Note for the admin (optional)</span>
            <textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I run our club's rally sprint stages" />
          </label>
          <button className="btn primary lg block" disabled={busy} onClick={send}>
            Send request
          </button>
        </div>
      </Sheet>
    </div>
  );
}
