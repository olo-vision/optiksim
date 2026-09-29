/**
 * Rahmen der Anwendungsseiten: Seitennavigation, Benutzer-Menü, Hinweise, Onboarding.
 * Der Simulator (/simulations/:id) nutzt diesen Rahmen nicht – er bekommt die volle Fläche.
 */
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import { BadgeCheck, Boxes, Building2, CreditCard, FolderOpen, LayoutDashboard, LayoutTemplate, LogOut, Settings, ShieldCheck, UserRound, Users, UsersRound, Info, X } from 'lucide-react';
import { CLOUD_ENABLED } from '@/cloud/config';
import { canUseSimulator, isSuperAdmin } from '@/cloud/access';
import { LICENSE_STATUS_LABEL } from '@/cloud/plans';
import { useCloud } from './cloudSession';
import { useSession } from './session';
import { Brand } from './Brand';
import { Avatar, Button } from '@/ui/ds';
import { Menu } from '@/ui/common/overlays';
import { Toasts } from '@/ui/overlays/HudOverlays';
import { can, roleLabel } from '@/platform/permissions';
import { Onboarding } from './Onboarding';
import { ManageSubscriptionButton } from './pages/cloud/Billing';
import { billingNotice } from '@/cloud/billing';
import { demoRemainingMs } from '@/cloud/access';
import { formatCountdown } from '@/cloud/plans';
import { serverDate } from '@/cloud/serverClock';
import { useSecondTick } from './pages/cloud/PlanCards';
import { Clock3, FileX2 } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { GUEST_SIMULATION_LIMIT } from '@/platform/permissions';

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: typeof LayoutDashboard; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `side-nav__item${isActive ? ' is-active' : ''}`} data-tip={label} data-tip-side="right">
      <Icon size={17} strokeWidth={1.8} />
      <span className="side-nav__label">{label}</span>
    </NavLink>
  );
}

/** Benutzermenü im SaaS-Modus: Konto, Lizenz, Einstellungen (mit Lizenz), Abmelden */
function CloudUserMenu({ compact, direction = 'up' }: { compact?: boolean; direction?: 'up' | 'down' }) {
  const account = useCloud((s) => s.account);
  const cloudUser = useCloud((s) => s.user);
  const access = useCloud((s) => s.access);
  const wsUser = useSession((s) => s.user);
  const navigate = useNavigate();
  const p = account?.profile;
  const name = (p && `${p.firstName} ${p.lastName}`.trim()) || cloudUser?.email || 'Konto';
  const status = account?.license ? LICENSE_STATUS_LABEL[account.license.status] : 'keine Lizenz';
  return (
    <Menu
      direction={direction}
      align="left"
      width={250}
      label="Benutzermenü"
      trigger={(open) => (
        <button type="button" className={`user-chip${open ? ' is-open' : ''}${compact ? ' user-chip--compact' : ''}`} aria-label={`Benutzermenü ${name}`} data-testid="user-menu">
          <Avatar name={name} color={wsUser?.avatarColor} size={30} />
          {!compact && (
            <span className="user-chip__text">
              <span className="user-chip__name">{name}</span>
              <span className="user-chip__role">
                {account?.institution?.name ?? ''} · {status}
              </span>
            </span>
          )}
        </button>
      )}
      items={[
        { heading: true, label: cloudUser?.email ?? '' },
        { label: 'Konto', icon: UserRound, onSelect: () => navigate('/account') },
        { label: 'Lizenz', icon: BadgeCheck, onSelect: () => navigate('/license') },
        { label: 'Verträge hier kündigen', icon: FileX2, onSelect: () => navigate('/kuendigen') },
        ...(canUseSimulator(access) ? [{ label: 'Einstellungen', icon: Settings, onSelect: () => navigate('/settings') }] : []),
        { separator: true, label: '' },
        {
          label: 'Abmelden',
          icon: LogOut,
          danger: true,
          onSelect: async () => {
            await useCloud.getState().signOut();
            navigate('/login', { replace: true });
          },
        },
      ]}
    />
  );
}

