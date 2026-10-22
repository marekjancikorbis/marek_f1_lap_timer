import { bigSplits, compareLaps, type LapComparison } from '@laptimer/timing';
import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SERIES } from '../components/Charts';
import { LapTabs } from '../components/LapView';
import { SectorTable } from '../components/SectorTable';
import { Empty, errorMessage, Loading, ScreenHead, Sheet } from '../components/ui';
import { getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom } from '../lib/data';
import { formatDate, formatDelta, formatLap, formatSeconds } from '../lib/format';
import { bigEnds, bigRecords, bigRoute, resolveLap, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Route, Run } from '../lib/types';

export default function Compare() {
  const { routeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { profile } = useMe();
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
      setRuns(mine.filter((x) => x.valid));
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

  // The sector table compares the 3 big sectors; the graphs keep every minisector.
  const bigCmp: LapComparison | null = useMemo(() => {
    if (!route || !a || !b || !cmp) return null;
    const ends = bigEnds(route);
    const cut = (l: ResolvedLap) => ({ ...l, splitTimesMs: bigSplits(l.splitTimesMs, ends), profile: null });
    try {
      return compareLaps(cut(a), cut(b), bigRoute(route).boundaries, bigRecords(posts, route));
    } catch {
      return null;
    }
  }, [route, a, b, cmp, posts]);

  const label = (l: ResolvedLap) => (l.username ? l.username : l.label === 'Your lap' ? `You ${l.sub}` : l.label);

  if (route === undefined || a === undefined || b === undefined) return <Loading />;
  if (!route)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Route not available" />
      </main>
    );
  if (!a || !b || !cmp)
    return (
      <main className="screen">
        <ScreenHead back title="Compare" />
        <Empty title="Nothing to compare yet">
          {!a ? "One of the laps isn't available. " : ''}
          {aRef === 'best' && !a ? 'Your theoretical best needs at least one lap on this route. ' : ''}
          Drive this route to compare against it.
        </Empty>
        {error && <p className="notice error">{error}</p>}
      </main>
    );

  const aLabel = label(a);
  const bLabel = label(b);

  return (
    <main className="screen">
      <ScreenHead
        back
        title="Compare"
        right={
          <button className="icon-btn" aria-label="Swap A and B" onClick={() => setParams({ a: bRef, b: aRef }, { replace: true })}>
            <ArrowLeftRight size={22} />
          </button>
        }
      />
      <p className="mute" style={{ marginTop: -8 }}>
        {route.name}
      </p>

      <section className="cmp-head">
        <LapHead lap={a} label={aLabel} colour={SERIES.a} tag="A" />
        <div className={`cmp-gap num ${cmp.gapMs < 0 ? 'a' : cmp.gapMs > 0 ? 'b' : ''}`}>
          {formatDelta(cmp.gapMs, 3)}
          <small>{cmp.gapMs < 0 ? `${aLabel} faster` : cmp.gapMs > 0 ? `${bLabel} faster` : 'Dead heat'}</small>
        </div>
        <LapHead lap={b} label={bLabel} colour={SERIES.b} tag="B" onChange={() => setPicker(true)} />
      </section>

      <LapTabs
        lap={{ ...a, username: aLabel }}
        reference={{ label: bLabel, splitTimesMs: b.splitTimesMs, totalMs: b.totalMs, penaltyMs: b.penaltyMs, profile: b.profile }}
        route={route}
        colours={cmp.sectors.map((x) => (x.faster === 'b' ? 'yellow' : 'green'))}
        sectors={
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <SectorTable rows={(bigCmp ?? cmp).sectors} aLabel={aLabel} bLabel={bLabel} />
          </div>
        }
      />

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

function LapHead({ lap, label, colour, tag, onChange }: { lap: ResolvedLap; label: string; colour: string; tag: string; onChange?: () => void }) {
  return (
    <div className="cmp-lap">
      <span className="cmp-tag" style={{ background: colour }}>
        {tag}
      </span>
      <strong className="ellipsis">{label}</strong>
      <span className="num cmp-total">{formatLap(lap.totalMs)}</span>
      <span className="mute" style={{ fontSize: 12 }}>
        {lap.penaltyMs > 0 && `incl. +${formatSeconds(lap.penaltyMs)} jump start`}
      </span>
      {onChange && (
        <button className="btn sm ghost" onClick={onChange}>
          Change
        </button>
      )}
    </div>
  );
}

function LapPicker({ route, runs, posts, exclude, onPick }: { route: Route; runs: Run[]; posts: Post[]; exclude: string; onPick: (ref: string) => void }) {
  const board = leaderboardFrom(posts);
  const item = (ref: string, title: string, sub: string, ms: number | null) =>
    ref === exclude ? null : (
      <button key={ref} className="ref-option" onClick={() => onPick(ref)}>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{title}</strong>
          <span className="mute ellipsis" style={{ display: 'block', fontSize: 13 }}>
            {sub}
          </span>
        </span>
        {ms != null && <span className="num" style={{ fontSize: 20 }}>{formatLap(ms)}</span>}
      </button>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h2>Compare with</h2>
      {runs.length > 0 && item('best', 'Your theoretical best', 'Best time in each sector', null)}
      {posts.length > 0 && item('record', 'Route record', 'All purple sectors', null)}
      {[...runs]
        .sort((x, y) => x.totalMs - y.totalMs)
        .slice(0, 10)
        .map((r) => item(`run:${r.id}`, 'Your lap', formatDate(r.startedAt), r.totalMs))}
      {board.slice(0, 20).map(({ rank, post }) => item(`post:${post.id}`, `P${rank} ${post.username}`, post.car ?? formatDate(post.startedAt), post.totalMs))}
      {!runs.length && !posts.length && <p className="mute">No other laps on {route.name} yet.</p>}
    </div>
  );
}
