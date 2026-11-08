import { compareLaps, type LapComparison } from '@laptimer/timing';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DeltaGraph } from '../components/Charts';
import { useSectorTable } from '../components/LapView';
import { RouteMap } from '../components/RouteMap';
import { Empty, errorMessage, I, Loading, ScreenHead, Sheet } from '../components/ui';
import { getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { bigRoute, notCounted, resolveLap, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Route, Run } from '../lib/types';

const NO_COLOURS: never[] = [];

export default function Compare() {
  const { routeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { profile } = useMe();
  const nav = useNavigate();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [a, setA] = useState<ResolvedLap | null | undefined>(undefined);
  const [b, setB] = useState<ResolvedLap | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aRef = params.get('a') ?? 'best';
  const bRef = params.get('b') ?? 'record';

  useEffect(() => {
    (async () => {
      const r = await getRoute(routeId);
      setRoute(r);
      if (!r) return;
      const [p, mine] = await Promise.all([r.isPublic ? routePosts(r.id).catch(() => []) : [], runsForRoute(profile.id, r.id).catch(() => [])]);
      setPosts(p);
      setRuns(mine);
    })().catch((e) => setError(errorMessage(e)));
  }, [routeId, profile.id]);

  useEffect(() => {
    setA(undefined);
    resolveLap(aRef, profile.id, routeId).then(setA).catch(() => setA(null));
  }, [aRef, profile.id, routeId]);
  useEffect(() => {
    setB(undefined);
    resolveLap(bRef, profile.id, routeId).then(setB).catch(() => setB(null));
  }, [bRef, profile.id, routeId]);

  const records = useMemo(() => (route ? sectorRecordsFrom(posts, route.boundaries.length) : []), [posts, route]);

  const cmp: LapComparison | null = useMemo(() => {
    if (!route || !a || !b) return null;
    try {
      return compareLaps(a, b, route.boundaries, records);
    } catch {
      return null;
    }
  }, [route, a, b, records]);

  const label = (l: ResolvedLap) => (l.username ? l.username : l.label === 'Your lap' ? `You ${l.sub}` : l.label);
  // A's own post (if any) doesn't count as the record it is measured against.
  const aLap = useMemo(() => (a ? { id: a.ref.slice(a.ref.indexOf(':') + 1), splitTimesMs: a.splitTimesMs, partial: a.partial } : null), [a]);
  const sectorTable = useSectorTable(aLap, route ?? null, posts, b ?? null, NO_COLOURS);

  if (route === undefined || a === undefined || b === undefined) return <Loading />;
  if (!route)
    return (
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back />
        <Empty title="Route not available" />
      </main>
    );
  if (!a || !b || !cmp)
    return (
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back title="Compare" />
        <Empty title="Nothing to compare yet">
          {!a ? 'One of the laps isn\u2019t available. ' : ''}
          {aRef === 'best' && !a ? 'Your ideal lap needs at least one lap on this route. ' : ''}
          Drive this route to compare against it.
        </Empty>
        {error && <p className="err" style={{ textAlign: 'center' }}>{error}</p>}
      </main>
    );

  const aLabel = label(a);
  const bLabel = label(b);
  // The map: each minisector in the colour of whoever was faster through it.
  const who = sectorTable?.flatMap((t) => t.kids.map((k) => (k.deltaMs == null ? null : k.deltaMs <= 0 ? ('green' as const) : ('yellow' as const)))) ?? [];
  const gap = cmp.gapMs;

  return (
    <main className="ph fixed compare">
      <div className="map">
        <RouteMap route={route} colours={who} height="100%" padding={{ top: 120, bottom: 380, left: 40, right: 40 }} />
      </div>
      <div className="edge" />
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between' }}>
        <button className="glass ib" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav(`/r/${route.id}`))}>
          <I n="back" />
        </button>
        <button className="glass ib" aria-label="Swap the two laps" onClick={() => setParams({ a: bRef, b: aRef }, { replace: true })}>
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
          </svg>
        </button>
      </div>
      <div className="glass sheet sheet-b" style={{ paddingTop: 20, bottom: 'calc(8px + var(--safe-b))' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="lbl" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <i className="dot" style={{ background: 'var(--s-g)' }} />
              <span className="ellipsis">{a.username || (a.label === 'Your lap' ? 'You' : a.label)}</span>
            </div>
            <div className="t" style={{ fontSize: 26, marginTop: 6 }}>{formatLap(a.totalMs)}</div>
          </div>
          <span className={`t${gap > 0 ? ' acc' : ''}`} style={{ fontSize: 18, paddingBottom: 4, color: gap <= 0 ? 'var(--s-g)' : undefined }}>
            {formatDelta(gap, 2)}
          </span>
          <button style={{ textAlign: 'right', minWidth: 0 }} onClick={() => setPicker(true)} aria-label={`Compared with ${bLabel}. Change`}>
            <div className="lbl" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
              <span className="ellipsis">{b.username || b.label}</span>
              <i className="dot" style={{ background: 'var(--s-y)' }} />
            </div>
            <div className="t" style={{ fontSize: 26, marginTop: 6 }}>{formatLap(b.totalMs)}</div>
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <DeltaGraph data={cmp.delta} boundaries={bigRoute(route).boundaries} aLabel={aLabel} bLabel={bLabel} />
        </div>
        {sectorTable && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sectorTable.length}, 1fr)`, marginTop: 6 }} className="lbl">
            {sectorTable.map((t, i) => (
              <span key={t.row.name} style={{ textAlign: i === 0 ? 'left' : i === sectorTable.length - 1 ? 'right' : 'center' }}>
                {t.row.name} {t.row.deltaMs != null ? formatDelta(t.row.deltaMs, 2) : '–'}
              </span>
            ))}
          </div>
        )}
        <Link className="solid" style={{ marginTop: 16 }} to={`/drive/${route.id}?ref=${bRef}`}>
          Race {b.username || (bRef === 'record' ? 'the record' : bRef === 'best' ? 'your ideal lap' : 'this lap')}
        </Link>
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} label="Compare with">
        <LapPicker
          route={route}
          runs={runs}
          posts={posts}
          exclude={aRef}
          onPick={(ref) => {
            setParams({ a: aRef, b: ref }, { replace: true });
            setPicker(false);
          }}
        />
      </Sheet>
    </main>
  );
}

function LapHead({ lap, label, tag, record }: { lap: ResolvedLap; label: string; tag: string; record?: boolean }) {
  return (
    <div className={`panel cmp-card ${record ? 'is-record' : ''}`}>
      <span className="cap">
        {tag} · {label}
      </span>
      <span className="num cmp-total">{formatLap(lap.totalMs)}</span>
      <span className="mute small-text ellipsis">
        {lap.partial ? 'partial lap' : lap.penaltyMs > 0 ? `incl. +${formatSeconds(lap.penaltyMs)} jump start` : lap.sub}
      </span>
    </div>
  );
}

function LapPicker({ route, runs, posts, exclude, onPick }: { route: Route; runs: Run[]; posts: Post[]; exclude: string; onPick: (ref: string) => void }) {
  const board = leaderboardFrom(posts);
  const item = (ref: string, title: string, sub: string, ms: number | null) =>
    ref === exclude ? null : (
      <button key={ref} onClick={() => onPick(ref)} style={{ gridTemplateColumns: '1fr auto', textAlign: 'left' }}>
        <div style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: 'block' }}>{title}</b>
          <div className="lbl ellipsis">{sub}</div>
        </div>
        {ms != null && <span className="t" style={{ fontSize: 19 }}>{formatLap(ms)}</span>}
      </button>
    );
  return (
    <div>
      <h2 className="title" style={{ fontSize: 24 }}>Compare with</h2>
      <div className="rows">
      {runs.some((r) => r.valid) && item('best', 'Your ideal lap', 'Best time in each sector', null)}
      {posts.length > 0 && item('record', 'Route record', 'All purple sectors', null)}
      {/* Your fastest laps, then your newest that don't count (partial or signal lost) */}
      {[...runs.filter((r) => r.valid).sort((x, y) => x.totalMs - y.totalMs).slice(0, 10), ...runs.filter((r) => !r.valid).sort((x, y) => y.startedAt - x.startedAt).slice(0, 5)].map((r) =>
        item(`run:${r.id}`, notCounted(r) ? `Your lap · ${notCounted(r)}` : 'Your lap', formatDate(r.startedAt), r.partial ? null : r.totalMs),
      )}
      {board.slice(0, 20).map(({ rank, post }) => item(`post:${post.id}`, `P${rank} ${post.username}`, post.car ?? formatDate(post.startedAt), post.totalMs))}
      {!runs.length && !posts.length && <p className="lbl">No other laps on {route.name} yet.</p>}
      </div>
    </div>
  );
}
