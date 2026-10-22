import { serverTimestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar, Empty, errorMessage, Loading, ScreenHead, Segmented, Sheet, SectorStrip, Switch, useToast } from '../components/ui';
import { DEFAULT_COUNTDOWN_S } from '../lib/config';
import { getPost, getRoute, leaderboardFrom, routePosts, runsForRoute, sectorRecordsFrom, updateMyProfile } from '../lib/data';
import { formatDate, formatLap } from '../lib/format';
import { coloursFor, pbsBefore, racedSplits, resolveLap, type ResolvedLap } from '../lib/laps';
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
  /** Sector colours for the strip: as they were when the lap was driven. */
  colours?: SectorColourName[];
  who?: { name: string; hue?: number };
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

  const options = useMemo(() => {
    const mine: Option[] = [...runs]
      .sort((a, b) => a.totalMs - b.totalMs)
      .map((r, i) => ({
        ref: `run:${r.id}`,
        title: i === 0 ? 'Your PB' : 'Your lap',
        sub: `${formatDate(r.startedAt)}${r.replay ? ' · simulated' : ''}`,
        totalMs: r.totalMs,
        splits: r.splitTimesMs,
        colours: coloursFor(r.splitTimesMs, pbsBefore(runs, r), records, racedSplits(r, runs)),
      }));
    const theirs: Option[] = leaderboardFrom(posts)
      .filter((row) => row.post.userId !== profile.id)
      .slice(0, 20)
      .map(({ rank, post }) => ({
        ref: `post:${post.id}`,
        title: `P${rank} ${post.username}`,
        sub: post.car ?? formatDate(post.startedAt),
        totalMs: post.totalMs,
        splits: post.splitTimesMs,
        colours: post.sectorColours,
        who: { name: post.username, hue: post.avatarHue },
      }));
    if (extraPost && !theirs.some((t) => t.ref === `post:${extraPost.id}`)) {
      theirs.unshift({
        ref: `post:${extraPost.id}`,
        title: extraPost.username,
        sub: extraPost.caption ?? formatDate(extraPost.startedAt),
        totalMs: extraPost.totalMs,
        splits: extraPost.splitTimesMs,
        colours: extraPost.sectorColours,
        who: { name: extraPost.username, hue: extraPost.avatarHue },
      });
    }
    return { mine, theirs };
  }, [runs, posts, extraPost, profile.id, records]);

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
      setPendingDrive({ route, uid: profile.id, reference, records, personalBests: pbs, countdownS: countdown, mode, voice, replay, replayLog: replay ? routeLogs.find((l) => l.recordedAt === logAt) : null });
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
      {o.who ? <Avatar name={o.who.name} hue={o.who.hue} size={32} /> : <span className="ref-dot" />}
      <span className="grow" style={{ minWidth: 0 }}>
        <strong className="ellipsis">{o.title}</strong>
        <span className="mute ellipsis" style={{ display: 'block', fontSize: 13 }}>
          {o.sub}
        </span>
        {o.colours && <SectorStrip colours={o.colours} height={4} />}
      </span>
      <span className="num" style={{ fontSize: 20 }}>
        {formatLap(o.totalMs)}
      </span>
    </button>
  );

  return (
    <main className="screen">
      <ScreenHead back title="Drive" />
      <p className="mute" style={{ marginTop: -8 }}>
        {route.name} · {route.boundaries.length} sectors · {route.startType === 'standing' ? 'standing start' : 'rolling start'}
      </p>

      <h2 className="section-title">Race against</h2>
      <div className="stack" style={{ gap: 8 }}>
        <button className={`ref-option ${ref === '' ? 'on' : ''}`} onClick={() => setRef('')} aria-pressed={ref === ''}>
          <span className="ref-dot" />
          <span className="grow">
            <strong>No reference</strong>
            <span className="mute" style={{ display: 'block', fontSize: 13 }}>
              Just the clock and sector colours
            </span>
          </span>
        </button>
        {options.mine.length > 0 && options.mine.slice(0, 6).map(renderOption)}
        {options.mine.length > 1 && (
          <button className={`ref-option ${ref === 'best' ? 'on' : ''}`} onClick={() => setRef('best')} aria-pressed={ref === 'best'}>
            <span className="ref-dot purple" />
            <span className="grow">
              <strong>Theoretical best</strong>
              <span className="mute" style={{ display: 'block', fontSize: 13 }}>
                Your best time in every sector
              </span>
            </span>
          </button>
        )}
        {posts.length > 0 && (
          <button className={`ref-option ${ref === 'record' ? 'on' : ''}`} onClick={() => setRef('record')} aria-pressed={ref === 'record'}>
            <span className="ref-dot purple" />
            <span className="grow">
              <strong>Route record</strong>
              <span className="mute" style={{ display: 'block', fontSize: 13 }}>
                Every purple sector added up
              </span>
            </span>
          </button>
        )}
        {options.theirs.length > 0 && <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>Posted laps</p>}
        {options.theirs.map(renderOption)}
      </div>

      <h2 className="section-title">Screen</h2>
      <Segmented
        label="Drive screen"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'hud', label: 'Full HUD' },
          { value: 'delta', label: 'Delta only' },
        ]}
      />

      {route.startType === 'standing' && (
        <div className="panel stack" style={{ marginTop: 12 }}>
          <label className="field">
            <span>
              Countdown <strong className="num" style={{ fontSize: 18 }}>{countdown} s</strong>
            </span>
            <input type="range" min={3} max={10} step={1} value={countdown} onChange={(e) => setCountdown(Number(e.target.value))} />
          </label>
          <small className="mute">Timing starts when you move off after GO. Moving more than 10 m before GO adds 5 s.</small>
        </div>
      )}

      <div className="list" style={{ marginTop: 12 }}>
        <div className="list-item">
          <span className="grow">
            <strong>Voice callouts</strong>
            <span className="mute" style={{ display: 'block', fontSize: 13 }}>
              “Sector 3, minus zero point four”
            </span>
          </span>
          <Switch label="Voice callouts" checked={voice} onChange={setVoice} />
        </div>
        <div className="list-item">
          <span className="grow">
            <strong>Simulate the drive</strong>
            <span className="mute" style={{ display: 'block', fontSize: 13 }}>
              Desk test with a generated GPS trace. Simulated laps can't be posted.
            </span>
          </span>
          <Switch label="Simulate the drive" checked={replay} onChange={setReplay} />
        </div>
      </div>
      {replay && routeLogs.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {[{ recordedAt: 0, fixes: [] }, ...routeLogs].map((l) => (
            <button key={l.recordedAt} className={`ref-option ${logAt === l.recordedAt ? 'on' : ''}`} onClick={() => setLogAt(l.recordedAt)} aria-pressed={logAt === l.recordedAt}>
              <span className="ref-dot" />
              <span className="grow">
                <strong>{l.recordedAt ? `Recorded ${new Date(l.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Generated drive'}</strong>
                <span className="mute" style={{ display: 'block', fontSize: 13 }}>
                  {l.recordedAt ? `Replays your real GPS log · ${l.fixes.length} fixes` : 'A synthetic trace along the route'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <button className="btn purple lg block" style={{ marginTop: 24 }} disabled={starting} onClick={go}>
        {starting ? 'Getting GPS…' : 'Start'}
      </button>
      <p className="mute" style={{ fontSize: 13, textAlign: 'center', marginTop: 10 }}>
        Mount the phone first. The screen stays on and needs no taps while moving.
      </p>

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
