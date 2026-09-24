/**
 * Arbeitsbereiche des Simulators (Phase 4): Umschalter und Dock.
 * Die Simulation (SceneDocument) bleibt beim Wechsel erhalten; jeder Bereich zeigt passende Werkzeuge.
 */
import { lazy, Suspense } from 'react';
import { Box, ChevronDown, ChevronUp, CircleDot, Eye, Glasses, GraduationCap, Sparkles } from 'lucide-react';
import type { WorkbenchId } from '@/model/types';
import { useAppStore } from '@/state/store';

const RetinoscopyPanel = lazy(() => import('./retinoscopy/RetinoscopyPanel').then((m) => ({ default: m.RetinoscopyPanel })));
const RefractionPanel = lazy(() => import('./refraction/RefractionPanel').then((m) => ({ default: m.RefractionPanel })));
const PatientViewPanel = lazy(() => import('./patient/PatientViewPanel').then((m) => ({ default: m.PatientViewPanel })));
const ContactLensPanel = lazy(() => import('./contact/ContactLensPanel').then((m) => ({ default: m.ContactLensPanel })));

export const WORKBENCHES: Array<{ id: WorkbenchId; label: string; icon: typeof Box; hint: string }> = [
  { id: 'free', label: 'Frei', icon: Box, hint: 'Freie Simulation / optische Bank' },
  { id: 'retinoscopy', label: 'Skiaskopie', icon: Sparkles, hint: 'Strichskiaskopie mit Reflexbeobachtung und Neutralisation' },
  { id: 'refraction', label: 'Refraktion', icon: Glasses, hint: 'Subjektive Refraktion: Messglas, Nebeln, Kreuzzylinder, Rot-Grün' },
  { id: 'patient-view', label: 'Patientensicht', icon: Eye, hint: 'Wie sieht der Patient? Unschärfe aus Defokus, Zylinder und Pupille' },
  { id: 'contact-lens', label: 'Kontaktlinse', icon: CircleDot, hint: 'Fluoreszeinbild, Sitz, Material und Tränenlinse' },
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
        <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Dock ausklappen' : 'Dock einklappen'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </header>
      {!collapsed && (
        <div className="wb-dock__body">
          <Suspense fallback={<div className="wb-empty">Lade …</div>}>
            {current === 'retinoscopy' && <RetinoscopyPanel />}
            {current === 'refraction' && <RefractionPanel />}
            {current === 'patient-view' && <PatientViewPanel />}
            {current === 'contact-lens' && <ContactLensPanel />}
          </Suspense>
        </div>
      )}
    </section>
  );
}
