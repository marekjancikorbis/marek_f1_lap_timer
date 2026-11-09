import { serverTimestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { goBack } from '../lib/navStack';
import { Avatar, Empty, errorMessage, I, Loading, ScreenHead, Sheet, Switch, useToast } from '../components/ui';
import { RouteMap } from '../components/RouteMap';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getPost, getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom, updateMyProfile } from '../lib/data';
import { formatLap } from '../lib/format';
import { bigColoursFor, bigRecords, postBigColours, racedSplits, resolveLap, toBig, type ResolvedLap } from '../lib/laps';
import { bestSectors, theoreticalBest } from '@laptimer/timing';
import { useMe } from '../lib/session';
import type { Post, Route, Run, SectorColourName } from '../lib/types';
import { listLogs } from '../drive/gpslogs';
import { loadPrefs, savePrefs, setPendingDrive } from '../drive/store';

interface Option {
  ref: string;
  title: string;
  sub: string;
  totalMs: number | null;
  splits: number[] | null;
  /** Big-sector colours for the strip: as they were when the lap was driven. */
  colours?: SectorColourName[];
  who?: { name: string; hue?: number };
  /** P1 or the route record: shown in purple. */
  fastest?: boolean;
}

const shortDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function PreDrive() {
  const { routeId = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { profile } = useMe();
  const [route, setRoute] = useState<Route | null | undefined>(undefined);
  const [runs, setRuns] = useState<Run[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [extraPost, setExtraPost] = useState<Post | null>(null);
  const [ref, setRef] = useState<string>(params.get('ref') ?? '');
  const prefs = loadPrefs();
  const [mode, setMode] = useState(prefs.mode);
  const [voice, setVoice] = useState(prefs.voice);
  const [replay, setReplay] = useState(false);
  /** recordedAt of the GPS log to replay; 0 = a generated drive. */
  const [logAt, setLogAt] = useState(0);
  const [routeLogs] = useState(() => listLogs().filter((l) => l.route.id === routeId));
  const [countdown, setCountdown] = useState(profile.countdownS ?? DEFAULT_COUNTDOWN_S);
  const [terms, setTerms] = useState(false);
  const [starting, setStarting] = useState(false);
  const [moreLaps, setMoreLaps] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await getRoute(routeId);
      setRoute(r);
      if (!r) return;
      const [mine, p] = await Promise.all([runsForRoute(profile.id, r.id).catch(() => []), r.isPublic ? routePosts(r.id).catch(() => []) : []]);
      setRuns(mine.filter((x) => x.valid));
      setPosts(p);
      const want = params.get('ref');
      if (want?.startsWith('post:') && !p.some((x) => `post:${x.id}` === want)) {
        setExtraPost(await getPost(want.slice(5)));
      }
      if (!want) {
        const pb = mine.filter((x) => x.valid).sort((a, b) => a.totalMs - b.totalMs)[0];
        setRef(pb ? `run:${pb.id}` : '');
      }
    })().catch((e) => toast(errorMessage(e), 'error'));
    // Warm the drive screen's code while the driver chooses.
    void import('./Drive');
  }, [routeId, profile.id, params, toast]);

  // No purple on private routes; green is against your own best sectors.
  const records = useMemo(() => (route?.isPublic ? sectorRecordsFrom(posts, route.boundaries.length) : null), [posts, route]);
  const pbs = useMemo(() => bestSectors(runs.filter((r) => route && r.splitTimesMs.length === route.boundaries.length)), [runs, route]);
  const bigRecs = useMemo(() => (route?.isPublic ? bigRecords(posts, route) : null), [posts, route]);
  const ideal = useMemo(() => theoreticalBest(runs.filter((r) => route && r.splitTimesMs.length === route.boundaries.length)), [runs, route]);
  const bigPbs = useMemo(() => (route ? bestSectors(toBig(runs, route)) : []), [runs, route]);

  const options = useMemo(() => {
    const mine: Option[] = [...runs]
      .sort((a, b) => a.totalMs - b.totalMs)
      .map((r, i) => ({
        ref: `run:${r.id}`,
        title: i === 0 ? 'Your best' : 'Your lap',
        sub: `${shortDate(r.startedAt)}${r.replay ? ' · simulated' : ''}`,
        totalMs: r.totalMs,
        splits: r.splitTimesMs,
        colours: route ? bigColoursFor(r.splitTimesMs, route, runs.filter((x) => x.startedAt < r.startedAt), bigRecs, racedSplits(r, runs)) : [],
        who: { name: profile.username, hue: profile.avatarHue },
      }));
    const theirs: Option[] = leaderboardFrom(posts)
      .filter((row) => row.post.userId !== profile.id)
      .slice(0, 20)
      .map(({ rank, post }) => ({
        ref: `post:${post.id}`,
        title: post.username,
        sub: [`P${rank}`, shortDate(post.startedAt), post.car].filter(Boolean).join(' · '),
        totalMs: post.totalMs,
        splits: post.splitTimesMs,
        colours: postBigColours(post, route),
        who: { name: post.username, hue: post.avatarHue },
        fastest: rank === 1,
      }));
    if (extraPost && !theirs.some((t) => t.ref === `post:${extraPost.id}`)) {
      theirs.unshift({
        ref: `post:${extraPost.id}`,
        title: extraPost.username,
        sub: [shortDate(extraPost.startedAt), extraPost.car].filter(Boolean).join(' · '),
        totalMs: extraPost.totalMs,
        splits: extraPost.splitTimesMs,
        colours: postBigColours(extraPost, route),
        who: { name: extraPost.username, hue: extraPost.avatarHue },
      });
    }
    return { mine, theirs };
  }, [runs, posts, extraPost, profile.id, profile.username, profile.avatarHue, route, bigRecs]);

  async function go() {
    if (!route) return;
    if (!profile.acceptedTermsAt) {
      setTerms(true);
      return;
    }
    setStarting(true);
    try {
      // Ask for permissions on this tap, while the browser still counts it as a user gesture.
      const DME = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DME?.requestPermission === 'function') await DME.requestPermission().catch(() => 'denied');
      if (!replay && navigator.geolocation) {
        await new Promise<void>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            () => resolve(),
            { enableHighAccuracy: true, timeout: 8000 },
          ),
        );
      }
      let reference: { splits: number[]; label: string; ref: string } | null = null;
      if (ref) {
        const lap: ResolvedLap | null = await resolveLap(ref, profile.id, route.id);
        if (lap) reference = { splits: lap.splitTimesMs, label: lap.label, ref };
      }
      savePrefs({ mode, voice });
      if (route.startType === 'standing' && countdown !== profile.countdownS) void updateMyProfile(profile.id, { countdownS: countdown });
      setPendingDrive({ route, uid: profile.id, reference, records, personalBests: pbs, bigRecords: bigRecs, bigPersonalBests: bigPbs, countdownS: countdown, mode, voice, replay, replayLog: replay ? routeLogs.find((l) => l.recordedAt === logAt) : null });
      nav(`/drive/${route.id}/go`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setStarting(false);
    }
  }

  async function acceptTerms() {
    try {
      await updateMyProfile(profile.id, { acceptedTermsAt: serverTimestamp() });
      setTerms(false);
      toast('Thanks. Tap Start again.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (route === undefined) return <Loading />;
  if (route === null)
    return (
      <main className="ph soft">
        <div className="sb" />
        <ScreenHead back />
        <Empty title="Route not available" />
      </main>
    );

  const all = [...options.mine, ...options.theirs];
  const recordMs = records && records.length && records.every((x) => x != null) ? (records as number[]).reduce((a, b) => a + b, 0) : null;
  const idealMs = ideal ? ideal[ideal.length - 1] : null;
  const picked = all.find((x) => x.ref === ref);
  // The second tile is your best, or the lap you came here to race (Race on someone's lap).
  const lapTile = picked && picked !== options.mine[0] ? picked : options.mine[0];
  const chosen =
    ref === ''
      ? 'just the clock'
      : ref === 'best'
        ? 'your ideal lap'
        : ref === 'record'
          ? 'the route record'
          : picked
            ? `${picked.ref.startsWith('run:') ? picked.title.toLowerCase() : picked.title}, ${formatLap(picked.totalMs)}`
            : 'the chosen lap';
  const tint = 'color-mix(in srgb, var(--ink) 8%, transparent)';
  const tile = (key: string, label: string, ms: number | null, opts: { acc?: boolean; enabled?: boolean } = {}) => {
    const on = ref === key;
    const enabled = opts.enabled ?? true;
    return (
      <button
        key={label}
        className="ready-tile"
        disabled={!enabled}
        aria-pressed={on}
        onClick={() => setRef(key)}
        style={{
          padding: 14,
          borderRadius: 20,
          textAlign: 'left',
          background: on ? 'color-mix(in srgb, var(--main) 35%, transparent)' : tint,
          boxShadow: on ? 'inset 0 0 0 2px var(--main-hi)' : 'none',
          opacity: enabled ? 1 : 0.5,
        }}
      >
        <div className="lbl ellipsis" style={on ? { color: 'var(--ink)' } : undefined}>{label}</div>
        <div className={`t${opts.acc ? ' acc' : ''}`} style={{ fontSize: 26, marginTop: 6, color: ms == null ? 'var(--ink-2)' : undefined }}>
          {ms == null ? '—' : formatLap(ms)}
        </div>
      </button>
    );
  };

  return (
    <main className="ph fixed ready">
      <div className="map">
        <RouteMap route={route} height="100%" padding={{ top: 130, bottom: 440, left: 40, right: 40 }} />
      </div>
      <div className="edge" />
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <button className="glass ib" aria-label="Close" onClick={() => goBack(nav, '/drive')}>
          <I n="x" />
        </button>
        <span className="glass chip ellipsis" style={{ height: 40, borderRadius: 20, maxWidth: '70%' }}>
          {route.name}
        </span>
      </div>
      <div className="glass sheet sheet-b" style={{ paddingTop: 18, bottom: 'calc(8px + var(--safe-b))' }}>
        <div className="lbl">Race against</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          {tile('record', 'Record', recordMs, { acc: true, enabled: posts.length > 0 })}
          {lapTile ? tile(lapTile.ref, lapTile.ref.startsWith('run:') ? lapTile.title : lapTile.title, lapTile.totalMs) : tile('none', 'Your best', null, { enabled: false })}
          {tile('best', 'Ideal', idealMs, { enabled: options.mine.length > 1 })}
          {tile('', 'Clock only', null)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '4px 6px 4px 16px', borderRadius: 26, background: tint }}>
          {route.startType === 'standing' ? (
            <>
              <span className="lbl" style={{ flex: 1 }}>Lights</span>
              <button className="ib" aria-label="Shorter" disabled={countdown <= 3} onClick={() => setCountdown(countdown - 1)}>
                <I n="minus" />
              </button>
              <b className="t" style={{ fontSize: 22, width: 36, textAlign: 'center' }} aria-live="polite">
                {countdown}s
              </b>
              <button className="ib" aria-label="Longer" disabled={countdown >= 10} onClick={() => setCountdown(countdown + 1)}>
                <I n="plus" />
              </button>
              <span style={{ width: 1, height: 26, background: 'color-mix(in srgb, var(--ink) 16%, transparent)' }} />
            </>
          ) : (
            <span className="lbl" style={{ flex: 1 }}>Rolling start</span>
          )}
          <button className="ib" aria-label={voice ? 'Voice callouts on' : 'Voice callouts off'} aria-pressed={voice} style={{ color: voice ? 'var(--main-hi)' : 'var(--ink-2)' }} onClick={() => setVoice(!voice)}>
            <I n={voice ? 'vol' : 'mute'} />
          </button>
          <button className="ib" aria-label="More options" style={{ color: 'var(--ink-2)' }} onClick={() => setMoreLaps(true)}>
            <I n="gear" />
          </button>
        </div>
        <div style={{ display: 'grid', justifyItems: 'center', marginTop: 18 }}>
          <button className="solid start-btn" style={{ width: 112, height: 112, borderRadius: '50%', fontSize: 21 }} disabled={starting} onClick={go} aria-label={`Start, racing ${chosen}`}>
            {starting ? 'GPS…' : 'Start'}
          </button>
        </div>
      </div>

      <Sheet open={moreLaps} onClose={() => setMoreLaps(false)} label="More options">
        <div style={{ display: 'grid', gap: 4 }}>
          <h2 className="title" style={{ fontSize: 24 }}>Race against</h2>
          <div className="rows">
            {all.map((o) => (
              <button key={o.ref} onClick={() => setRef(o.ref)} aria-pressed={ref === o.ref} style={{ gridTemplateColumns: '36px 1fr auto', textAlign: 'left' }}>
                {o.who ? <Avatar name={o.who.name} hue={o.who.hue} /> : <span className="av" style={{ background: 'var(--main)', color: 'var(--on-main)' }}>ME</span>}
                <div style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{o.title}</b>
                  <div className="lbl ellipsis">{o.sub}</div>
                </div>
                <span className={`t${ref === o.ref ? ' acc' : ''}`} style={{ fontSize: 19 }}>
                  {formatLap(o.totalMs)} {ref === o.ref && '✓'}
                </span>
              </button>
            ))}
          </div>
          <div className="lbl" style={{ marginTop: 14 }}>Setup</div>
          <div className="rows">
            <div style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <b>Start in delta only</b>
                <div className="lbl">Or turn the phone sideways while driving</div>
              </div>
              <Switch label="Start in delta only" checked={mode === 'delta'} onChange={(v) => setMode(v ? 'delta' : 'hud')} />
            </div>
            <div style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <b>Simulate the drive</b>
                <div className="lbl">Desk test with a generated GPS trace. Simulated laps can&rsquo;t be posted.</div>
              </div>
              <Switch label="Simulate the drive" checked={replay} onChange={setReplay} />
            </div>
            {replay &&
              [{ recordedAt: 0, fixes: [] as unknown[] }, ...routeLogs].map((l) => (
                <button key={l.recordedAt} onClick={() => setLogAt(l.recordedAt)} aria-pressed={logAt === l.recordedAt} style={{ gridTemplateColumns: '1fr auto', textAlign: 'left' }}>
                  <div>
                    <b>{l.recordedAt ? `Recorded ${new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Generated drive'}</b>
                    <div className="lbl">{l.recordedAt ? `Replays your real GPS log · ${l.fixes.length} fixes` : 'A synthetic trace along the route'}</div>
                  </div>
                  <span>{logAt === l.recordedAt ? '✓' : ''}</span>
                </button>
              ))}
          </div>
          <button className="solid" style={{ marginTop: 12 }} onClick={() => setMoreLaps(false)}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={terms} onClose={() => setTerms(false)} label="Before your first drive">
        <div style={{ display: 'grid', gap: 12 }}>
          <h2 className="title" style={{ fontSize: 24 }}>Before your first drive</h2>
          <p className="lbl" style={{ fontSize: 15 }}>Purple Sector is for track days and rally events.</p>
          <div className="rows">
            <div style={{ gridTemplateColumns: '24px 1fr' }}>
              <I n="flag" />
              <span>Only time yourself where timed driving is allowed and the road is closed to traffic.</span>
            </div>
            <div style={{ gridTemplateColumns: '24px 1fr' }}>
              <I n="user" />
              <span>You drive at your own risk and are responsible for following the rules of the venue and the law.</span>
            </div>
            <div style={{ gridTemplateColumns: '24px 1fr' }}>
              <I n="watch" />
              <span>Timing starts when you move off after GO. Moving more than 10 m before GO adds 5 s.</span>
            </div>
          </div>
          <button className="solid" onClick={acceptTerms}>
            I agree
          </button>
          <button className="solid quiet" onClick={() => setTerms(false)}>
            Not now
          </button>
        </div>
      </Sheet>
    </main>
  );
}
