/**
 * Eigenständiger Modul-Bereich (/modules/:moduleId/:simId) – Phase 5.
 *
 * Fokussierte Oberfläche für EIN Thema: Kopfzeile mit Navigation (Dashboard · Module · Modulwechsel),
 * Sitzungsmenü, Speicherstatus und „Vollständiger Simulator“; darunter das Panel des Moduls als
 * Hauptinhalt und optional eine 3D-Ansicht der Szene.
 *
 * Keine eigene Logik: Laden/Speichern über useSimulationSession (wie der Simulator), Inhalt über
 * WorkbenchPanel (dieselben Panels wie im Simulator-Dock), Physik aus engine/*.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Box, ChevronDown, ChevronRight, FilePlus2, FolderOpen, LayoutGrid, Maximize2, Pencil, Save, X, History, Info } from 'lucide-react';
import { findModule, MODULES } from '@/modules/registry';
import { useAppStore } from '@/state/store';
import { Viewport } from '@/scene/Viewport';
import { HoverTooltip, Toasts } from '@/ui/overlays/HudOverlays';
import { SaveStatus } from '@/ui/toolbar/SaveStatus';
import { Menu, type MenuItem } from '@/ui/common/overlays';
import { Button, EmptyState } from '@/ui/ds';
import { WorkbenchPanel } from '@/workbench/Workbench';
import { Brand } from '../Brand';
import { UserMenu } from '../AppLayout';
import { Splash } from '../Splash';
import { usePageTitle } from '../usePageTitle';
import { useSession, errorMessage } from '../session';
import { RecoveryBanner, renameCurrentSimulation, useSimulationSession } from '../simulation/useSimulationSession';
import { createModuleSession, moduleSessions } from '../modules/moduleSessions';

const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';
const INTRO_KEY = 'oel:module-intro-hidden';

export function ModulePage() {
  const { moduleId = '', simId = '' } = useParams();
  const mod = findModule(moduleId);
  const navigate = useNavigate();
  const { state, recovery, setRecovery, leaveWithoutGuard, retryLoad } = useSimulationSession(simId, { saveOnLeave: true });
  const workbench = useAppStore((s) => (s.simId === simId ? s.doc.display.workbench : undefined));
  const [show3d, setShow3d] = useState<boolean>(() => !!mod?.show3d && window.innerWidth >= 900);
  const [introHidden, setIntroHidden] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(INTRO_KEY) === '1';
    } catch {
      return false;
    }
  });
  usePageTitle(mod ? mod.title : 'Modul');

  // Arbeitsbereich der Simulation auf das Modul einstellen (z. B. beim Öffnen einer Simulator-Sitzung als Modul)
  useEffect(() => {
    if (state.status !== 'ready' || !mod?.workbench) return;
    if (workbench !== mod.workbench) useAppStore.getState().setWorkbench(mod.workbench);
  }, [state.status, mod, workbench]);

  // 3D-Ansicht: Szene neu einpassen, wenn sich die Bühnengröße ändert (Einblenden, Fenstergröße)
  const stageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || state.status !== 'ready') return;
    let t: number | undefined;
    const fit = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => useAppStore.getState().sendCameraCommand({ type: 'focus-scene' }), 180);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [show3d, state.status]);

  // Strg/⌘+S speichert
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useAppStore.getState().saveCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Gleiche Simulation im vollständigen Simulator öffnen (vorher speichern, damit nichts verloren geht) */
  const openInSimulator = useCallback(async () => {
    const st = useAppStore.getState();
    if (st.dirty && !(await st.saveCurrent({ silent: true }))) return;
    leaveWithoutGuard(`/simulations/${simId}`);
  }, [simId, leaveWithoutGuard]);

  const newSession = useCallback(async () => {
    if (!mod) return;
    const st = useAppStore.getState();
    if (st.dirty) await st.saveCurrent({ silent: true });
    try {
      const id = await createModuleSession(mod);
      leaveWithoutGuard(`/modules/${mod.id}/${id}`);
    } catch (e) {
      st.notify(errorMessage(e), 'warning');
    }
  }, [mod, leaveWithoutGuard]);

  if (!mod || !mod.workbench)
    return (
      <div className="page-center">
        <EmptyState icon={Info} title="Modul nicht verfügbar" text="Dieses Modul gibt es nicht oder es ist noch in Entwicklung." action={<Button onClick={() => navigate('/modules')}>Zur Modulübersicht</Button>} />
      </div>
    );
  if (state.status === 'loading') return <Splash message={`${mod.title} wird geöffnet …`} />;
  if (state.status === 'error')
    return (
      <div className="page-center">
        <EmptyState
          icon={FolderOpen}
          title="Sitzung konnte nicht geladen werden"
          text={state.message}
          action={
            <Button variant="primary" onClick={retryLoad}>
              Erneut versuchen
            </Button>
          }
        />
      </div>
    );
  if (state.status === 'missing')
    return (
      <div className="page-center">
        <EmptyState
          icon={FolderOpen}
          title="Sitzung nicht gefunden"
          text="Sie wurde gelöscht oder gehört zu einem anderen Konto."
          action={
            <Button variant="primary" onClick={() => navigate(`/modules/${mod.id}`)}>
              {mod.title} öffnen
            </Button>
          }
        />
      </div>
    );

  const hideIntro = () => {
    setIntroHidden(true);
    try {
      window.localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* optional */
    }
  };

  return (
    <div className={`module-shell${show3d ? ' has-3d' : ''}`} data-testid="module-shell" data-module={mod.id}>
      <header className="module-bar">
        <nav className="module-bar__nav" aria-label="Navigation">
          <Link to="/dashboard" className="module-bar__home" aria-label="Zum Dashboard" data-tip="Dashboard" data-testid="module-home">
            <Brand compact />
          </Link>
          <ChevronRight size={13} className="module-bar__sep" aria-hidden />
          <Link to="/modules" className="module-bar__link">
            Module
          </Link>
          <ChevronRight size={13} className="module-bar__sep" aria-hidden />
          <ModuleSwitcher current={mod.id} />
        </nav>
        <SessionMenu simId={simId} moduleId={mod.id} onNew={() => void newSession()} onSimulator={() => void openInSimulator()} />
        <div className="module-bar__actions">
          <span className="module-bar__status">
            <SaveStatus compact />
          </span>
          <ExpertToggle />
          <button type="button" className={`icon-btn icon-btn--md${show3d ? ' is-active' : ''}`} onClick={() => setShow3d(!show3d)} aria-pressed={show3d} aria-label="3D-Ansicht" data-tip={show3d ? '3D-Ansicht ausblenden' : '3D-Ansicht einblenden'} data-testid="toggle-3d">
            <Box size={16} />
          </button>
          <button type="button" className="btn btn--accent module-bar__sim" onClick={() => void openInSimulator()} data-testid="open-simulator" data-tip="Diese Sitzung im vollständigen Simulator öffnen (alle Werkzeuge)">
            <Maximize2 size={14} />
            <span>Vollständiger Simulator</span>
          </button>
          <UserMenu compact direction="down" />
        </div>
      </header>

      {recovery && (
        <div className="module-banner">
          <RecoveryBanner id={simId} recovery={recovery} onDone={() => setRecovery(null)} />
        </div>
      )}

      <div className="module-body">
        {show3d && (
          <section className="module-stage" aria-label="3D-Ansicht" ref={stageRef}>
            <Viewport />
          </section>
        )}
        <main className="module-main">
          {!introHidden && (
            <div className="module-intro">
              <span className="module-intro__icon">
                <mod.icon size={20} />
              </span>
              <div className="module-intro__text">
                <h1>{mod.title}</h1>
                <p>{mod.tagline}</p>
                {mod.goals.length > 0 && (
                  <ul>
                    {mod.goals.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={hideIntro} aria-label="Hinweis ausblenden" data-tip="Einleitung ausblenden">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="module-panel" data-testid="module-panel">
            <WorkbenchPanel id={mod.workbench} />
          </div>
        </main>
      </div>
      <div className="page-toasts">
        <Toasts />
      </div>
      <HoverTooltip />
    </div>
  );
}

/** Modulwechsel in der Kopfzeile */
function ModuleSwitcher({ current }: { current: string }) {
  const navigate = useNavigate();
  const mod = findModule(current)!;
  const items: MenuItem[] = [
    { heading: true, label: 'Modul wechseln' },
    ...MODULES.map((m) => ({
      label: m.title,
      icon: m.icon,
      disabled: m.status === 'planned' || m.id === current,
      description: m.status === 'planned' ? 'In Entwicklung' : m.id === current ? 'geöffnet' : undefined,
      onSelect: async () => {
        const st = useAppStore.getState();
        if (st.dirty) await st.saveCurrent({ silent: true });
        navigate(`/modules/${m.id}`);
      },
    })),
    { separator: true, label: '' },
    { label: 'Alle Module', icon: LayoutGrid, onSelect: () => navigate('/modules') },
  ];
  return (
    <Menu
      width={280}
      label="Modul wechseln"
      items={items}
      trigger={(open) => (
        <button type="button" className={`module-bar__switch${open ? ' is-open' : ''}`} data-testid="module-switcher">
          <mod.icon size={15} />
          <span>{mod.title}</span>
          <ChevronDown size={13} />
        </button>
      )}
    />
  );
}

/** Sitzung: Name, Speichern, Umbenennen, neue/frühere Sitzungen, Simulator */
function SessionMenu({ simId, moduleId, onNew, onSimulator }: { simId: string; moduleId: string; onNew: () => void; onSimulator: () => void }) {
  const navigate = useNavigate();
  const name = useAppStore((s) => s.doc.name);
  const dirty = useAppStore((s) => s.dirty);
  const saving = useAppStore((s) => s.saving);
  const sims = useSession((s) => s.sims);
  const others = moduleSessions(sims, moduleId).filter((m) => m.id !== simId).slice(0, 6);
  const items: MenuItem[] = [
    { heading: true, label: 'Sitzung' },
    { label: 'Speichern', icon: Save, shortcut: `${MOD_KEY}S`, disabled: saving, onSelect: () => void useAppStore.getState().saveCurrent() },
    { label: 'Umbenennen …', icon: Pencil, onSelect: () => void renameCurrentSimulation(simId) },
    { label: 'Neue Sitzung', icon: FilePlus2, description: 'Startszene des Moduls', onSelect: onNew },
    ...(others.length ? [{ separator: true, label: '' }, { heading: true, label: 'Frühere Sitzungen' }] : []),
    ...others.map((m) => ({ label: m.name, icon: History, onSelect: () => navigate(`/modules/${moduleId}/${m.id}`) })),
    { separator: true, label: '' },
    { label: 'Im vollständigen Simulator öffnen', icon: Maximize2, onSelect: onSimulator },
    { label: 'Meine Simulationen', icon: FolderOpen, onSelect: () => navigate('/simulations') },
  ];
  return (
    <Menu
      width={290}
      label="Sitzungsmenü"
      items={items}
      trigger={(open) => (
        <button type="button" className={`module-bar__session${open ? ' is-open' : ''}`} aria-label={`Sitzungsmenü ${name}`} data-testid="session-menu">
          <span className="module-bar__session-name">{name}</span>
          {dirty && <span className="dirty-dot" data-tip="Ungespeicherte Änderungen" />}
          <ChevronDown size={13} />
        </button>
      )}
    />
  );
}

function ExpertToggle() {
  const expert = useAppStore((s) => s.prefs.expertMode);
  const setPrefs = useAppStore((s) => s.setPrefs);
  return (
    <button
      type="button"
      className={`workbench-bar__mode${expert ? ' is-expert' : ''}`}
      onClick={() => setPrefs({ expertMode: !expert })}
      data-tip={expert ? 'Expertenmodus: alle Details – umschalten auf Standard' : 'Standard: wichtigste Parameter – umschalten auf Experte'}
      data-testid="module-expert-toggle"
    >
      {expert ? 'Experte' : 'Standard'}
    </button>
  );
}
