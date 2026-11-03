import { dayKey } from '../lib/data';

const WEEKS = 12;

/** Driving days over the last 12 weeks: one cell per week, darker the more days driven. */
export function ActivityHeatmap({ days }: { days: Record<string, number> }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const weeks = Array.from({ length: WEEKS }, (_, w) => {
    let driven = 0;
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      // Deletes before the first count could leave a day below zero.
      if (date <= today && (days[dayKey(date.getTime())] ?? 0) > 0) driven++;
    }
    return driven;
  });
  const total = weeks.reduce((s, n) => s + n, 0);

  return (
    <section className="panel heat">
      <span className="cap">Driving days · last 12 weeks</span>
      <div className="heat-weeks" role="img" aria-label={`${total} driving ${total === 1 ? 'day' : 'days'} in the last 12 weeks`}>
        {weeks.map((n, i) => (
          <i key={i} className={`l${Math.min(2, n)}`} />
        ))}
      </div>
    </section>
  );
}
