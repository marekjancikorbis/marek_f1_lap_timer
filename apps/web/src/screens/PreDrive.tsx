import { serverTimestamp } from 'firebase/firestore';
import { Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, Segmented, Sheet, SectorStrip, Switch, useToast } from '../components/ui';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getPost, getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom, updateMyProfile } from '../lib/data';
import { formatDate, formatDistance, formatLap } from '../lib/format';
import { bigColoursFor, bigRecords, postBigColours, racedSplits, resolveLap, toBig, type ResolvedLap } from '../lib/laps';
import { bestSectors } from '@laptimer/timing';
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
  const bigPbs = useMemo(() => (route ? bestSectors(toBig(runs, route)) : []), [runs, route]);

  const options = useMemo(() => {
    const mine: Option[] = [...runs]
      .sort((a, b) => a.totalMs - b.totalMs)
      .map((r, i) => ({
        ref: `run:${r.id}`,
        title: i === 0 ? 'Your best' : 'Your lap',
        sub: `${formatDate(r.startedAt)}${r.replay ? ' · simulated' : ''}`,
        totalMs: r.totalMs,
        splits: r.splitTimesMs,
        colours: route ? bigColoursFor(r.splitTimesMs, route, runs.filter((x) => x.startedAt < r.startedAt), bigRecs, racedSplits(r, runs)) : [],
      }));
    const theirs: Option[] = leaderboardFrom(posts)
      .filter((row) => row.post.userId !== profile.id)
      .slice(0, 20)
      .map(({ rank, post }) => ({
        ref: `post:${post.id}`,
        title: post.username,
        sub: [`P${rank}`, formatDate(post.startedAt), post.car].filter(Boolean).join(' · '),
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
        sub: [formatDate(extraPost.startedAt), extraPost.car].filter(Boolean).join(' · '),
        totalMs: extraPost.totalMs,
        splits: extraPost.splitTimesMs,
        colours: postBigColours(extraPost, route),
        who: { name: extraPost.username, hue: extraPost.avatarHue },
      });
    }
    return { mine, theirs };
  }, [runs, posts, extraPost, profile.id, route, bigRecs]);

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
      <main className="screen">
        <ScreenHead back />
        <Empty title="Route not available" />
      </main>
    );

  const renderOption = (o: Option) => (
    <button key={o.ref} className={`ref-option ${ref === o.ref ? 'on' : ''}`} onClick={() => setRef(o.ref)} aria-pressed={ref === o.ref}>
      <span className="radio" aria-hidden="true" />
      {o.who ? <Avatar name={o.who.name} hue={o.who.hue} size={30} /> : <span className={`ref-dot ${o.fastest ? 'purple' : ''}`} />}
      <span className="grow" style={{ minWidth: 0 }}>
        <strong className="ellipsis">{o.title}</strong>
        <span className="mute ellipsis small-text">{o.sub}</span>
        {o.colours && o.colours.length > 0 && <SectorStrip colours={o.colours} height={4} />}
      </span>
      {o.totalMs != null && <span className={`num ref-time ${o.fastest ? 'fastest' : ''}`}>{formatLap(o.totalMs)}</span>}
    </button>
  );

  const all = [...options.mine, ...options.theirs];
  const chosen =
    ref === ''
      ? 'just the clock'
      : ref === 'best'
        ? 'your theoretical best'
        : ref === 'record'
          ? 'the route record'
          : (() => {
              const o = all.find((x) => x.ref === ref);
              return o ? `${o.ref.startsWith('run:') ? o.title.toLowerCase() : o.title}, ${formatLap(o.totalMs)}` : 'the chosen lap';
            })();

  return (
    <main className="screen predrive with-cta">
      <ScreenHead back title={route.name} />
      <p className="mute predrive-sub">
        3 sectors · {route.startType === 'standing' ? 'standing start' : 'rolling start'} · {formatDistance(route.lengthM)}
      </p>

      <h2 className="section-title">Race against</h2>
      <div className="stack" style={{ gap: 8 }}>
        {options.mine.slice(0, 6).map(renderOption)}
        {options.mine.length > 1 && renderOption({ ref: 'best', title: 'Theoretical best', sub: 'Your best time in each sector', totalMs: null, splits: null, fastest: false })}
        {posts.length > 0 && renderOption({ ref: 'record', title: 'Route record', sub: 'The fastest time in every sector added up', totalMs: null, splits: null, fastest: true })}
        {options.theirs.length > 0 && <p className="mute small-text" style={{ marginTop: 8 }}>Posted laps</p>}
        {options.theirs.map(renderOption)}
        {renderOption({ ref: '', title: 'No reference', sub: 'Just the clock and sector colours', totalMs: null, splits: null })}
      </div>

      <h2 className="section-title">Setup</h2>
      <div className="list">
        {route.startType === 'standing' && (
          <label className="list-item predrive-countdown">
            <span className="grow">
              <strong>Countdown</strong>
              <span className="mute small-text">Timing starts when you move off after GO. Moving more than 10 m before GO adds 5 s.</span>
              <input type="range" min={3} max={10} step={1} value={countdown} onChange={(e) => setCountdown(Number(e.target.value))} aria-label="Countdown seconds" />
            </span>
            <strong className="num ref-time">{countdown} s</strong>
          </label>
        )}
        <div className="list-item">
          <span className="grow">
            <strong>Screen</strong>
            <span className="mute small-text">Turn sideways for delta only</span>
          </span>
          <Segmented
            label="Drive screen"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'hud', label: 'Full HUD' },
              { value: 'delta', label: 'Delta only' },
            ]}
          />
        </div>
        <div className="list-item">
          <span className="grow">
            <strong>Voice callouts</strong>
            <span className="mute small-text">“Sector 2, minus zero point four”</span>
          </span>
          <Switch label="Voice callouts" checked={voice} onChange={setVoice} />
        </div>
        <div className="list-item">
          <span className="grow">
            <strong>Simulate the drive</strong>
            <span className="mute small-text">Desk test with a generated GPS trace. Simulated laps can't be posted.</span>
          </span>
          <Switch label="Simulate the drive" checked={replay} onChange={setReplay} />
        </div>
      </div>
      {replay && routeLogs.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {[{ recordedAt: 0, fixes: [] }, ...routeLogs].map((l) => (
            <button key={l.recordedAt} className={`ref-option ${logAt === l.recordedAt ? 'on' : ''}`} onClick={() => setLogAt(l.recordedAt)} aria-pressed={logAt === l.recordedAt}>
              <span className="radio" aria-hidden="true" />
              <span className="grow">
                <strong>{l.recordedAt ? `Recorded ${new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Generated drive'}</strong>
                <span className="mute small-text">{l.recordedAt ? `Replays your real GPS log · ${l.fixes.length} fixes` : 'A synthetic trace along the route'}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="sticky-cta predrive-cta">
        <p className="predrive-summary">
          Racing <strong>{chosen}</strong>
        </p>
        <button className="btn primary lg block" disabled={starting} onClick={go}>
          <Play size={18} fill="currentColor" aria-hidden="true" /> {starting ? 'Getting GPS…' : 'Start'}
        </button>
        <p className="mute small-text" style={{ textAlign: 'center' }}>
          Mount the phone first. The screen stays on and needs no taps while moving.
        </p>
      </div>

      <Sheet open={terms} onClose={() => setTerms(false)} label="Before your first drive">
        <div className="stack">
          <h2>Before your first drive</h2>
          <p>Purple Sector is for track days and rally events.</p>
          <ul className="terms">
            <li>Only time yourself where timed driving is allowed and the road is closed to traffic.</li>
            <li>Mount the phone. Don't touch it while moving; the app needs no taps.</li>
            <li>You drive at your own risk and are responsible for following the rules of the venue and the law.</li>
          </ul>
          <button className="btn primary lg block" onClick={acceptTerms}>
            I agree
          </button>
          <button className="btn block" onClick={() => setTerms(false)}>
            Not now
          </button>
        </div>
      </Sheet>
    </main>
  );
}
