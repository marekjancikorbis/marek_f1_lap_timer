import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { goBack } from '../lib/navStack';
import { PostSheet } from '../components/PostSheet';
import { Empty, errorMessage, I, Loading, SectorStrip, useToast } from '../components/ui';
import { deleteRun, getRoute, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDelta, formatDistance, formatLap } from '../lib/format';
import { historyColours, notCounted } from '../lib/laps';
import { theoreticalBest } from '@laptimer/timing';
import { useMe } from '../lib/session';
import type { Route, Run } from '../lib/types';

type SortBy = 'date' | 'time';
const SORT_KEY = 'my-laps-sort';

function loadSort(): SortBy {
  try {
    return localStorage.getItem(SORT_KEY) === 'date' ? 'date' : 'time';
  } catch {
    return 'time';
  }
}

export default function RunHistory() {
  const { routeId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [posting, setPosting] = useState<Run | null>(null);
  const [sort, setSort] = useState<SortBy>(loadSort);
  // Picking two laps to compare, or posting and deleting: tucked behind the bar's button.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await getRoute(routeId);
      setRoute(r);
      setRuns(await runsForRoute(profile.id, routeId));
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setRuns([]);
    });
  }, [routeId, profile.id, toast]);

  // Newest first, or fastest first with invalid laps (no comparable time) at the end.
  const sorted = useMemo(
    () =>
      runs &&
      [...runs].sort((a, b) =>
        sort === 'date' ? b.startedAt - a.startedAt : Number(b.valid) - Number(a.valid) || a.totalMs - b.totalMs || b.startedAt - a.startedAt,
      ),
    [runs, sort],
  );

  function changeSort(v: SortBy) {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* private mode: just not remembered */
    }
  }

  const pbId = useMemo(() => runs?.filter((r) => r.valid).sort((a, b) => a.totalMs - b.totalMs)[0]?.id, [runs]);

  // Your history, coloured against your bests as they stand today.
  const counted = useMemo(() => (runs && route ? runs.filter((r) => r.valid && r.splitTimesMs.length === route.boundaries.length) : []), [runs, route]);
  const theoretical = useMemo(() => theoreticalBest(counted), [counted]);
  // Strips show the 3 big sectors, against your bests as they stand today.
  const colours = useMemo(() => (runs && route ? historyColours(runs, route) : () => []), [runs, route]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  }

  async function remove(run: Run) {
    if (!confirm(`Delete the ${formatLap(run.totalMs)} lap from ${formatDate(run.startedAt)}?${run.posted ? ' Its post is removed too.' : ''}`)) return;
    try {
      await deleteRun(profile.id, run);
      setRuns((rs) => rs?.filter((r) => r.id !== run.id) ?? null);
      setSelected((s) => s.filter((x) => x !== run.id));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function unpost(run: Run) {
    try {
      await unpostLap(profile.id, run.id, run.routeId);
      setRuns((rs) => rs?.map((r) => (r.id === run.id ? { ...r, posted: false } : r)) ?? null);
      toast('Post removed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (route === undefined || runs === null) return <Loading />;

  const best = pbId ? runs.find((r) => r.id === pbId) : undefined;
  const day = (t: number) =>
    `${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <main className="ph soft docked">
      <div className="sb" />
      <div style={{ minHeight: 52, padding: '4px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="glass ib" aria-label="Back" onClick={() => goBack(nav, '/routes')}>
          <I n="back" />
        </button>
        {runs.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="glass chip" style={{ height: 44, borderRadius: 22, padding: '0 16px' }} onClick={() => changeSort(sort === 'time' ? 'date' : 'time')} aria-label={`Sorted by ${sort === 'time' ? 'fastest' : 'newest'}. Change`}>
              {sort === 'time' ? 'Fastest' : 'Newest'}
            </button>
            <button className="glass chip" style={{ height: 44, borderRadius: 22, padding: '0 16px' }} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Select'}
            </button>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 20px 0' }}>
        <div className="k">
          {route ? `${formatDistance(route.lengthM)} · ` : ''}
          {runs.length} {runs.length === 1 ? 'lap' : 'laps'}
        </div>
        <h1 className="h1" style={{ marginTop: 6 }}>{route?.name ?? 'Route'}</h1>
      </div>
      {runs.length === 0 ? (
        <Empty title="No laps yet" action={<Link className="solid" to={`/drive/${routeId}`}>Drive it</Link>} />
      ) : (
        <>
          {theoretical && counted.length > 1 && (
            <div style={{ padding: '16px 16px 0' }}>
              <div className="glass lift card" style={{ padding: '18px 20px' }}>
                <div className="between">
                  <span className="k">Ideal lap</span>
                  <span className="k">Best sectors combined</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <span className="t t2 acc">{formatLap(theoretical[theoretical.length - 1])}</span>
                  {best && best.totalMs > theoretical[theoretical.length - 1] && <span className="dl gain">{formatDelta(theoretical[theoretical.length - 1] - best.totalMs)}</span>}
                </div>
              </div>
            </div>
          )}
          <div className="k" style={{ padding: '20px 24px 0' }}>Laps</div>
          {editing && <p className="sub" style={{ padding: '8px 24px 0' }}>Select two laps to compare them.</p>}
          <div className="rows" style={{ padding: '2px 24px 0' }}>
            {(sorted ?? []).map((run) => {
              const chip =
                run.id === pbId ? (
                  <span className="chip main tag">PB</span>
                ) : run.penaltyMs > 0 ? (
                  <span className="chip tag">+5 s</span>
                ) : run.replay ? (
                  <span className="chip tag">Sim</span>
                ) : notCounted(run) ? (
                  <span className="chip tag">{notCounted(run)}</span>
                ) : best && !run.partial ? (
                  <span className="dl loss" style={{ height: 24, fontSize: 14 }}>{formatDelta(run.totalMs - best.totalMs)}</span>
                ) : run.posted ? (
                  <span className="chip tag">Posted</span>
                ) : null;
              const picked = selected.includes(run.id);
              return (
                <div key={run.id} style={{ gridTemplateColumns: editing ? '28px 1fr auto 70px' : '1fr auto 70px', display: 'grid' }}>
                  {editing && (
                    <button
                      onClick={() => toggle(run.id)}
                      aria-pressed={picked}
                      aria-label={`Select lap ${formatLap(run.totalMs)}`}
                      style={{ width: 24, height: 24, borderRadius: 12, display: 'grid', placeItems: 'center', background: picked ? 'var(--main)' : 'transparent', color: 'var(--on-main)', boxShadow: picked ? 'none' : 'inset 0 0 0 2px var(--ink-2)' }}
                    >
                      {picked && <I n="check" size={16} />}
                    </button>
                  )}
                  <Link to={`/run/${run.id}`} style={{ minWidth: 0 }}>
                    {/* A partial lap has no finish time: show how far it got. */}
                    <span className="t t4" style={{ opacity: run.partial ? 0.6 : 1, color: run.id === pbId ? 'var(--s-p)' : undefined }}>
                      {run.partial ? formatDistance(route?.boundaries[run.splitTimesMs.length - 1] ?? 0) : formatLap(run.totalMs)}
                    </span>
                    <div className="sub">
                      {day(run.startedAt)}
                      {run.partial && ` · GPS lost in S${run.splitTimesMs.length + 1}`}
                    </div>
                  </Link>
                  {chip ?? <span />}
                  <SectorStrip colours={colours(run)} wide />
                  {editing && (
                    <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 8 }}>
                      {route?.isPublic && run.valid && !run.replay &&
                        (run.posted ? (
                          <button className="chip" style={{ minHeight: 44 }} onClick={() => unpost(run)}>
                            Unpost
                          </button>
                        ) : (
                          <button className="chip main" style={{ minHeight: 44 }} onClick={() => setPosting(run)}>
                            Post
                          </button>
                        ))}
                      <button className="chip" style={{ background: 'color-mix(in srgb, #ff5a5f 20%, transparent)', color: '#ff9a9d' }} onClick={() => remove(run)} aria-label="Delete lap">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected.length === 2 && (
        <div style={{ position: 'fixed', left: 16, right: 16, bottom: 'calc(100px + var(--safe-b))', zIndex: 20, maxWidth: 528, margin: '0 auto' }}>
          <button className="solid" onClick={() => nav(`/compare/${routeId}?a=run:${selected[0]}&b=run:${selected[1]}`)}>
            Compare selected laps
          </button>
        </div>
      )}

      {posting && route && (
        <PostSheet
          open
          onClose={() => setPosting(null)}
          run={posting}
          route={route}
          myRuns={runs}
          onPosted={() => setRuns((rs) => rs?.map((r) => (r.id === posting.id ? { ...r, posted: true } : r)) ?? null)}
        />
      )}
    </main>
  );
}
