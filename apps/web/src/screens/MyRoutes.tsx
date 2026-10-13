import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RouteShape } from '../components/RouteShape';
import { Empty, errorMessage, Loading, ScreenHead, Sheet, Switch, useToast } from '../components/ui';
import { allMyRuns, getMyRequest, getRoutes, myRoutes, requestCreatorAccess, setRoutePublic } from '../lib/data';
import { formatDistance, formatLap } from '../lib/format';
import { useMe } from '../lib/session';
import type { CreatorRequest, Route, Run } from '../lib/types';

export default function MyRoutes() {
  const { profile, isCreator } = useMe();
  const toast = useToast();
  const [own, setOwn] = useState<Route[] | null>(null);
  const [driven, setDriven] = useState<Route[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [request, setRequest] = useState<CreatorRequest | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, myRuns] = await Promise.all([myRoutes(profile.id), allMyRuns(profile.id)]);
      setOwn(mine);
      setRuns(myRuns);
      const ownIds = new Set(mine.map((r) => r.id));
      const others = [...new Set(myRuns.map((r) => r.routeId))].filter((id) => !ownIds.has(id));
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

  const pbs = useMemo(() => {
    const m = new Map<string, number>();
    runs.filter((r) => r.valid).forEach((r) => m.set(r.routeId, Math.min(m.get(r.routeId) ?? Infinity, r.totalMs)));
    return m;
  }, [runs]);

  async function setPublic(route: Route, makePublic: boolean) {
    setBusy(true);
    try {
      await setRoutePublic(profile, route, makePublic);
      setOwn((rs) =>
        rs?.map((r) => (r.id === route.id ? { ...r, isPublic: makePublic } : makePublic && r.isPublic ? { ...r, isPublic: false } : r)) ?? null,
      );
      toast(makePublic ? `${route.name} is public` : `${route.name} is private`);
      setConfirm(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const currentPublic = own?.find((r) => r.isPublic);

  if (own === null) return <Loading />;

  return (
    <main className="screen">
      <ScreenHead
        title="Routes"
        right={
          isCreator && (
            <Link to="/routes/new" className="btn primary sm">
              <Plus size={18} aria-hidden="true" /> New route
            </Link>
          )
        }
      />

      {isCreator ? (
        <>
          {own.length === 0 ? (
            <Empty title="No routes yet" action={<Link to="/routes/new" className="btn primary lg">Build a route</Link>}>
              Draw a route on the map, split it into sectors, then drive it.
            </Empty>
          ) : (
            <div className="stack">
              {own.map((r) => (
                <article key={r.id} className="panel route-tile">
                  <Link to={`/r/${r.id}`} style={{ textDecoration: 'none' }}>
                    <RouteShape route={r} height={120} />
                    <div className="row between" style={{ marginTop: 10 }}>
                      <h3>{r.name}</h3>
                      <span className="num" style={{ fontSize: 20 }}>
                        {pbs.has(r.id) ? formatLap(pbs.get(r.id)) : '—'}
                      </span>
                    </div>
                    <p className="mute" style={{ fontSize: 14 }}>
                      {formatDistance(r.lengthM)} · {r.boundaries.length} sectors · {r.isLoop ? 'Lap' : 'Point to point'} ·{' '}
                      {r.startType === 'standing' ? 'Standing start' : 'Rolling start'}
                    </p>
                  </Link>
                  <hr className="hairline" />
                  <div className="row between">
                    <span>
                      <strong>Public</strong>
                      <span className="mute" style={{ display: 'block', fontSize: 13 }}>
                        {r.isPublic ? 'On the map, with a leaderboard' : 'Only you can see it'}
                      </span>
                    </span>
                    <Switch
                      label={`Make ${r.name} public`}
                      checked={r.isPublic}
                      disabled={busy || r.hidden}
                      onChange={(v) => (v ? setConfirm(r) : void setPublic(r, false))}
                    />
                  </div>
                  {r.hidden && <p className="notice warn" style={{ marginTop: 12 }}>An admin has hidden this route.</p>}
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <DriverPanel request={request} onRequested={setRequest} />
      )}

      <h2 className="section-title">{isCreator ? "Other people's routes you've driven" : "Public routes you've driven"}</h2>
      {driven.length === 0 ? (
        <p className="mute">
          Pick a route on the <Link to="/map">map</Link> and drive it. It'll be listed here.
        </p>
      ) : (
        <div className="list">
          {driven.map((r) => (
            <Link key={r.id} to={`/r/${r.id}`} className="list-item">
              <div style={{ width: 64 }}>
                <RouteShape route={r} height={44} ticks={false} />
              </div>
              <span className="grow">
                <strong>{r.name}</strong>
                <br />
                <span className="mute" style={{ fontSize: 14 }}>
                  by {r.ownerName}
                </span>
              </span>
              <span className="num" style={{ fontSize: 18 }}>
                {pbs.has(r.id) ? formatLap(pbs.get(r.id)) : ''}
              </span>
            </Link>
          ))}
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
    <div className="panel stack">
      <h3>Want to build your own routes?</h3>
      <p className="mute">Route building is for approved creators. Ask the admin, and say which track or event you want to time.</p>
      {request?.status === 'pending' ? (
        <button className="btn" disabled>
          Request pending
        </button>
      ) : (
        <button className="btn primary" onClick={() => setOpen(true)} disabled={request === undefined}>
          Request creator access
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} label="Request creator access">
        <div className="stack">
          <h2>Request creator access</h2>
          <label className="field">
            <span>Note for the admin (optional)</span>
            <textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I run the Saturday hill-climb at Ecce Homo" />
          </label>
          <button className="btn primary lg block" disabled={busy} onClick={send}>
            Send request
          </button>
        </div>
      </Sheet>
    </div>
  );
}
