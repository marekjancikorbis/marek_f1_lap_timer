import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loading, TabBar, ToastProvider } from './components/ui';
import { SessionProvider, useSession } from './lib/session';
import { onUsage, readUsage, type UsageState } from './lib/usage';

// Screens load on demand, so the first download is only the shell; the drive screen is preloaded on pre-drive.
const AuthScreen = lazy(() => import('./screens/Auth').then((m) => ({ default: m.AuthScreen })));
const LimitScreen = lazy(() => import('./screens/LimitScreen').then((m) => ({ default: m.LimitScreen })));
const Onboarding = lazy(() => import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })));
const Feed = lazy(() => import('./screens/Feed').then((m) => ({ default: m.Feed })));
const MapScreen = lazy(() => import('./screens/MapScreen'));
const DriveLauncher = lazy(() => import('./screens/DriveLauncher'));
const MyRoutes = lazy(() => import('./screens/MyRoutes'));
const RouteBuilder = lazy(() => import('./screens/RouteBuilder'));
const RouteDetail = lazy(() => import('./screens/RouteDetail'));
const RunHistory = lazy(() => import('./screens/RunHistory'));
const PreDrive = lazy(() => import('./screens/PreDrive'));
const Drive = lazy(() => import('./screens/Drive'));
const RunSummary = lazy(() => import('./screens/RunSummary'));
const LapDetail = lazy(() => import('./screens/LapDetail'));
const Compare = lazy(() => import('./screens/Compare'));
const UserPage = lazy(() => import('./screens/UserPage'));
const FollowList = lazy(() => import('./screens/FollowList'));
const Settings = lazy(() => import('./screens/Settings'));
const Admin = lazy(() => import('./screens/Admin'));
const Notifications = lazy(() => import('./screens/Notifications'));

export function App() {
  return (
    <Crashed>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <Suspense fallback={<Loading />}>
              <Gate />
            </Suspense>
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </Crashed>
  );
}

/**
 * Last resort instead of a blank screen. Also catches a stale tab after a deploy,
 * whose old lazy chunks are gone: reloading fetches the new build.
 */
class Crashed extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen" role="alert">
        <div className="empty">
          <h2>Something went wrong</h2>
          <p>Your saved laps are safe. Reload to carry on.</p>
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}

function Gate() {
  const { user, profile } = useSession();
  const [usage, setUsage] = useState<UsageState | null>(null);

  useEffect(() => onUsage(setUsage), []);
  useEffect(() => {
    if (profile) readUsage().catch(() => undefined);
  }, [profile]);

  if (user === undefined || (user && profile === undefined)) return <Loading />;
  if (!user) return <AuthScreen />;
  if (!profile) return <Onboarding />;
  if (usage?.exhausted) return <LimitScreen usage={usage} />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Full-screen flows without the tab bar */}
        <Route path="/drive/:routeId/go" element={<Drive />} />
        <Route element={<Shell />}>
          <Route index element={<Feed />} />
          {/* Drawn by the shell, which keeps it loaded. */}
          <Route path="explore" element={null} />
          <Route path="drive" element={<DriveLauncher />} />
          <Route path="routes" element={<MyRoutes />} />
          {/* Old addresses: before Explore, and when Routes was called My times. */}
          <Route path="map" element={<Navigate to="/explore" replace />} />
          <Route path="search" element={<Navigate to="/explore" replace />} />
          <Route path="times" element={<Navigate to="/routes" replace />} />
          <Route path="routes/new" element={<RouteBuilder />} />
          <Route path="r/:routeId" element={<RouteDetail />} />
          <Route path="r/:routeId/edit" element={<RouteBuilder />} />
          <Route path="r/:routeId/history" element={<RunHistory />} />
          <Route path="drive/:routeId" element={<PreDrive />} />
          <Route path="run/:runId" element={<RunSummary />} />
          <Route path="lap/:postId" element={<LapDetail />} />
          <Route path="compare/:routeId" element={<Compare />} />
          <Route path="u/:username" element={<UserPage />} />
          <Route path="u/:username/:list" element={<FollowList />} />
          <Route path="me" element={<Navigate to={`/u/${profile.username}`} replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const onExplore = pathname === '/explore';
  // Explore's map loads shortly after the first screen and then stays, so the tab opens instantly.
  const [keepMap, setKeepMap] = useState(false);
  useEffect(() => {
    if (onExplore) {
      setKeepMap(true);
      return;
    }
    const t = window.setTimeout(() => setKeepMap(true), 1500);
    return () => window.clearTimeout(t);
  }, [onExplore]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="app">
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
      {(keepMap || onExplore) && (
        <Suspense fallback={onExplore ? <Loading /> : null}>
          <MapScreen visible={onExplore} />
        </Suspense>
      )}
      <TabBar />
    </div>
  );
}
