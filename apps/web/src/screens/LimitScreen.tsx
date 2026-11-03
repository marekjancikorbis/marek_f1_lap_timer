import type { UsageState } from '../lib/usage';

/**
 * Shown when the Mapbox cap for the period is reached. The app stays
 * unusable until the period resets, so nobody ever goes past the free tier.
 */
export function LimitScreen({ usage }: { usage: UsageState }) {
  const when = usage.resetsAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = usage.resetsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <main className="limit navy">
      <span className="livery" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="limit-body">
        <div className="num limit-day">{usage.resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        <div className="cap">Maps back on · {time}</div>
        <h1>Monthly limit reached</h1>
        <p>
          The map service is shared by everyone and capped to stay free. This month's free map {usage.exhausted === 'directions' ? 'routing' : 'loads'} are used up; it
          resets on {when}.
        </p>
        <p>Your laps and routes are safe.</p>
      </div>
    </main>
  );
}
