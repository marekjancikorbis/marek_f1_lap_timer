import type { CSSProperties, ReactNode } from 'react';

/**
 * Loading sketches of each screen, built from the screens' own layout classes so the
 * grey blocks sit where the content will land. Sizes are the real content's, measured
 * on a 390 px phone.
 */

/** One grey block. */
function B({ w = '100%', h, r, style }: { w?: number | string; h: number | string; r?: number | string; style?: CSSProperties }) {
  return <span className="skeleton sk-b" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function Head({ title, back, right, h }: { title?: number; back?: boolean; right?: ReactNode; h?: number }) {
  return (
    <header className="screen-head">
      <div className="row grow">
        {back && <B w={26} h={26} r={8} />}
        {title && <B w={title} h={h ?? (back ? 24 : 30)} r={8} />}
      </div>
      {right}
    </header>
  );
}

const Title = ({ w = 110 }: { w?: number }) => (
  <h2 className="section-title">
    <B w={w} h={13} r={4} />
  </h2>
);

/** List rows: a picture and two lines, in the app's list box. */
export function SkeletonRows({ count = 6, h = 66, pic = 40, square, end, rank }: { count?: number; h?: number; pic?: number; square?: boolean; end?: boolean; rank?: boolean }) {
  return (
    <div className="list sk-card" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="list-item" style={{ height: h }}>
          {rank && <B w={22} h={26} r={4} />}
          <B w={pic} h={pic} r={square ? 8 : '50%'} />
          <span className="sk-lines">
            <B w={`${70 - (i % 3) * 15}%`} h={14} r={4} />
            <B w="35%" h={12} r={4} />
          </span>
          {end && <B w={64} h={20} r={4} />}
        </div>
      ))}
    </div>
  );
}

/** A feed card: who, route and time beside the shape, sector strip, the two actions. */
export function LapCardSkeleton({ author = true }: { author?: boolean }) {
  return (
    <div className="lap-card sk-card" aria-hidden="true">
      {author && (
        <div className="row lap-card-who">
          <B w={34} h={34} r="50%" />
          <B w={130} h={14} r={4} />
        </div>
      )}
      <div className="lap-card-body">
        <span className="lap-card-main">
          <B w={80} h={17} r={4} />
          <B w={170} h={44} r={8} />
          <B w={30} h={24} r={6} />
        </span>
        <B h={120} r={12} />
      </div>
      <B h={6} r={3} />
      <B w="40%" h={22} r={4} />
      <div className="lap-card-actions">
        <B h={44} r={12} />
        <B h={44} r={12} />
      </div>
    </div>
  );
}

function Feed() {
  return (
    <>
      <Head title={144} h={26} right={<B w={24} h={24} r="50%" style={{ margin: 10 }} />} />
      <div className="stack-lg">
        <LapCardSkeleton />
        <LapCardSkeleton />
      </div>
    </>
  );
}

function MyRoutes() {
  return (
    <>
      <Head title={100} />
      <B h={46} r={12} />
      <p className="statline">
        <B w={200} h={18} r={4} style={{ margin: '6px 0 5px' }} />
      </p>
      <SkeletonRows count={5} h={72} pic={48} square end />
    </>
  );
}

function DriveLauncher() {
  return (
    <>
      <Head title={290} />
      <Title />
      <SkeletonRows count={3} h={68} pic={48} square end />
      <B h={44} r={12} style={{ marginTop: 16 }} />
    </>
  );
}

function Profile() {
  return (
    <>
      <Head title={120} h={24} />
      <section className="profile-top">
        <B w={86} h={86} r="50%" />
        <div className="profile-counts">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ alignItems: 'center' }}>
              <B w={30} h={24} r={4} />
              <B w={56} h={12} r={4} style={{ marginTop: 3 }} />
            </span>
          ))}
        </div>
      </section>
      <section className="profile-bio">
        <B w={90} h={18} r={4} style={{ margin: '3px 0' }} />
        <B w={170} h={14} r={4} style={{ margin: '3px 0' }} />
        <B w={190} h={14} r={4} style={{ margin: '3px 0' }} />
      </section>
      <section className="heat">
        <B h={169} r={12} />
      </section>
      <div className="profile-tabs">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ flex: 1, height: 46, display: 'grid', placeItems: 'center' }}>
            <B w={60} h={14} r={4} />
          </span>
        ))}
      </div>
      <div className="stack-lg">
        <LapCardSkeleton author={false} />
      </div>
    </>
  );
}

function RouteDetail() {
  return (
    <>
      <section className="route-hero">
        <B h={270} r={0} />
      </section>
      <B h={44} r={12} style={{ marginBottom: 12 }} />
      <B h={46} r={12} />
      <div className="records">
        <B h={55} r={8} />
        <B h={55} r={8} />
        <B h={55} r={8} />
      </div>
      <SkeletonRows count={4} h={68} pic={32} end rank />
      <div className="sticky-cta">
        <B h={56} r={14} />
      </div>
    </>
  );
}

