import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RouteGlyph } from '../components/RouteShape';
import { Empty, errorMessage, I, Loading, Segmented, Sheet, useToast } from '../components/ui';
import { getMyRequest, getRoutes, myRoutes, publicLimit, publicRoutes, requestCreatorAccess, routeStats, setRoutePublic, type RouteStats } from '../lib/data';
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
  const [official, setOfficial] = useState<Route[]>([]);
  // Times first: your best on each route is what you come back for; building routes is occasional.
  const [tab, setTab] = useState<'laps' | 'built'>('laps');

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
    publicRoutes()
      .then((rs) => setOfficial(rs.filter((r) => r.official && !r.hidden)))
      .catch(() => undefined);
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

  const routeCard = (r: Route, chip: ReactNode) => (
    <div key={r.id} className="glass lift" style={{ borderRadius: 28, padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
      <Link to={`/r/${r.id}`} style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <RouteGlyph route={r} style={{ width: 64, height: 44, flex: 'none', color: '#fff' }} strokeWidth={56} />
        <div style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: 'block' }}>{r.name}</b>
          <div className="lbl">
            {formatDistance(r.lengthM)} · {r.isLoop ? 'lap' : r.startType}
            {r.hidden && ' · hidden by an admin'}
          </div>
        </div>
      </Link>
      {chip}
    </div>
  );
  const quiet = { background: 'color-mix(in srgb, var(--ink) 10%, transparent)' };
  const solidChip = { background: 'var(--main)', color: 'var(--on-main)' };

  return (
    <main className="ph soft docked">
      <div className="sb" />
      <div style={{ padding: '8px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 56 }}>
        <h1 className="title">Times</h1>
        {tab === 'built' && (
          <Link to="/routes/new" className="glass ib" aria-label="Build a route">
            <I n="plus" />
          </Link>
        )}
      </div>
      <div style={{ padding: '14px 16px 0' }}>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'laps', label: 'Times' },
            { value: 'built', label: 'My routes' },
          ]}
        />
      </div>

      {tab === 'laps' ? (
        logbook.length === 0 ? (
          <Empty title="No laps yet" action={<Link to="/drive" className="solid">Start a drive</Link>}>
            Every lap you drive is saved here, grouped by route, with your best time.
          </Empty>
        ) : (
          <div style={{ padding: '14px 16px 0', display: 'grid', gap: 10 }}>
            {logbook.map(({ route: r, laps, last }) => (
              <Link
                key={r.id}
                to={`/r/${r.id}/history`}
                className="glass lift"
                style={{ borderRadius: 28, padding: '16px 16px 16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{r.name}</b>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
                    <span className="t acc" style={{ fontSize: 28 }}>{pbs.has(r.id) ? formatLap(pbs.get(r.id)) : '–'}</span>
                    <span className="lbl">{pbs.has(r.id) ? 'PB' : 'No valid lap'}</span>
                  </div>
                  <div className="lbl" style={{ marginTop: 4 }}>
                    {laps} {laps === 1 ? 'lap' : 'laps'} · {formatDate(last)}
                  </div>
                </div>
                <RouteGlyph route={r} style={{ width: 64, height: 44, flex: 'none', color: '#fff' }} strokeWidth={56} />
                <I n="fwd" style={{ color: 'var(--ink-2)' }} />
              </Link>
            ))}
          </div>
        )
      ) : (
        <div style={{ padding: '14px 16px 0', display: 'grid', gap: 10 }}>
          <div className="lbl" style={{ padding: '0 4px' }}>
            Your routes
            {limit > 1 && own.length > 0 && (limit === Infinity ? ` · ${publicCount} public` : ` · ${publicCount} of ${limit} public`)}
          </div>
          {own.length === 0 ? (
            <div className="glass lift" style={{ borderRadius: 28, padding: '18px 20px', display: 'grid', gap: 12 }}>
              <div>
                <b>No routes yet</b>
                <div className="lbl" style={{ marginTop: 4 }}>Draw a route on the map, split it into sectors, then drive it.</div>
              </div>
              <Link to="/routes/new" className="solid">
                Build a route
              </Link>
            </div>
          ) : (
            own.map((r) =>
              routeCard(
                r,
                isCreator && !r.hidden ? (
                  <button className="chip" style={r.isPublic ? solidChip : quiet} disabled={busy} onClick={() => setConfirm(r)}>
                    {r.isPublic ? 'Public' : 'Private'}
                  </button>
                ) : (
                  <span className="chip" style={r.isPublic ? solidChip : quiet}>
                    {r.isPublic ? 'Public' : 'Private'}
                  </span>
                ),
              ),
            )
          )}
          {official.length > 0 && (
            <>
              <div className="lbl" style={{ padding: '8px 4px 0' }}>Official</div>
              {official.map((r) => routeCard(r, <span className="chip" style={quiet}>Official</span>))}
            </>
          )}
          {!isCreator && <DriverPanel request={request} onRequested={setRequest} />}
        </div>
      )}

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} label={confirm?.isPublic ? 'Make route private' : 'Make route public'}>
        {confirm &&
          (confirm.isPublic ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <h2 className="title" style={{ fontSize: 24 }}>Make “{confirm.name}” private?</h2>
              <p className="lbl" style={{ fontSize: 15 }}>It leaves the map and its leaderboard is no longer shown. Laps already driven are kept.</p>
              <button className="solid" disabled={busy} onClick={() => setPublic(confirm, false)}>
                Make private
              </button>
              <button className="solid quiet" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <h2 className="title" style={{ fontSize: 24 }}>Make “{confirm.name}” public?</h2>
              {currentPublic && currentPublic.id !== confirm.id && (
                <p style={{ color: 'var(--s-y)' }}>
                  You can have one public route. “{currentPublic.name}” will become private, and its leaderboard will no longer be shown.
                </p>
              )}
              <p className="lbl" style={{ fontSize: 15 }}>Everyone will see it on the map and can drive it and post laps to its leaderboard.</p>
              <p className="lbl" style={{ fontSize: 15 }}>
                The start and end points become visible to everyone. Don&rsquo;t publish a route that starts at your home. Once published, its shape and
                sectors can&rsquo;t be edited, so times stay comparable.
              </p>
              <button className="solid" disabled={busy || (limit > 1 && publicCount >= limit)} onClick={() => setPublic(confirm, true)}>
                {currentPublic && currentPublic.id !== confirm.id ? 'Replace and publish' : 'Publish'}
              </button>
              <button className="solid quiet" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          ))}
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
    <div className="glass lift" style={{ borderRadius: 28, padding: '18px 20px', display: 'grid', gap: 12, marginTop: 8 }}>
      <div>
        <b>Want to publish a route?</b>
        <div className="lbl" style={{ marginTop: 4 }}>
          Publishing, with a leaderboard, is for approved creators. Ask the admin and say which track or event you want to time.
        </div>
      </div>
      {request?.status === 'pending' ? (
        <button className="solid quiet" disabled>
          Request pending
        </button>
      ) : (
        <button className="solid" onClick={() => setOpen(true)} disabled={request === undefined}>
          Request creator access
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} label="Request creator access">
        <div style={{ display: 'grid', gap: 12 }}>
          <h2 className="title" style={{ fontSize: 24 }}>Request creator access</h2>
          <label>
            <span className="visually-hidden">Note for the admin (optional)</span>
            <textarea className="field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the admin, e.g. I run our club's rally sprint stages" />
          </label>
          <button className="solid" disabled={busy} onClick={send}>
            Send request
          </button>
        </div>
      </Sheet>
    </div>
  );
}
