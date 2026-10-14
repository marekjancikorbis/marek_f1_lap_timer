import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { Empty, errorMessage, Loading, ScreenHead, SectorStrip, Segmented, useToast } from '../components/ui';
import { deleteRun, getRoute, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatLap } from '../lib/format';
import { pbsBefore } from '../lib/laps';
import { bestSectors, sectorTimes, theoreticalBest } from '@laptimer/timing';
import { useMe } from '../lib/session';
import type { Route, Run, SectorColourName } from '../lib/types';

type SortBy = 'date' | 'time';
const SORT_KEY = 'my-laps-sort';

function loadSort(): SortBy {
  try {
    return localStorage.getItem(SORT_KEY) === 'time' ? 'time' : 'date';
  } catch {
    return 'date';
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
  const allTimeBest = useMemo(() => bestSectors(counted), [counted]);
  const theoretical = useMemo(() => theoreticalBest(counted), [counted]);

  /** Purple: your all-time best sector. Green: it was your best when driven, since beaten. Yellow: never your best. Invalid laps don't count: grey. */
  function colours(run: Run): (SectorColourName | null)[] {
    if (!counted.includes(run)) return run.splitTimesMs.map(() => null);
    const before = pbsBefore(runs ?? [], run);
    return sectorTimes(run.splitTimesMs).map((s, i) =>
      s <= (allTimeBest[i] ?? Infinity) ? 'purple' : before[i] == null || s < before[i]! ? 'green' : 'yellow',
    );
  }

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
      await unpostLap(profile.id, run.id);
      setRuns((rs) => rs?.map((r) => (r.id === run.id ? { ...r, posted: false } : r)) ?? null);
      toast('Post removed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (route === undefined || runs === null) return <Loading />;

  return (
    <main className="screen">
      <ScreenHead back title="My laps" />
      <p className="mute" style={{ marginTop: -8 }}>
        {route?.name ?? 'Route'} · select two laps to compare
      </p>
      {runs.length === 0 ? (
        <Empty title="No laps yet" action={<Link className="btn primary" to={`/drive/${routeId}`}>Drive it</Link>} />
      ) : (
        <div className="stack" style={{ marginTop: 16, gap: 8 }}>
          {theoretical && counted.length > 1 && (
            <div className="panel row between">
              <span>
                <strong>Theoretical best</strong>
                <span className="mute" style={{ display: 'block', fontSize: 13 }}>
                  Your best time in every sector, added up
                </span>
              </span>
              <strong className="num" style={{ fontSize: 24 }}>
                {formatLap(theoretical[theoretical.length - 1])}
              </strong>
            </div>
          )}
          <Segmented
            label="Sort laps"
            value={sort}
            onChange={changeSort}
            options={[
              { value: 'date', label: 'Newest' },
              { value: 'time', label: 'Fastest' },
            ]}
          />
          {(sorted ?? []).map((run) => (
            <article key={run.id} className={`run-row ${selected.includes(run.id) ? 'selected' : ''}`}>
              <button className="run-select" onClick={() => toggle(run.id)} aria-pressed={selected.includes(run.id)} aria-label={`Select lap ${formatLap(run.totalMs)}`}>
                <span className="check" />
              </button>
              <Link to={`/run/${run.id}`} className="grow run-main">
                <div className="row between">
                  <strong className="num" style={{ fontSize: 24 }}>
                    {formatLap(run.totalMs)}
                  </strong>
                  <span className="row" style={{ gap: 6 }}>
                    {run.id === pbId && <span className="badge ink">PB</span>}
                    {run.posted && <span className="badge purple">Posted</span>}
                    {run.replay && <span className="badge yellow">Sim</span>}
                    {run.penaltyMs > 0 && <span className="badge red">+5 s</span>}
                    {!run.valid && <span className="badge outline">Invalid</span>}
                  </span>
                </div>
                <SectorStrip colours={colours(run)} height={5} />
                <span className="mute" style={{ fontSize: 13 }}>
                  {formatDate(run.startedAt)} · {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </Link>
              <div className="run-actions">
                {route?.isPublic && run.valid && !run.replay && (run.posted ? (
                  <button className="btn sm" onClick={() => unpost(run)}>
                    Unpost
                  </button>
                ) : (
                  <button className="btn sm purple" onClick={() => setPosting(run)}>
                    Post
                  </button>
                ))}
                <button className="btn sm ghost" onClick={() => remove(run)} aria-label="Delete lap">
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
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
