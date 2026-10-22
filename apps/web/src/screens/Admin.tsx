import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, Segmented, Switch, useToast } from '../components/ui';
import {
  adminAllPublicRoutes,
  adminDeleteRoute,
  getProfiles,
  listAudit,
  listRequests,
  listRoleHolders,
  moderateRoute,
  recentPostsForAdmin,
  removePost,
  searchUsers,
  setAdmin,
  setCreator,
  type RequestKind,
} from '../lib/data';
import { formatLap, timeAgo } from '../lib/format';
import { useMe } from '../lib/session';
import type { AuditEntry, CreatorRequest, Post, Profile, Role, Route } from '../lib/types';

type Tab = 'requests' | 'users' | 'routes' | 'posts' | 'log';

export default function Admin() {
  const { isAdmin } = useMe();
  const [tab, setTab] = useState<Tab>('requests');
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <main className="screen">
      <ScreenHead back title="Admin" />
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <Segmented
          label="Admin section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'requests', label: 'Requests' },
            { value: 'users', label: 'Users' },
            { value: 'routes', label: 'Routes' },
            { value: 'posts', label: 'Posts' },
            { value: 'log', label: 'Log' },
          ]}
        />
      </div>
      {tab === 'requests' && <Requests />}
      {tab === 'users' && <Users />}
      {tab === 'routes' && <Routes />}
      {tab === 'posts' && <Posts />}
      {tab === 'log' && <Log />}
    </main>
  );
}

function Requests() {
  const { isOwner } = useMe();
  return (
    <div className="stack-lg">
      {isOwner && <RequestList kind="admin" />}
      <RequestList kind="creator" />
    </div>
  );
}

