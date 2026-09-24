/**
 * Routing (react-router, Browser-History). Alle Routen sind neu-ladbar
 * (Netlify: public/_redirects, Vite-Preview: SPA-Fallback).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, isRouteErrorResponse, Navigate, Outlet, useLocation, useRouteError } from 'react-router';
import { AlertTriangle, Compass } from 'lucide-react';
import { useSession } from './session';
import { useApplyAppearance } from './appearance';
import { Splash } from './Splash';
import { AppDialogHost } from './library/dialogs';
import { AppLayout } from './AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LibraryPage } from './pages/LibraryPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminOrganizationPage } from './pages/AdminOrganizationPage';
import { NewSimulationRoute, SimulatorPage } from './pages/SimulatorPage';
import { ModalHost } from '@/ui/ds/modals';
import { TooltipLayer } from '@/ui/common/TooltipLayer';
import { Button, EmptyState } from '@/ui/ds';
import { can, type Permission } from '@/platform/permissions';
import { landingPath } from './landing';

const SPLASH_MIN_MS = 650;

function Root() {
  useApplyAppearance();
  const status = useSession((s) => s.status);
  const bootError = useSession((s) => s.bootError);
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    void useSession.getState().boot();
    const t = window.setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (status === 'error')
    return (
      <div className="page-center">
        <EmptyState icon={AlertTriangle} title="Die Anwendung konnte nicht gestartet werden" text={bootError ?? undefined} action={<Button onClick={() => window.location.reload()}>Neu laden</Button>} />
      </div>
    );
  if (status === 'booting' || !minElapsed) return <Splash />;
  return (
    <>
      <Outlet />
      <AppDialogHost />
      <ModalHost />
      <TooltipLayer />
    </>
  );
}

function IndexRedirect() {
  return <Navigate to={landingPath()} replace />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const user = useSession((s) => s.user);
  if (!can(user, perm))
    return (
      <div className="page">
        <EmptyState icon={AlertTriangle} title="Kein Zugriff" text="Dieser Bereich ist der Administration vorbehalten." action={<Button onClick={() => history.back()}>Zurück</Button>} />
      </div>
    );
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page-center">
      <EmptyState
        icon={Compass}
        title="Seite nicht gefunden"
        text="Diese Adresse gibt es in Optical Eye Lab nicht."
        action={
          <Button variant="primary" onClick={() => (window.location.href = '/')}>
            Zur Startseite
          </Button>
        }
      />
    </div>
  );
}

function RouteError() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Unbekannter Fehler';
  return (
    <div className="page-center">
      <EmptyState
        icon={AlertTriangle}
        title="Hier ist etwas schiefgelaufen"
        text={<>Die Ansicht konnte nicht angezeigt werden ({msg}). Deine gespeicherten Daten sind davon nicht betroffen.</>}
        action={
          <Button variant="primary" onClick={() => (window.location.href = '/dashboard')}>
            Zum Dashboard
          </Button>
        }
      />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <IndexRedirect /> },
      { path: 'login', element: <LoginPage /> },
      {
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'simulations', element: <LibraryPage /> },
          { path: 'templates', element: <TemplatesPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/:section', element: <SettingsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          {
            path: 'admin/users',
            element: (
              <RequirePermission perm="users.manage">
                <AdminUsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'admin/organization',
            element: (
              <RequirePermission perm="organization.manage">
                <AdminOrganizationPage />
              </RequirePermission>
            ),
          },
        ],
      },
      {
        path: 'simulations/new',
        element: (
          <RequireAuth>
            <NewSimulationRoute />
          </RequireAuth>
        ),
      },
      {
        path: 'simulations/:id',
        element: (
          <RequireAuth>
            <SimulatorPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
