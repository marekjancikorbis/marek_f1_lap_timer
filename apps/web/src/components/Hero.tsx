/**
 * Sign-in hero: the wordmark over an illustrative circuit painted in sector
 * colours, which is exactly what every lap in the app becomes.
 */
export function Hero() {
  return (
    <div className="hero">
      <svg className="hero-track" viewBox="0 0 400 220" aria-hidden="true">
        <defs>
          <path
            id="hero-lap"
            d="M60 160 C40 120 50 70 95 55 S170 60 190 40 S270 20 300 50 S360 110 330 150 S250 170 220 180 S120 200 60 160Z"
          />
        </defs>
        <use href="#hero-lap" fill="none" stroke="#0c0d0e" strokeWidth="22" strokeLinejoin="round" />
        <use href="#hero-lap" fill="none" stroke="var(--yellow)" strokeWidth="11" strokeLinejoin="round" pathLength="100" strokeDasharray="100" />
        <use href="#hero-lap" fill="none" stroke="var(--green)" strokeWidth="11" strokeLinejoin="round" pathLength="100" strokeDasharray="66 100" />
        <use href="#hero-lap" className="hero-purple" fill="none" stroke="var(--purple)" strokeWidth="11" strokeLinejoin="round" pathLength="100" strokeDasharray="33 100" />
        <rect x="48" y="148" width="24" height="24" rx="5" fill="var(--ink)" stroke="#0c0d0e" strokeWidth="4" />
      </svg>
      <h1 className="wordmark">
        Purple <span>Sector</span>
      </h1>
      <p className="hero-sub">Lap timing with a live sector delta, for track days and rally events.</p>
    </div>
  );
}
