import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { dayKey } from '../lib/data';
import { formatDate } from '../lib/format';

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style grid of laps driven per day over the last year: weeks as columns, Monday on top. */
export function ActivityHeatmap({ days }: { days: Record<string, number> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  // Newest weeks are on the right: start scrolled there.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const cells: { date: Date; n: number; future: boolean }[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const future = date > today;
    // Deletes before the first count could leave a day below zero.
    cells.push({ date, future, n: future ? 0 : Math.max(0, days[dayKey(date.getTime())] ?? 0) });
  }
  const total = cells.reduce((s, c) => s + c.n, 0);
  const max = Math.max(1, ...cells.map((c) => c.n));
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const months = Array.from({ length: WEEKS }, (_, w) => {
    const first = cells[w * 7].date;
    const prev = w ? cells[(w - 1) * 7].date : null;
    return !prev || prev.getMonth() !== first.getMonth() ? MONTHS[first.getMonth()] : '';
  });
  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const i = (e.target as HTMLElement).dataset.i;
    if (i != null) setSel(Number(i));
  };
  const picked = sel != null ? cells[sel] : null;

  return (
    <section className="heat">
      <div className="heat-head">
        <h2 className="section-title">Activity</h2>
        <span className="mute num">
          {total} {total === 1 ? 'lap' : 'laps'} in the last year
        </span>
      </div>
      <div className="heat-scroll" ref={scroller}>
        <div className="heat-months" aria-hidden="true">
          {months.map((m, w) => (
            <span key={w}>{m}</span>
          ))}
        </div>
        <div className="heat-grid" role="img" aria-label={`${total} laps driven in the last year`} onClick={pick}>
          {cells.map((c, i) => (
            <i key={i} data-i={c.future ? undefined : i} className={c.future ? 'future' : `l${level(c.n)} ${i === sel ? 'sel' : ''}`} title={c.future ? undefined : `${c.n} on ${formatDate(c.date)}`} />
          ))}
        </div>
      </div>
      <div className="heat-foot">
        <span className="mute num" aria-live="polite">
          {picked ? `${picked.n} ${picked.n === 1 ? 'lap' : 'laps'} on ${formatDate(picked.date)}` : 'Tap a day'}
        </span>
        <span className="heat-legend" aria-hidden="true">
          Less <i className="l0" />
          <i className="l1" />
          <i className="l2" />
          <i className="l3" />
          <i className="l4" /> More
        </span>
      </div>
    </section>
  );
}