function RunHistory() {
  return (
    <>
      <Head back title={160} />
      <B w={220} h={16} r={4} style={{ margin: '-4px 0 19px' }} />
      <div className="stack" style={{ gap: 8 }}>
        <B h={76} r={16} />
        <B h={46} r={12} />
        <B h={141} r={16} />
        <B h={141} r={16} />
        <B h={141} r={16} />
      </div>
    </>
  );
}

/** A lap's page (posted or your own run): who, the big time card, then sectors. */
function Lap({ own }: { own?: boolean }) {
  return (
    <>
      <Head back title={140} />
      <div className="row" style={{ height: 43 }}>
        <B w={40} h={40} r="50%" />
        <span className="sk-lines">
          <B w={90} h={16} r={4} />
          <B w={80} h={13} r={4} />
        </span>
      </div>
      <B h={377} r={20} style={{ marginTop: 16 }} />
      {own ? (
        <>
          <B h={74} r={12} style={{ marginTop: 12 }} />
          <B h={112} r={16} style={{ marginTop: 16 }} />
        </>
      ) : (
        <>
          <B h={52} r={12} style={{ marginTop: 12 }} />
          <B h={56} r={12} style={{ marginTop: 16 }} />
          <div className="row" style={{ marginTop: 8 }}>
            <B h={44} r={12} style={{ flex: 1 }} />
            <B h={44} r={12} style={{ flex: 1 }} />
          </div>
        </>
      )}
      <div className="lap-tabs">
        <B h={46} r={12} />
      </div>
      <div className="dscale">
        <B h={14} r={4} style={{ margin: '2px 0 1px' }} />
      </div>
      <SkeletonRows count={3} h={70} pic={28} />
    </>
  );
}

function PreDrive() {
  return (
    <>
      <Head back title={180} />
      <p className="predrive-sub" style={{ padding: '3px 0' }}>
        <B w={220} h={16} r={4} />
      </p>
      <Title w={130} />
      <div className="stack" style={{ gap: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <B key={i} h={74} r={16} />
        ))}
      </div>
      <div className="sticky-cta predrive-cta">
        <B h={42} r={12} />
        <B h={56} r={14} />
        <B w={260} h={14} r={4} style={{ alignSelf: 'center', margin: '2px 0 3px' }} />
      </div>
    </>
  );
}

function Compare() {
  return (
    <>
      <Head back title={150} />
      <B w={200} h={16} r={4} style={{ margin: '-4px 0 3px' }} />
      <div className="cmp-head">
        <B h={87} r={12} />
        <B w={90} h={44} r={8} style={{ marginTop: 20 }} />
        <div className="sk-lines" style={{ alignItems: 'flex-end' }}>
          <B h={87} r={12} />
          <B w={60} h={18} r={4} style={{ marginTop: 14 }} />
        </div>
      </div>
      <div className="lap-tabs">
        <B h={46} r={12} />
      </div>
      <div className="dscale">
        <B h={14} r={4} style={{ margin: '2px 0 1px' }} />
      </div>
      <SkeletonRows count={3} h={70} pic={28} />
    </>
  );
}

/** People or notices: a titled list. */
function People({ sub }: { sub?: boolean }) {
  return (
    <>
      <Head back title={150} />
      {sub && <B w={80} h={16} r={4} style={{ margin: '-4px 0 19px' }} />}
      <SkeletonRows count={7} />
    </>
  );
}

function Generic() {
  return (
    <>
      <Head title={150} />
      <SkeletonRows count={7} />
    </>
  );
}

/** The sketch for the screen at this address. */
export function PageSkeleton({ path }: { path: string }) {
  const status = (
    <span className="visually-hidden" role="status">
      Loading
    </span>
  );
  // Explore is a full-screen map; the drive screen is full-screen and loads in a blink.
  if (path === '/explore' || /^\/drive\/[^/]+\/go/.test(path))
    return (
      <div className="map-screen">
        {status}
        {path === '/explore' && <B h="100%" r={0} />}
      </div>
    );
  const at = (re: RegExp) => re.test(path);
  const page = at(/^\/$/) ? <Feed />
    : at(/^\/routes\/?$/) ? <MyRoutes />
    : at(/^\/drive\/?$/) ? <DriveLauncher />
    : at(/^\/u\/[^/]+\/[^/]+/) ? <People sub />
    : at(/^\/u\//) ? <Profile />
    : at(/^\/r\/[^/]+\/history/) ? <RunHistory />
    : at(/^\/r\/[^/]+\/?$/) ? <RouteDetail />
    : at(/^\/lap\//) ? <Lap />
    : at(/^\/run\//) ? <Lap own />
    : at(/^\/drive\//) ? <PreDrive />
    : at(/^\/compare\//) ? <Compare />
    : at(/^\/notifications/) ? <People />
    : <Generic />;
  return (
    <div className="screen sk-screen" aria-busy="true">
      {status}
      {page}
    </div>
  );
}
