import type { UsageState } from '../lib/usage';

/**
 * Shown when the Mapbox cap for the period is reached. The app stays
 * unusable until the period resets, so nobody ever goes past the free tier.
 */
export function LimitScreen({ usage }: { usage: UsageState }) {
  const when = usage.resetsAt.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <main className="ph soft col">
      <div className="sb" />
      <div style={{ margin: '180px 28px 0', textAlign: 'center' }}>
        <div className="k">Maps back on</div>
        <div className="t acc" style={{ fontSize: 120, marginTop: 12, fontStretch: '70%' }} title={when}>
          {usage.resetsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </div>
        <h1 className="h1" style={{ marginTop: 28, fontSize: 26 }}>Monthly map limit reached</h1>
        <p className="sub" style={{ fontSize: 15, marginTop: 10 }}>
          Your laps and routes are safe.
        </p>
      </div>
    </main>
  );
}
