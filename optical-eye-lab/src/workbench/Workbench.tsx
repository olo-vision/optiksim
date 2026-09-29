/**
 * Arbeitsbereiche des Simulators (Phase 4): Umschalter und Dock.
 * Die Simulation (SceneDocument) bleibt beim Wechsel erhalten; jeder Bereich zeigt passende Werkzeuge.
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Box, ChevronDown, ChevronUp, GraduationCap, Maximize2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { WorkbenchId } from '@/model/types';
import { useAppStore } from '@/state/store';
import { activeModules, moduleForWorkbench } from '@/modules/registry';

/** Panels der Arbeitsbereiche – im Simulator als Dock, im Modul als Hauptinhalt (dieselbe Komponente). */
export const WORKBENCH_PANELS: Record<Exclude<WorkbenchId, 'free'>, LazyExoticComponent<ComponentType>> = {
  retinoscopy: lazy(() => import('./retinoscopy/RetinoscopyPanel').then((m) => ({ default: m.RetinoscopyPanel }))),
  refraction: lazy(() => import('./refraction/RefractionPanel').then((m) => ({ default: m.RefractionPanel }))),
  'patient-view': lazy(() => import('./patient/PatientViewPanel').then((m) => ({ default: m.PatientViewPanel }))),
  'contact-lens': lazy(() => import('./contact/ContactLensPanel').then((m) => ({ default: m.ContactLensPanel }))),
  'spectacle-lens': lazy(() => import('./spectacle/SpectacleLensPanel').then((m) => ({ default: m.SpectacleLensPanel }))),
};

export function WorkbenchPanel({ id }: { id: WorkbenchId }) {
  if (id === 'free') return null;
  const Panel = WORKBENCH_PANELS[id];
  return (
    <Suspense fallback={<div className="wb-empty">Lade …</div>}>
      <Panel />
    </Suspense>
  );
}

/** Reiter des Simulators: „Frei“ + alle aktiven Module mit Arbeitsbereich (aus der Modul-Registry). */
export const WORKBENCHES: Array<{ id: WorkbenchId; label: string; icon: typeof Box; hint: string }> = [
  { id: 'free', label: 'Frei', icon: Box, hint: 'Freie Simulation / optische Bank' },
  ...activeModules().map((m) => ({ id: m.workbench as WorkbenchId, label: m.short, icon: m.icon, hint: m.tagline })),
];

export function WorkbenchBar() {
  const current = useAppStore((s) => s.doc.display.workbench ?? 'free');
  const setWorkbench = useAppStore((s) => s.setWorkbench);
  const expert = useAppStore((s) => s.prefs.expertMode);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const training = useAppStore((s) => s.doc.training);
  return (
    <div className="workbench-bar" role="tablist" aria-label="Arbeitsbereich">
      {WORKBENCHES.map((w) => (
        <button
          key={w.id}
          type="button"
          role="tab"
          aria-selected={current === w.id}
          className={`workbench-bar__item${current === w.id ? ' is-active' : ''}`}
          onClick={() => setWorkbench(w.id)}
          data-tip={w.hint}
          aria-label={w.label}
          data-testid={`workbench-${w.id}`}
        >
          <w.icon size={14} strokeWidth={1.9} />
          <span>{w.label}</span>
        </button>
      ))}
      <span className="workbench-bar__sep" />
      {training?.hidden && (
        <span className="workbench-bar__badge" data-tip={training.complaint}>
          <GraduationCap size={13} /> Training
        </span>
      )}
      <button
        type="button"
        className={`workbench-bar__mode${expert ? ' is-expert' : ''}`}
        onClick={() => setPrefs({ expertMode: !expert })}
        data-tip={expert ? 'Expertenmodus: alle Details – umschalten auf Standard' : 'Standard: wichtigste Parameter – umschalten auf Experte'}
        data-testid="expert-toggle"
      >
        {expert ? 'Experte' : 'Standard'}
      </button>
    </div>
  );
}

export function WorkbenchDock() {
  const current = useAppStore((s) => s.doc.display.workbench ?? 'free');
  const collapsed = useAppStore((s) => s.dockCollapsed);
  const setCollapsed = useAppStore((s) => s.setDockCollapsed);
  if (current === 'free') return null;
  const meta = WORKBENCHES.find((w) => w.id === current)!;
  return (
    <section className={`wb-dock${collapsed ? ' is-collapsed' : ''}`} aria-label={`Arbeitsbereich ${meta.label}`} data-testid="workbench-dock">
      <header className="wb-dock__head">
        <meta.icon size={14} />
        <span className="wb-dock__title">{meta.label}</span>
        <span className="wb-dock__hint">{meta.hint}</span>
        <FocusModuleButton workbench={current} />
        <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Dock ausklappen' : 'Dock einklappen'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </header>
      {!collapsed && (
        <div className="wb-dock__body">
          <WorkbenchPanel id={current} />
        </div>
      )}
    </section>
  );
}

/** Im Simulator: aktuellen Arbeitsbereich als fokussiertes Modul öffnen (gleiche Simulation). */
function FocusModuleButton({ workbench }: { workbench: WorkbenchId }) {
  const navigate = useNavigate();
  const simId = useAppStore((s) => s.simId);
  const mod = moduleForWorkbench(workbench);
  if (!mod || !simId) return null;
  return (
    <button
      type="button"
      className="btn btn--ghost btn--xs"
      data-testid="open-as-module"
      data-tip={`„${mod.title}“ als eigenständiges Modul öffnen – nur dieser Bereich, gleiche Simulation`}
      onClick={async () => {
        const st = useAppStore.getState();
        if (st.dirty) await st.saveCurrent({ silent: true });
        navigate(`/modules/${mod.id}/${simId}`);
      }}
    >
      <Maximize2 size={13} />
      <span>Als Modul öffnen</span>
    </button>
  );
}
