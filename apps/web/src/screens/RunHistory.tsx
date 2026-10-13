import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostSheet } from '../components/PostSheet';
import { Empty, errorMessage, Loading, ScreenHead, SectorStrip, useToast } from '../components/ui';
import { deleteRun, getRoute, routePosts, runsForRoute, unpostLap } from '../lib/data';
import { formatDate, formatLap } from '../lib/format';
import { coloursFor, recordsExcluding } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Route, Run } from '../lib/types';
import { bestSectors } from '@laptimer/timing';

export default function RunHistory() {
  const { routeId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [posting, setPosting] = useState<Run | null>(null);

  useEffect(() => {
    (async () => {
      const r = await getRoute(routeId);
      setRoute(r);
      setRuns(await runsForRoute(profile.id, routeId));
      if (r?.isPublic) setPosts(await routePosts(r.id).catch(() => []));
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setRuns([]);
    });
  }, [routeId, profile.id, toast]);

  const pbId = useMemo(() => runs?.filter((r) => r.valid).sort((a, b) => a.totalMs - b.totalMs)[0]?.id, [runs]);

  function colours(run: Run) {
    if (!route || !runs) return [];
    const n = route.boundaries.length;
    const records = route.isPublic ? recordsExcluding(posts, n, run.id) : bestSectors(runs.filter((x) => x.valid && x.id !== run.id));
    return coloursFor(run.splitTimesMs, null, records);
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
          {runs.map((run) => (
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
