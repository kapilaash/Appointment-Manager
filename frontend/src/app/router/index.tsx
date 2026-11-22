/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, type ReactNode } from 'react';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useRouteError } from 'react-router-dom';
import { App } from '../../components/layout/App';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { useMeQuery } from '../../features/auth/api';
import { isChunkLoadError, reloadForNewRelease } from '../../observability/chunkRecovery';
import { reportError } from '../../observability/errorReporting';

const DashboardPage = lazy(() => import('../../features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const BookingPage = lazy(() => import('../../features/appointments/BookingPage').then((module) => ({ default: module.BookingPage })));
const PublicBookingPage = lazy(() => import('../../features/appointments/PublicBookingPage').then((module) => ({ default: module.PublicBookingPage })));
const CalendarPage = lazy(() => import('../../features/appointments/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const AppointmentsPage = lazy(() => import('../../features/appointments/AppointmentsPage').then((module) => ({ default: module.AppointmentsPage })));
const AvailabilityPage = lazy(() => import('../../features/availability/AvailabilityPage').then((module) => ({ default: module.AvailabilityPage })));
const InstructorsPage = lazy(() => import('../../features/instructors/InstructorsPage').then((module) => ({ default: module.InstructorsPage })));
const SettingsPage = lazy(() => import('../../features/dashboard/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const StudentsPage = lazy(() => import('../../features/students/StudentsPage').then((module) => ({ default: module.StudentsPage })));
const CoachAdminPage = lazy(() => import('../../features/coaches/CoachAdminPage').then((module) => ({ default: module.CoachAdminPage })));
const CoachRegistrationPage = lazy(() => import('../../features/coaches/CoachRegistrationPage').then((module) => ({ default: module.CoachRegistrationPage })));
const CoachPasswordResetPage = lazy(() => import('../../features/coaches/CoachPasswordResetPage').then((module) => ({ default: module.CoachPasswordResetPage })));
const CoachForgotPasswordPage = lazy(() => import('../../features/coaches/CoachForgotPasswordPage').then((module) => ({ default: module.CoachForgotPasswordPage })));
const ProfilePage = lazy(() => import('../../features/auth/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const RequestsPage = lazy(() => import('../../features/requests/RequestsPage').then((module) => ({ default: module.RequestsPage })));
const HelpPage = lazy(() => import('../../features/help/HelpPage').then((module) => ({ default: module.HelpPage })));

// This helper belongs beside the router so all lazy pages share the same loading state.
function RouteBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div role="status" aria-label="Loading page"><PageSkeleton /></div>}>{children}</Suspense>;
}

function Home() {
  const { data } = useMeQuery();
  return data ? <DashboardPage user={data} /> : <Navigate to="/" replace />;
}

function AdminOnlyRoutes() {
  const auth = useMeQuery();
  if (auth.isLoading) return <div role="status" aria-label="Loading page"><PageSkeleton /></div>;
  return auth.data?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

function RouteErrorPage() {
  const error = useRouteError();
  const newRelease = isChunkLoadError(error);
  useEffect(() => {
    // A missing code chunk means a new release went out; reload once to pick it up.
    if (newRelease && reloadForNewRelease()) return;
    reportError(error);
  }, [error, newRelease]);

  return (
    <main role="alert" className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">{newRelease ? 'A new version is available' : 'This page could not load'}</h1>
        <p className="mt-2 text-sm text-slate-500">{newRelease ? 'Reload to continue with the latest version.' : 'Try reloading. The error has been recorded for support.'}</p>
        <button className="mt-4 rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </main>
  );
}

export const router = createBrowserRouter([
  { path: '/book-demo', element: <RouteBoundary><PublicBookingPage /></RouteBoundary>, errorElement: <RouteErrorPage /> },
  { path: '/register/coach', element: <RouteBoundary><CoachRegistrationPage /></RouteBoundary>, errorElement: <RouteErrorPage /> },
  { path: '/reset/coach', element: <RouteBoundary><CoachPasswordResetPage /></RouteBoundary>, errorElement: <RouteErrorPage /> },
  { path: '/forgot/coach', element: <RouteBoundary><CoachForgotPasswordPage /></RouteBoundary>, errorElement: <RouteErrorPage /> },
  {
    path: '/', element: <App />, errorElement: <RouteErrorPage />, children: [
      { index: true, element: <RouteBoundary><Home /></RouteBoundary> },
      { path: 'calendar', element: <RouteBoundary><CalendarPage /></RouteBoundary> },
      { path: 'appointments', element: <RouteBoundary><AppointmentsPage /></RouteBoundary> },
      { path: 'availability', element: <RouteBoundary><AvailabilityPage /></RouteBoundary> },
      { path: 'profile', element: <RouteBoundary><ProfilePage /></RouteBoundary> },
      { path: 'settings', element: <RouteBoundary><SettingsPage /></RouteBoundary> },
      { path: 'help', element: <RouteBoundary><HelpPage /></RouteBoundary> },
      { path: 'my-requests', element: <RouteBoundary><RequestsPage /></RouteBoundary> },
      {
        element: <AdminOnlyRoutes />,
        children: [
          { path: 'book', element: <RouteBoundary><BookingPage /></RouteBoundary> },
          { path: 'requests', element: <RouteBoundary><RequestsPage /></RouteBoundary> },
          { path: 'instructors', element: <RouteBoundary><InstructorsPage /></RouteBoundary> },
          { path: 'coaches', element: <RouteBoundary><CoachAdminPage /></RouteBoundary> },
          { path: 'students', element: <RouteBoundary><StudentsPage /></RouteBoundary> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
