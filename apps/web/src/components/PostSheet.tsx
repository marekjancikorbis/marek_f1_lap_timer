import { useEffect, useState } from 'react';
import { leaderboardFrom, notifyOvertaken, postLap, routePosts } from '../lib/data';
import { formatLap } from '../lib/format';
import { bigColoursFor, bigRecords, coloursFor, pbsBefore, recordsExcluding } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Route, Run, SectorColourName } from '../lib/types';
import { errorMessage, I, SectorStrip, Sheet, useToast } from './ui';

/** Post a lap to a public route: optional caption and car. */
export function PostSheet({ open, onClose, run, route, myRuns, onPosted }: { open: boolean; onClose: () => void; run: Run; route: Route; myRuns: Run[]; onPosted: () => void }) {
  const { profile } = useMe();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [car, setCar] = useState(() => localStorage.getItem('last-car') ?? '');
  const [busy, setBusy] = useState(false);
  // What goes public and where it would place, shown before posting.
  const [preview, setPreview] = useState<{ place: number; of: number; colours: SectorColourName[] } | null>(null);
  const stage = !route.isLoop;

  useEffect(() => {
    if (!open) return;
    let live = true;
    routePosts(route.id)
      .then((posts) => {
        const board = leaderboardFrom(posts);
        const mine = board.find((r) => r.post.userId === profile.id)?.post.totalMs ?? Infinity;
        const best = Math.min(run.totalMs, mine);
        const others = board.filter((r) => r.post.userId !== profile.id);
        const before = myRuns.filter((r) => r.id !== run.id && r.startedAt < run.startedAt);
        if (live)
          setPreview({
            place: 1 + others.filter((r) => r.post.totalMs < best).length,
            of: others.length + 1,
            colours: bigColoursFor(run.splitTimesMs, route, before, bigRecords(posts, route, run.id)),
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, route, run, myRuns, profile.id]);

  async function post() {
    setBusy(true);
    try {
      const posts = await routePosts(route.id);
      const n = route.boundaries.length;
      const records = recordsExcluding(posts, n, run.id);
      // Green where the lap beat the driver's best sectors from before it.
      const prev = myRuns.filter((r) => r.id !== run.id && r.valid && r.startedAt < run.startedAt).sort((a, b) => a.totalMs - b.totalMs)[0];
      const sectorColours = coloursFor(run.splitTimesMs, pbsBefore(myRuns, run), records);
      const before = myRuns.filter((r) => r.id !== run.id && r.startedAt < run.startedAt);
      const bigColours = bigColoursFor(run.splitTimesMs, route, before, bigRecords(posts, route, run.id));
      // Leaderboard position with this lap in: 1 + drivers whose best beats my best.
      const board = leaderboardFrom(posts);
      const oldBest = board.find((r) => r.post.userId === profile.id)?.post.totalMs ?? Infinity;
      const myBest = Math.min(run.totalMs, oldBest);
      // Ahead of me before, behind me now: best placed first.
      const overtaken = board.filter((r) => r.post.userId !== profile.id && r.post.totalMs > run.totalMs && r.post.totalMs < oldBest).map((r) => r.post);
      const positionAtPost = 1 + board.filter((r) => r.post.userId !== profile.id && r.post.totalMs < myBest).length;
      const isPB = !prev || run.totalMs < prev.totalMs;
      try {
        localStorage.setItem('last-car', car.trim());
      } catch {
        /* ignore */
      }
      await postLap(profile, run, route, { caption, car, sectorColours, bigColours, positionAtPost, isPB });
      void notifyOvertaken(profile, { id: run.id, routeId: route.id, routeName: route.name, totalMs: run.totalMs }, overtaken);
      toast(positionAtPost ? `Posted · P${positionAtPost}` : 'Posted');
      onPosted();
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label={stage ? 'Post time' : 'Post lap'}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="title" style={{ fontSize: 24 }}>{stage ? 'Post time' : 'Post lap'}</h2>
          <button className="ib" style={{ width: 40, height: 40 }} aria-label="Close" onClick={onClose}>
            <I n="x" />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 8, padding: 14, borderRadius: 20, background: 'color-mix(in srgb, var(--ink) 8%, transparent)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="lbl ellipsis">{route.name}</div>
            <div className="t" style={{ fontSize: 34, marginTop: 6 }}>{formatLap(run.totalMs)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="lbl">Leaderboard</div>
            <b className="t" style={{ fontSize: 22 }}>{preview ? `P${preview.place} of ${preview.of}` : '…'}</b>
          </div>
          {preview && preview.colours.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <SectorStrip colours={preview.colours} wide />
            </div>
          )}
        </div>
        <label className="field">
          <span className="visually-hidden">Car (optional)</span>
          <input maxLength={40} value={car} onChange={(e) => setCar(e.target.value)} placeholder="Car, e.g. E46 M3 (optional)" />
        </label>
        <label>
          <span className="visually-hidden">About this {stage ? 'run' : 'lap'} (optional)</span>
          <textarea className="field" rows={2} maxLength={280} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={`About this ${stage ? 'run' : 'lap'} (optional)`} />
        </label>
        <p className="lbl">Followers and this route&rsquo;s leaderboard see the time, sectors and car. The raw GPS trace is never shared. You can remove it any time.</p>
        <button className="solid" disabled={busy} onClick={post}>
          {busy ? 'Posting…' : stage ? 'Post time' : 'Post lap'}
        </button>
      </div>
    </Sheet>
  );
}
