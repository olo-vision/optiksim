/**
 * Rahmen der Anwendungsseiten: Seitennavigation, Benutzer-Menü, Hinweise, Onboarding.
 * Der Simulator (/simulations/:id) nutzt diesen Rahmen nicht – er bekommt die volle Fläche.
 */
import { Outlet, NavLink, useNavigate } from 'react-router';
import { Building2, FolderOpen, LayoutDashboard, LayoutTemplate, LogOut, Settings, UserRound, Users, UsersRound, Info, X } from 'lucide-react';
import { useSession } from './session';
import { Brand } from './Brand';
import { Avatar, Button } from '@/ui/ds';
import { Menu } from '@/ui/common/overlays';
import { Toasts } from '@/ui/overlays/HudOverlays';
import { can, roleLabel } from '@/platform/permissions';
import { Onboarding } from './Onboarding';
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

export function UserMenu({ compact, direction = 'up' }: { compact?: boolean; direction?: 'up' | 'down' }) {
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

function Banners() {
  const migration = useSession((s) => s.migration);
  const user = useSession((s) => s.user)!;
  const volatile = useSession((s) => s.volatile);
  const navigate = useNavigate();
  return (
    <>
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
      {user.role === 'guest' && (
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
  const user = useSession((s) => s.user)!;
  const onboardingDone = useAppStore((s) => s.prefs.onboardingDone);
  const isAdmin = can(user, 'users.manage');
  return (
    <div className="shell">
      <aside className="side-nav" aria-label="Hauptnavigation">
        <div className="side-nav__brand">
          <NavLink to="/dashboard" aria-label="Zum Dashboard">
            <Brand />
          </NavLink>
        </div>
        <nav className="side-nav__items">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/simulations" icon={FolderOpen} label="Meine Simulationen" />
          <NavItem to="/templates" icon={LayoutTemplate} label="Vorlagen" />
          {isAdmin && (
            <>
              <div className="side-nav__heading">Verwaltung</div>
              <NavItem to="/admin/users" icon={Users} label="Benutzer" />
              <NavItem to="/admin/organization" icon={Building2} label="Organisation" />
            </>
          )}
        </nav>
        <div className="side-nav__footer">
          <NavItem to="/settings" icon={Settings} label="Einstellungen" />
          <UserMenu />
        </div>
      </aside>
      <main className="shell__main">
        <Banners />
        <Outlet />
      </main>
      <div className="page-toasts">
        <Toasts />
      </div>
      {!onboardingDone && <Onboarding />}
    </div>
  );
}