export function UserMenu(props: { compact?: boolean; direction?: 'up' | 'down' }) {
  return CLOUD_ENABLED ? <CloudUserMenu {...props} /> : <LocalUserMenu {...props} />;
}

function LocalUserMenu({ compact, direction = 'up' }: { compact?: boolean; direction?: 'up' | 'down' }) {
  const user = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const navigate = useNavigate();
  const signOut = async (switchUser: boolean) => {
    await useSession.getState().signOut();
    navigate(switchUser ? '/login?switch=1' : '/login', { replace: true });
  };
  return (
    <Menu
      direction={direction}
      align="left"
      width={250}
      label="Benutzermenü"
      trigger={(open) => (
        <button type="button" className={`user-chip${open ? ' is-open' : ''}${compact ? ' user-chip--compact' : ''}`} aria-label={`Benutzermenü ${user.displayName}`}>
          <Avatar name={user.displayName} color={user.avatarColor} src={user.avatarDataUrl} size={30} />
          {!compact && (
            <span className="user-chip__text">
              <span className="user-chip__name">{user.displayName}</span>
              <span className="user-chip__role">
                {roleLabel(user.role, org?.type)}
                {org ? ` · ${org.name}` : ''}
              </span>
            </span>
          )}
        </button>
      )}
      items={[
        { heading: true, label: user.email },
        { label: 'Profil', icon: UserRound, onSelect: () => navigate('/profile') },
        { label: 'Einstellungen', icon: Settings, onSelect: () => navigate('/settings') },
        { separator: true, label: '' },
        { label: 'Benutzer wechseln', icon: UsersRound, onSelect: () => void signOut(true) },
        { label: 'Abmelden', icon: LogOut, onSelect: () => void signOut(false), danger: true },
      ]}
    />
  );
}

/**
 * Demo-Zeit (Phase 8): dezente Leiste mit verbleibender Zeit. Die Anzeige rechnet mit der Serverzeit;
 * die Berechtigung selbst prüft der Server (valid_until) – bei 0 leitet die Zugriffsprüfung sofort um.
 */
export function DemoTimer({ floating = false }: { floating?: boolean }) {
  const access = useCloud((s) => s.access);
  const account = useCloud((s) => s.account);
  const navigate = useNavigate();
  const running = CLOUD_ENABLED && access === 'demo';
  useSecondTick(running);
  if (!running) return null;
  const left = demoRemainingMs(account, serverDate());
  return (
    <div className={`demo-timer${floating ? ' demo-timer--floating' : ''}${left < 10 * 60 * 1000 ? ' is-ending' : ''}`} data-testid="demo-timer" role="timer" aria-live="off">
      <Clock3 size={14} />
      <span>
        Demo – verbleibende Zeit: <strong data-testid="demo-remaining">{formatCountdown(left)}</strong>
      </span>
      <Button size="sm" variant="ghost" onClick={() => navigate('/license')}>
        Lizenz wählen
      </Button>
    </div>
  );
}

const ONBOARDING_EXCLUDED = /^\/(license|pricing|account|admin)(\/|$)/;

