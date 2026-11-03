/** Sign-in hero: the navy panel with the brand stripe and the wordmark, as in the Livery mockups. */
export function Hero() {
  return (
    <div className="hero navy">
      <span className="livery" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="hero-body">
        <h1 className="wordmark">
          Purple
          <br />
          Sector
        </h1>
        <p className="hero-sub">Time your drives on tracks and closed roads, and race the lap you want to beat.</p>
      </div>
    </div>
  );
}
