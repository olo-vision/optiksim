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
import { AppLayout, DemoTimer } from './AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LibraryPage } from './pages/LibraryPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminOrganizationPage } from './pages/AdminOrganizationPage';
import { NewSimulationRoute, SimulatorPage } from './pages/SimulatorPage';
import { ModuleEntryRoute, ModulesPage } from './pages/ModulesPage';
import { ModulePage } from './pages/ModulePage';
import { ModalHost } from '@/ui/ds/modals';
import { TooltipLayer } from '@/ui/common/TooltipLayer';
import { Button, EmptyState } from '@/ui/ds';
import { can, type Permission } from '@/platform/permissions';
import { landingPath } from './landing';
import { CLOUD_ENABLED } from '@/cloud/config';
import { canUseSimulator, isSuperAdmin } from '@/cloud/access';
import { startAccessWatch, useCloud } from './cloudSession';
import { CloudLoginPage, ForgotPasswordPage, RegisterPage, ResetPasswordPage } from './pages/cloud/AuthPages';
import { AccountPage, CloudAdminPage, HomePage, LicensePage, PricingPage } from './pages/cloud/AccountPages';
import { ImprintPage, LegalDocumentPage, LegalTypePage } from './pages/cloud/LegalPages';
import { AdminDeclarationsPage, AdminLegalPage } from './pages/cloud/AdminLegalPage';
import { AdminAccountsPage } from './pages/cloud/AdminAccountsPage';
import { CancellationPage, WithdrawalPage } from './pages/cloud/ConsumerPages';
import { cloudLandingPath } from './pages/cloud/cloudLanding';

const SPLASH_MIN_MS = 650;

/** Demo-Zeit auch im Vollbild-Simulator und in Modulen (außerhalb des App-Rahmens) */
function FullscreenDemoTimer() {
  const { pathname } = useLocation();
  return /^\/simulations\/.+|^\/modules\/[^/]+\/[^/]+/.test(pathname) ? <DemoTimer floating /> : null;
}

function Root() {
  useApplyAppearance();
  const status = useSession((s) => s.status);
  const bootError = useSession((s) => s.bootError);
  const cloudStatus = useCloud((s) => s.status);
  const cloudError = useCloud((s) => s.error);
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    // Erst den lokalen Arbeitsbereich initialisieren, dann (SaaS-Modus) Sitzung + Lizenz aus Supabase laden
    void useSession
      .getState()
      .boot()
      .then(() => useCloud.getState().init());
    const t = window.setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    // Phase 8: Zugriff (Demo-Ende, Kündigung, Frist) laufend mit Serverzeit neu bewerten
    const stopWatch = startAccessWatch();
    return () => {
      window.clearTimeout(t);
      stopWatch();
    };
  }, []);
  if (status === 'error')
    return (
      <div className="page-center">
        <EmptyState icon={AlertTriangle} title="Die Anwendung konnte nicht gestartet werden" text={bootError ?? undefined} action={<Button onClick={() => window.location.reload()}>Neu laden</Button>} />
      </div>
    );
  if (cloudStatus === 'error')
    return (
      <div className="page-center">
        <EmptyState icon={AlertTriangle} title="Anmeldedienst nicht konfiguriert" text={cloudError ?? undefined} action={<Button onClick={() => window.location.reload()}>Neu laden</Button>} />
      </div>
    );
  if (status === 'booting' || cloudStatus === 'loading' || !minElapsed) return <Splash />;
  return (
    <>
      <Outlet />
      {CLOUD_ENABLED && <FullscreenDemoTimer />}
      <AppDialogHost />
      <ModalHost />
      <TooltipLayer />
    </>
  );
}

function IndexRedirect() {
  const cloudUser = useCloud((s) => s.user);
  if (CLOUD_ENABLED) return cloudUser ? <Navigate to={cloudLandingPath()} replace /> : <HomePage />;
  return <Navigate to={landingPath()} replace />;
}