function Banners() {
  const migration = useSession((s) => s.migration);
  const user = useSession((s) => s.user);
  const volatile = useSession((s) => s.volatile);
  const account = useCloud((s) => s.account);
  const navigate = useNavigate();
  const billing = CLOUD_ENABLED ? billingNotice(account) : null;
  return (
    <>
      {billing?.tone === 'warn' && (
        <div className="banner banner--warn" data-testid="billing-banner">
          <Info size={15} />
          <span>{billing.text}</span>
          <ManageSubscriptionButton size="sm" variant="primary" />
        </div>
      )}
      {volatile && (
        <div className="banner banner--warn">
          <Info size={15} />
          <span>Der Browser erlaubt keinen dauerhaften lokalen Speicher. Änderungen gehen beim Schließen verloren – exportiere wichtige Simulationen als Datei.</span>
        </div>
      )}
      {migration && (migration.migratedScenes > 0 || migration.recoveredAutosave) && (
        <div className="banner">
          <Info size={15} />
          <span>
            Daten aus der Vorversion übernommen: {migration.migratedScenes} gespeicherte Szene{migration.migratedScenes === 1 ? '' : 'n'}
            {migration.recoveredAutosave ? ' und der letzte Arbeitsstand' : ''}. Du findest sie in „Meine Simulationen“ mit dem Tag „Übernommen“.
          </span>
          <Button size="sm" variant="ghost" onClick={() => navigate('/simulations?tag=%C3%9Cbernommen')}>
            Anzeigen
          </Button>
          <button type="button" className="banner__close" aria-label="Hinweis schließen" onClick={() => useSession.getState().dismissMigration()}>
            <X size={14} />
          </button>
        </div>
      )}
      {user?.role === 'guest' && (
        <div className="banner banner--accent">
          <Info size={15} />
          <span>Du nutzt den Gastzugang (bis zu {GUEST_SIMULATION_LIMIT} Simulationen). Mit einem lokalen Konto kannst du unbegrenzt speichern und Einstellungen behalten.</span>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              await useSession.getState().signOut();
              navigate('/login?mode=signup');
            }}
          >
            Konto erstellen
          </Button>
        </div>
      )}
    </>
  );
}

export function AppLayout() {
  const user = useSession((s) => s.user);
  const onboardingDone = useAppStore((s) => s.prefs.onboardingDone);
  const access = useCloud((s) => s.access);
  const account = useCloud((s) => s.account);
  const licensed = !CLOUD_ENABLED || canUseSimulator(access);
  const { pathname } = useLocation();
  const isAdmin = !CLOUD_ENABLED && can(user, 'users.manage');
  const superAdmin = CLOUD_ENABLED && isSuperAdmin(account);
  return (
    <div className="shell">
      <aside className="side-nav" aria-label="Hauptnavigation">
        <div className="side-nav__brand">
          <NavLink to={licensed ? '/dashboard' : '/license'} aria-label="Startseite">
            <Brand />
          </NavLink>
        </div>
        <nav className="side-nav__items">
          {licensed ? (
            <>
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/modules" icon={Boxes} label="Module" />
              <NavItem to="/simulations" icon={FolderOpen} label="Meine Simulationen" />
              <NavItem to="/templates" icon={LayoutTemplate} label="Vorlagen" />
            </>
          ) : (
            <>
              <NavItem to="/license" icon={BadgeCheck} label="Lizenz" />
              <NavItem to="/account" icon={UserRound} label="Konto" />
            </>
          )}
          {isAdmin && (
            <>
              <div className="side-nav__heading">Verwaltung</div>
              <NavItem to="/admin/users" icon={Users} label="Benutzer" />
              <NavItem to="/admin/organization" icon={Building2} label="Organisation" />
            </>
          )}
          {superAdmin && (
            <>
              <div className="side-nav__heading">Verwaltung</div>
              <NavItem to="/admin" icon={ShieldCheck} label="Admin" end />
            </>
          )}
        </nav>
        <div className="side-nav__footer">
          {CLOUD_ENABLED && licensed && <NavItem to="/account" icon={UserRound} label="Konto" />}
          {CLOUD_ENABLED && !licensed && <NavItem to="/pricing" icon={CreditCard} label="Tarife" />}
          {licensed && <NavItem to="/settings" icon={Settings} label="Einstellungen" />}
          <UserMenu />
        </div>
      </aside>
      <main className="shell__main">
        <DemoTimer />
        <Banners />
        <Outlet />
      </main>
      <div className="page-toasts">
        <Toasts />
      </div>
      {/* Onboarding erst in der Anwendung – nicht über Lizenz-/Kaufbestätigung, Konto oder Admin */}
      {licensed && user && !onboardingDone && !ONBOARDING_EXCLUDED.test(pathname) && <Onboarding />}
    </div>
  );
}
