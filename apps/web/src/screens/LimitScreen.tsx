import type { UsageState } from '../lib/usage';

/**
 * Shown when the Mapbox cap for the period is reached. The app stays
 * unusable until the period resets, so nobody ever goes past the free tier.
 */
export function LimitScreen({ usage }: { usage: UsageState }) {
  const when = usage.resetsAt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = usage.resetsAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <main className="limit">
      <div className="limit-flag" aria-hidden="true" />
      <h1>Monthly limit reached</h1>
      <p>
        Purple Sector has used this month's free map {usage.exhausted === 'directions' ? 'routing' : 'loads'}. To keep the app
        free, it pauses until the limit resets.
      </p>
      <p className="limit-date">
        Back on <strong>{when}</strong> at {time}
      </p>
    </main>
  );
}