/** Creator requests (admins and the owner decide) or admin requests (only the owner). */
function RequestList({ kind }: { kind: RequestKind }) {
  const { profile } = useMe();
  const toast = useToast();
  const [items, setItems] = useState<CreatorRequest[] | null>(null);
  const load = useCallback(() => listRequests('pending', kind).then(setItems).catch((e) => toast(errorMessage(e), 'error')), [toast, kind]);
  useEffect(() => void load(), [load]);

  async function decide(r: CreatorRequest, approve: boolean) {
    try {
      const target = { id: r.id, username: r.username };
      if (kind === 'admin') await setAdmin(profile, target, approve, approve ? 'approve' : 'reject');
      else await setCreator(profile, target, approve, approve ? 'approve' : 'reject');
      toast(approve ? (kind === 'admin' ? `${r.username} is now an admin` : `${r.username} can now create routes`) : `Request from ${r.username} declined`);
      setItems((xs) => xs?.filter((x) => x.id !== r.id) ?? null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const title = kind === 'admin' ? 'Admin requests' : 'Creator requests';
  if (!items) return <Loading />;
  if (!items.length)
    return (
      <Empty title={`No pending ${title.toLowerCase()}`}>
        {kind === 'admin' ? 'Creators who ask to become admins show up here. Only you can decide them.' : 'Drivers who ask for creator access show up here.'}
      </Empty>
    );
  return (
    <div className="stack">
      <h2 className="section-title">{title}</h2>
      {items.map((r) => (
        <div key={r.id} className="panel stack">
          <div className="row between">
            <Link to={`/u/${r.username}`}>
              <strong>{r.username}</strong>
            </Link>
            <span className="mute" style={{ fontSize: 14 }}>
              {timeAgo(r.createdAt?.toDate())}
            </span>
          </div>
          {r.note ? <p>“{r.note}”</p> : <p className="mute">No note.</p>}
          <div className="row">
            <button className="btn primary grow" onClick={() => decide(r, true)}>
              Approve
            </button>
            <button className="btn grow" onClick={() => decide(r, false)}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const { profile, isOwner } = useMe();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Map<string, Role>>(new Map());

  const loadRoles = useCallback(async () => {
    const holders = await listRoleHolders();
    setRoles(new Map(holders.map((h) => [h.id, h.role])));
    return holders;
  }, []);

  useEffect(() => {
    // Default view: everyone who currently holds a role.
    loadRoles()
      .then(async (holders) => {
        const map = await getProfiles(holders.map((h) => h.id));
        setResults([...map.values()]);
      })
      .catch((e) => toast(errorMessage(e), 'error'));
  }, [loadRoles, toast]);

  useEffect(() => {
    if (!q.trim()) return;
    const t = window.setTimeout(() => searchUsers(q).then(setResults).catch(() => undefined), 220);
    return () => window.clearTimeout(t);
  }, [q]);

  async function toggle(p: Profile, grant: boolean) {
    try {
      await setCreator(profile, { id: p.id, username: p.username }, grant);
      setRoles((m) => {
        const next = new Map(m);
        if (grant) next.set(p.id, 'creator');
        else next.delete(p.id);
        return next;
      });
      toast(grant ? `${p.username} is now a creator` : `${p.username} is a driver again`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function toggleAdmin(p: Profile, grant: boolean) {
    try {
      await setAdmin(profile, { id: p.id, username: p.username }, grant);
      setRoles((m) => new Map(m).set(p.id, grant ? 'admin' : 'creator'));
      toast(grant ? `${p.username} is now an admin` : `${p.username} is a creator again`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="stack">
      <input className="input" type="search" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q.trim() && <p className="mute" style={{ fontSize: 14 }}>Showing users with a role.</p>}
      <div className="list">
        {results.map((p) => {
          const role = roles.get(p.id) ?? 'driver';
          return (
            <div key={p.id} className="list-item">
              <Avatar name={p.username} hue={p.avatarHue} />
              <span className="grow">
                <strong>{p.username}</strong>
                <br />
                <span className="mute" style={{ fontSize: 14, textTransform: 'capitalize' }}>
                  {role}
                </span>
              </span>
              {role === 'owner' ? (
                <span className="badge blue">Owner</span>
              ) : isOwner && (role === 'creator' || role === 'admin') ? (
                // Only the owner makes or removes admins; a creator must exist first.
                <span className="row" style={{ gap: 8 }}>
                  <span className="mute" style={{ fontSize: 13 }}>Admin</span>
                  <Switch label={`Admin access for ${p.username}`} checked={role === 'admin'} onChange={(v) => toggleAdmin(p, v)} />
                </span>
              ) : role === 'admin' ? (
                <span className="badge blue">Admin</span>
              ) : (
                <Switch label={`Creator access for ${p.username}`} checked={role === 'creator'} onChange={(v) => toggle(p, v)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Routes() {
  const toast = useToast();
  const [routes, setRoutes] = useState<Route[] | null>(null);
  useEffect(() => {
    adminAllPublicRoutes().then(setRoutes).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);

  async function act(r: Route, change: { isPublic?: boolean; hidden?: boolean; official?: boolean }, msg: string) {
    try {
      await moderateRoute(r.id, change);
      setRoutes((rs) => rs?.map((x) => (x.id === r.id ? { ...x, ...change } : x)) ?? null);
      toast(msg);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove(r: Route) {
    if (!confirm(`Delete ${r.name} by ${r.ownerName} and all its posted laps? This cannot be undone.`)) return;
    try {
      await adminDeleteRoute(r.id);
      setRoutes((rs) => rs?.filter((x) => x.id !== r.id) ?? null);
      toast('Route deleted');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (!routes) return <Loading />;
  if (!routes.length) return <Empty title="No published routes" />;
  return (
    <div className="list">
      {routes.map((r) => (
        <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
          <div className="row between" style={{ width: '100%' }}>
            <Link to={`/r/${r.id}`}>
              <strong>{r.name}</strong>
            </Link>
            <span className="row" style={{ gap: 6 }}>
              {r.isPublic && <span className="badge green">Public</span>}
              {r.hidden && <span className="badge red">Hidden</span>}
            </span>
          </div>
          <span className="mute" style={{ fontSize: 14 }}>
            by {r.ownerName}
            {r.official && ' · Official'}
          </span>
          <div className="row" style={{ marginTop: 4 }}>
            {r.isPublic && (
              <button className="btn sm" onClick={() => act(r, { isPublic: false }, 'Route unpublished')}>
                Unpublish
              </button>
            )}
            {r.isPublic && (
              <button
                className="btn sm"
                onClick={() => act(r, { official: !r.official }, r.official ? 'Official label removed' : 'Route is now Official')}
              >
                {r.official ? 'Remove Official' : 'Make Official'}
              </button>
            )}
            <button className="btn sm" onClick={() => act(r, { hidden: !r.hidden }, r.hidden ? 'Route visible again' : 'Route hidden')}>
              {r.hidden ? 'Unhide' : 'Hide'}
            </button>
            <button className="btn danger sm" onClick={() => remove(r)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Posts() {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    recentPostsForAdmin().then(setPosts).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);

  async function remove(p: Post) {
    if (!confirm(`Remove ${p.username}'s ${formatLap(p.totalMs)} post on ${p.routeName}?`)) return;
    try {
      await removePost(p.id);
      setPosts((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
      toast('Post removed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (!posts) return <Loading />;
  if (!posts.length) return <Empty title="No posts yet" />;
  return (
    <div className="list">
      {posts.map((p) => (
        <div key={p.id} className="list-item">
          <span className="grow">
            <strong className="num" style={{ fontSize: 20 }}>
              {formatLap(p.totalMs)}
            </strong>{' '}
            <span className="mute">{p.username}</span>
            <br />
            <span className="mute" style={{ fontSize: 14 }}>
              {p.routeName} · {timeAgo(p.createdAt?.toDate())}
              {p.caption ? ` · “${p.caption}”` : ''}
            </span>
          </span>
          <button className="btn danger sm" onClick={() => remove(p)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  grant_creator: 'granted creator to',
  revoke_creator: 'revoked creator from',
  approve_request: 'approved the request of',
  reject_request: 'rejected the request of',
};

function Log() {
  const toast = useToast();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    listAudit().then(setItems).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  if (!items) return <Loading />;
  if (!items.length) return <Empty title="Nothing logged yet">Every grant and revoke is recorded here.</Empty>;
  return (
    <div className="list">
      {items.map((a) => (
        <div key={a.id} className="list-item">
          <span className="grow">
            <strong>{a.actorName}</strong> {ACTIONS[a.action] ?? a.action} <strong>{a.targetName}</strong>
            <br />
            <span className="mute" style={{ fontSize: 14 }}>
              {a.createdAt?.toDate().toLocaleString()}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
