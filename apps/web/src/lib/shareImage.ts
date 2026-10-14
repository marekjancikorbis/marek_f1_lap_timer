import { shapeGeometry } from '../components/RouteShape';
import { formatDelta, formatLap, formatSeconds } from './format';
import type { Route, SectorColourName } from './types';

export interface ShareLap {
  route: Pick<Route, 'id' | 'coords' | 'boundaries' | 'isLoop' | 'name'>;
  username: string;
  date: string;
  totalMs: number;
  penaltyMs: number;
  colours: (SectorColourName | null)[];
  /** e.g. "-0.412 vs PB" */
  delta: { ms: number; label: string } | null;
}

const W = 1080;
const H = 1350;

/** Draw a lap as a 4:5 PNG card in the app's own colours, with no map tiles. */
export async function lapImage(lap: ShareLap): Promise<Blob> {
  // Canvas text doesn't trigger webfont loading, so load the faces it uses first.
  await Promise.all(
    ["600 34px 'Barlow Condensed'", "600 64px 'Barlow'", "500 44px 'Barlow'"].map((f) => document.fonts.load(f).catch(() => [])),
  );
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const flag = (c: SectorColourName | null) => (c ? v(`--${c}`) : v('--ink-2'));

  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = v('--tarmac');
  ctx.fillRect(0, 0, W, H);

  // Sector strip across the top edge, like the cards in the app.
  const n = Math.max(1, lap.colours.length);
  lap.colours.forEach((c, i) => {
    ctx.fillStyle = flag(c);
    ctx.fillRect((i * W) / n, 0, W / n - (i < n - 1 ? 4 : 0), 18);
  });

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = v('--mute');
  ctx.font = `600 34px 'Barlow Condensed', sans-serif`;
  ctx.fillText('PURPLE SECTOR', 72, 110);
  ctx.textAlign = 'right';
  ctx.fillText(lap.date, W - 72, 110);
  ctx.textAlign = 'left';

  ctx.fillStyle = v('--ink');
  ctx.font = `600 64px 'Barlow', sans-serif`;
  ctx.fillText(fit(ctx, lap.route.name, W - 144), 72, 200);

  // Shrink for long times (10:00+) so the number never runs off the card.
  for (let size = 330; size > 120; size -= 10) {
    ctx.font = `600 ${size}px 'Barlow Condensed', sans-serif`;
    if (ctx.measureText(formatLap(lap.totalMs)).width <= W - 120) break;
  }
  ctx.fillText(formatLap(lap.totalMs), 60, 470);

  let x = 72;
  const badge = (text: string, colour: string) => {
    ctx.font = `600 38px 'Barlow Condensed', sans-serif`;
    const w = ctx.measureText(text).width + 40;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x, 510, w, 60, 12);
    ctx.fill();
    ctx.fillStyle = v('--tarmac');
    ctx.fillText(text, x + 20, 553);
    x += w + 16;
  };
  if (lap.delta) badge(`${formatDelta(lap.delta.ms, 3)} vs ${lap.delta.label}`, lap.delta.ms < 0 ? v('--green') : v('--ink-2'));
  if (lap.penaltyMs > 0) badge(`incl. +${formatSeconds(lap.penaltyMs, 3)} jump start`, v('--red'));

  const g = shapeGeometry(lap.route, W, 600, 90);
  if (g) {
    ctx.save();
    ctx.translate(0, 610 + (600 - g.H) / 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stroke = (pts: readonly (readonly [number, number])[]) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    };
    ctx.strokeStyle = '#0c0d0e';
    ctx.lineWidth = 30;
    g.lines.forEach(stroke);
    ctx.lineWidth = 16;
    g.lines.forEach((line, i) => {
      ctx.strokeStyle = flag(lap.colours[i] ?? null);
      stroke(line);
    });
    ctx.fillStyle = v('--ink');
    ctx.beginPath();
    ctx.arc(g.start[0], g.start[1], 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = v('--ink-2');
  ctx.font = `500 44px 'Barlow', sans-serif`;
  ctx.fillText(fit(ctx, `@${lap.username}`, W - 144), 72, H - 72);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image.'))), 'image/png'));
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Share sheet with the image where the browser supports files; otherwise download it. */
export async function shareLap(lap: ShareLap): Promise<void> {
  const blob = await lapImage(lap);
  const file = new File([blob], `${lap.route.name.replace(/[^\w-]+/g, '_')}-${formatLap(lap.totalMs).replace(/[:.]/g, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${formatLap(lap.totalMs)} on ${lap.route.name}` });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
