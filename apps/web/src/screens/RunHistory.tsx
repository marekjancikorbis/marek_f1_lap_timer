import { ListFilter } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { Empty, errorMessage, Loading, ScreenHead, SectorStrip, Segmented, useToast } from '../components/ui';
import { deleteRun, getRoute, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
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
    <main className="screen">
      <ScreenHead
        back
        title={`My laps · ${route?.name ?? 'Route'}`}
        right={
          runs.length > 0 && (
            <button className="icon-btn" aria-label={editing ? 'Done' : 'Select laps to compare, post or delete'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              <ListFilter size={22} />
            </button>
          )
        }
      />
      {runs.length === 0 ? (
        <Empty title="No laps yet" action={<Link className="btn primary" to={`/drive/${routeId}`}>Drive it</Link>} />
      ) : (
        <>
          {theoretical && counted.length > 1 && (
            <section className="panel navy history-best">
              <span className="livery thin" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="cap">Theoretical best</span>
              <strong className="num history-best-time">{formatLap(theoretical[theoretical.length - 1])}</strong>
              <span className="mute">
                Your best time in each sector added up
                {best && best.totalMs > theoretical[theoretical.length - 1] &&
                  ` · ${((best.totalMs - theoretical[theoretical.length - 1]) / 1000).toFixed(2)} under your best`}
              </span>
            </section>
          )}
          <div style={{ marginTop: 12 }}>
            <Segmented
              label="Sort laps"
              value={sort}
              onChange={changeSort}
              options={[
                { value: 'time', label: 'Fastest' },
                { value: 'date', label: 'Newest' },
              ]}
            />
          </div>
          {editing && <p className="mute small-text" style={{ marginTop: 10 }}>Select two laps to compare them.</p>}
          <div className="list" style={{ marginTop: 10 }}>
            {(sorted ?? []).map((run) => (
              <article key={run.id} className={`history-row ${selected.includes(run.id) ? 'selected' : ''}`}>
                {editing && (
                  <button className="run-select" onClick={() => toggle(run.id)} aria-pressed={selected.includes(run.id)} aria-label={`Select lap ${formatLap(run.totalMs)}`}>
                    <span className="check" />
                  </button>
                )}
                <Link to={`/run/${run.id}`} className="history-main">
                  <span className="grow">
                    <span className="history-line">
                      {/* A partial lap has no finish time: show how far it got. */}
                      <strong className={`num history-time ${run.partial ? 'partial-dist' : ''}`}>
                        {run.partial ? formatDistance(route?.boundaries[run.splitTimesMs.length - 1] ?? 0) : formatLap(run.totalMs)}
                      </strong>
                      {run.id === pbId && <span className="badge green">PB</span>}
                      {run.posted && <span className="badge ink">Posted</span>}
                      {run.penaltyMs > 0 && <span className="badge red">+5 s</span>}
                      {run.replay && <span className="badge outline">Sim</span>}
                      {notCounted(run) && <span className="badge outline">{notCounted(run)}</span>}
                    </span>
                    <span className="mute small-text" style={{ marginTop: 4 }}>
                      {day(run.startedAt)}
                      {run.partial && ` · GPS lost in S${run.splitTimesMs.length + 1}`}
                    </span>
                  </span>
                  <span className="history-stripe">
                    <SectorStrip colours={colours(run)} />
                  </span>
                </Link>
                {editing && (
                  <div className="run-actions">
                    {route?.isPublic && run.valid && !run.replay && (run.posted ? (
                      <button className="btn sm" onClick={() => unpost(run)}>
                        Unpost
                      </button>
                    ) : (
                      <button className="btn sm primary" onClick={() => setPosting(run)}>
                        Post
                      </button>
                    ))}
                    <button className="btn sm danger" onClick={() => remove(run)} aria-label="Delete lap">
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {selected.length === 2 && (
        <div className="floating-cta">
          <button className="btn primary lg block" onClick={() => nav(`/compare/${routeId}?a=run:${selected[0]}&b=run:${selected[1]}`)}>
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
