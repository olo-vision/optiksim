/**
 * Simulator-Arbeitsfläche: Viewport im Hintergrund, schwebende Panels darüber.
 * Wird von der Anwendung (src/app) in /simulations/:id eingebettet; Navigation und
 * Benutzer-Menü kommen über `leading`/`trailing` von außen.
 */
import { useEffect, type ReactNode } from 'react';
import { Viewport } from './scene/Viewport';
import { Toolbar } from './ui/toolbar/Toolbar';
import { ViewBar } from './ui/toolbar/ViewBar';
import { SceneTree } from './ui/sceneTree/SceneTree';
import { Inspector } from './ui/inspector/Inspector';
import { Dialogs } from './ui/dialogs/Dialogs';
import { HoverTooltip, MeasurementBar, StatusBar, Toasts } from './ui/overlays/HudOverlays';
import { useShortcuts } from './ui/useShortcuts';
import { COMPACT_LAYOUT_QUERY, useAppStore } from './state/store';
import { WorkbenchBar, WorkbenchDock } from './workbench/Workbench';

export function SimulatorWorkspace({ leading, trailing, banner }: { leading?: ReactNode; trailing?: ReactNode; banner?: ReactNode }) {
  useShortcuts();
  const left = useAppStore((s) => s.leftPanelOpen);
  const right = useAppStore((s) => s.rightPanelOpen);
  const workbench = useAppStore((s) => s.doc.display.workbench ?? 'free');
  const collapsed = useAppStore((s) => s.dockCollapsed);
  const dock = workbench === 'free' ? '' : collapsed ? ' has-dock-collapsed' : ' has-dock';
  useCompactPanels();
  return (
    <div className={`app${left ? ' has-left' : ''}${right ? ' has-right' : ''}${dock}`}>
      <Viewport />
      <Toolbar leading={leading} trailing={trailing} />
      <div className="stage-overlay">
        <div className="stage-overlay__top">
          {banner}
          <WorkbenchBar />
          <ViewBar />
        </div>
        <MeasurementBar />
        <Toasts />
      </div>
      <WorkbenchDock />
      {left && <SceneTree />}
      {right && <Inspector />}
      <StatusBar />
      <HoverTooltip />
      <Dialogs />
    </div>
  );
}

/**
 * Tablet/Smartphone: Die Panels überdecken die Szene. Beim Öffnen des Simulators bzw. beim Wechsel in die
 * schmale Ansicht bleibt höchstens ein Panel offen (Smartphone: keines) – die 3D-Szene bleibt bedienbar.
 * Ändert nur die Ansicht, nicht die gespeicherten Einstellungen.
 */
function useCompactPanels() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const apply = () => {
      if (!mq.matches) return;
      const s = useAppStore.getState();
      if (window.matchMedia('(max-width: 640px)').matches) {
        if (s.leftPanelOpen || s.rightPanelOpen) useAppStore.setState({ leftPanelOpen: false, rightPanelOpen: false });
      } else if (s.leftPanelOpen && s.rightPanelOpen) useAppStore.setState({ leftPanelOpen: false });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}

/** @deprecated Phase-1/2-Name – entspricht SimulatorWorkspace ohne App-Navigation. */
export const App = SimulatorWorkspace;
