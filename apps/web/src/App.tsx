import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loading, TabBar, ToastProvider } from './components/ui';
import { SessionProvider, useSession } from './lib/session';
import { onUsage, readUsage, type UsageState } from './lib/usage';
import { AuthScreen } from './screens/Auth';
import { LimitScreen } from './screens/LimitScreen';
import { Onboarding } from './screens/Onboarding';
import { Feed } from './screens/Feed';

// Heavier screens load on demand; the drive screen is preloaded on pre-drive.
const MapScreen = lazy(() => import('./screens/MapScreen'));
const Search = lazy(() => import('./screens/Search'));
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

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
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
          <Route path="map" element={<MapScreen />} />
          <Route path="search" element={<Search />} />
          <Route path="routes" element={<MyRoutes />} />
          <Route path="routes/new" element={<RouteBuilder />} />
          <Route path="r/:routeId" element={<RouteDetail />} />
          <Route path="r/:routeId/history" element={<RunHistory />} />
          <Route path="drive/:routeId" element={<PreDrive />} />
          <Route path="run/:runId" element={<RunSummary />} />
          <Route path="lap/:postId" element={<LapDetail />} />
          <Route path="compare/:routeId" element={<Compare />} />
          <Route path="u/:username" element={<UserPage />} />
          <Route path="u/:username/:list" element={<FollowList />} />
          <Route path="me" element={<Navigate to={`/u/${profile.username}`} replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function Shell() {
  const { isAdmin } = useSession();
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <div className="app">
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
      <TabBar admin={isAdmin} />
    </div>
  );
}
