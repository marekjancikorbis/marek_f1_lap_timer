import type { UsageState } from '../lib/usage';

/**
 * Shown when the Mapbox cap for the period is reached. The app stays
 * unusable until the period resets, so nobody ever goes past the free tier.
 */
export function LimitScreen({ usage }: { usage: UsageState }) {
  const when = usage.resetsAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = usage.resetsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <main className="ph soft col">
      <div className="sb" />
      <div style={{ margin: 'auto 28px', textAlign: 'center' }}>
        <div className="lbl" style={{ fontSize: 15 }}>Maps back on · {time}</div>
        <div className="t acc" style={{ fontSize: 96, marginTop: 10 }}>{usage.resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        <h1 className="title" style={{ marginTop: 28, fontSize: 26 }}>Monthly limit reached</h1>
        <p className="lbl" style={{ fontSize: 15, marginTop: 10 }}>
          Your laps and routes are safe. The map service is shared by everyone and capped to stay free: this month&rsquo;s free map{' '}
          {usage.exhausted === 'directions' ? 'routing is' : 'loads are'} used up. It resets on {when}.
        </p>
      </div>
    </main>
  );
}