/** Angemeldet? (SaaS: Supabase-Sitzung; lokal: Demo-Anmeldung) */
function RequireAuth({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const cloudUser = useCloud((s) => s.user);
  const loc = useLocation();
  if (!(CLOUD_ENABLED ? cloudUser : user)) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/**
 * Nur mit aktiver Lizenz (SaaS): angemeldet ∧ Profil ∧ Institution ∧ Lizenz ∧ (status = active ∨ past_due in der Frist).
 * Lokaler Modus: keine Lizenzprüfung (bisheriges Verhalten).
 */
function RequireLicense({ children }: { children: ReactNode }) {
  const access = useCloud((s) => s.access);
  const user = useSession((s) => s.user);
  if (!CLOUD_ENABLED) return <>{children}</>;
  // Demo abgelaufen → sofort aus dem geschützten Bereich auf die Abschlussseite
  if (access === 'demo-ended') return <Navigate to="/license?demo=ended" replace />;
  // Konto geschlossen → Kontoseite (dort: wieder öffnen oder endgültig löschen)
  if (access === 'account-closed') return <Navigate to="/account" replace />;
  if (!canUseSimulator(access)) return <Navigate to="/license" replace />;
  if (!user) return <Splash message="Arbeitsbereich wird vorbereitet …" />;
  return <>{children}</>;
}

function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const account = useCloud((s) => s.account);
  if (!CLOUD_ENABLED || !isSuperAdmin(account))
    return (
      <div className="page">
        <EmptyState icon={AlertTriangle} title="Kein Zugriff" text="Dieser Bereich ist Super-Admins vorbehalten." action={<Button onClick={() => history.back()}>Zurück</Button>} />
      </div>
    );
  return <>{children}</>;
}

/** Seiten, die es nur im SaaS-Modus gibt */
function CloudOnly({ children, fallback = '/dashboard' }: { children: ReactNode; fallback?: string }) {
  if (!CLOUD_ENABLED) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

const licensed = (el: ReactNode) => <RequireLicense>{el}</RequireLicense>;

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
        text="Diese Adresse gibt es in OLO-LAB3D nicht."
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
        text={<>Die Ansicht konnte nicht angezeigt werden ({msg}). Ihre gespeicherten Daten sind davon nicht betroffen.</>}
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
      // öffentlich
      { path: 'login', element: CLOUD_ENABLED ? <CloudLoginPage /> : <LoginPage /> },
      { path: 'register', element: CLOUD_ENABLED ? <RegisterPage /> : <Navigate to="/login?mode=signup" replace /> },
      { path: 'forgot-password', element: <CloudOnly fallback="/login"><ForgotPasswordPage /></CloudOnly> },
      { path: 'reset-password', element: <CloudOnly fallback="/login"><ResetPasswordPage /></CloudOnly> },
      { path: 'pricing', element: <CloudOnly fallback="/"><PricingPage /></CloudOnly> },
      // Rechtstexte: exakt die angezeigte Version bzw. die aktuelle Version eines Typs
      { path: 'legal/doc/:id', element: <CloudOnly fallback="/"><LegalDocumentPage /></CloudOnly> },
      { path: 'legal/:type', element: <CloudOnly fallback="/"><LegalTypePage /></CloudOnly> },
      // öffentlich ohne Anmeldung: Impressum, Kündigungsbutton (§ 312k BGB), Widerrufsbutton (§ 356a BGB)
      { path: 'impressum', element: <CloudOnly fallback="/"><ImprintPage /></CloudOnly> },
      { path: 'kuendigen', element: <CloudOnly fallback="/"><CancellationPage /></CloudOnly> },
      { path: 'widerrufen', element: <CloudOnly fallback="/"><WithdrawalPage /></CloudOnly> },
      {
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          // angemeldet, Lizenz nicht erforderlich
          { path: 'account', element: <CloudOnly fallback="/profile"><AccountPage /></CloudOnly> },
          { path: 'license', element: <CloudOnly><LicensePage /></CloudOnly> },
          { path: 'profile', element: CLOUD_ENABLED ? <Navigate to="/account" replace /> : <ProfilePage /> },
          // nur mit aktiver Lizenz
          { path: 'dashboard', element: licensed(<DashboardPage />) },
          { path: 'simulations', element: licensed(<LibraryPage />) },
          { path: 'modules', element: licensed(<ModulesPage />) },
          { path: 'modules/:moduleId', element: licensed(<ModuleEntryRoute />) },
          { path: 'templates', element: licensed(<TemplatesPage />) },
          { path: 'settings', element: licensed(<SettingsPage />) },
          { path: 'settings/:section', element: licensed(<SettingsPage />) },
          // nur Super-Admin (SaaS)
          { path: 'admin', element: <CloudOnly><RequireSuperAdmin><CloudAdminPage /></RequireSuperAdmin></CloudOnly> },
          { path: 'admin/legal', element: <CloudOnly><RequireSuperAdmin><AdminLegalPage /></RequireSuperAdmin></CloudOnly> },
          { path: 'admin/declarations', element: <CloudOnly><RequireSuperAdmin><AdminDeclarationsPage /></RequireSuperAdmin></CloudOnly> },
          { path: 'admin/accounts', element: <CloudOnly><RequireSuperAdmin><AdminAccountsPage /></RequireSuperAdmin></CloudOnly> },
          // lokale Verwaltung (Phase 3) – im SaaS-Modus ersetzt durch /admin
          {
            path: 'admin/users',
            element: CLOUD_ENABLED ? (
              <Navigate to="/admin" replace />
            ) : (
              <RequirePermission perm="users.manage">
                <AdminUsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'admin/organization',
            element: CLOUD_ENABLED ? (
              <Navigate to="/admin" replace />
            ) : (
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
            <RequireLicense>
              <NewSimulationRoute />
            </RequireLicense>
          </RequireAuth>
        ),
      },
      {
        path: 'modules/:moduleId/:simId',
        element: (
          <RequireAuth>
            <RequireLicense>
              <ModulePage />
            </RequireLicense>
          </RequireAuth>
        ),
      },
      {
        path: 'simulations/:id',
        element: (
          <RequireAuth>
            <RequireLicense>
              <SimulatorPage />
            </RequireLicense>
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
