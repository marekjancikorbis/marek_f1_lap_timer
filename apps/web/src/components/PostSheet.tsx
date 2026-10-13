import { useState } from 'react';
import { leaderboardFrom, postLap, routePosts } from '../lib/data';
import { formatLap } from '../lib/format';
import { coloursFor, recordsExcluding } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Route, Run } from '../lib/types';
import { errorMessage, Sheet, useToast } from './ui';

/** Post a lap to a public route: optional caption and car. */
export function PostSheet({ open, onClose, run, route, myRuns, onPosted }: { open: boolean; onClose: () => void; run: Run; route: Route; myRuns: Run[]; onPosted: () => void }) {
  const { profile } = useMe();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [car, setCar] = useState(() => localStorage.getItem('last-car') ?? '');
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    try {
      const posts = await routePosts(route.id);
      const n = route.boundaries.length;
      const records = recordsExcluding(posts, n, run.id);
      // Green against the driver's previous best lap on this route.
      const prev = myRuns.filter((r) => r.id !== run.id && r.valid && r.startedAt < run.startedAt).sort((a, b) => a.totalMs - b.totalMs)[0];
      const sectorColours = coloursFor(run.splitTimesMs, prev?.splitTimesMs ?? null, records);
      // Leaderboard position with this lap in: 1 + drivers whose best beats my best.
      const board = leaderboardFrom(posts);
      const myBest = Math.min(run.totalMs, board.find((r) => r.post.userId === profile.id)?.post.totalMs ?? Infinity);
      const positionAtPost = 1 + board.filter((r) => r.post.userId !== profile.id && r.post.totalMs < myBest).length;
      const isPB = !prev || run.totalMs < prev.totalMs;
      try {
        localStorage.setItem('last-car', car.trim());
      } catch {
        /* ignore */
      }
      await postLap(profile, run, route, { caption, car, sectorColours, positionAtPost, isPB });
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
    <Sheet open={open} onClose={onClose} label="Post lap">
      <div className="stack">
        <h2>Post {formatLap(run.totalMs)}</h2>
        <p className="mute">It goes on the {route.name} leaderboard, your profile and your followers' feeds. You can remove it any time.</p>
        <label className="field">
          <span>Caption (optional)</span>
          <input className="input" maxLength={280} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Finally under 2:09" />
        </label>
        <label className="field">
          <span>Car (optional)</span>
          <input className="input" maxLength={40} value={car} onChange={(e) => setCar(e.target.value)} placeholder="e.g. E46 M3" />
        </label>
        <button className="btn purple lg block" disabled={busy} onClick={post}>
          {busy ? 'Posting…' : 'Post lap'}
        </button>
      </div>
    </Sheet>
  );
}
