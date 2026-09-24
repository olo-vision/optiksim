/**
 * Simulator-Arbeitsfläche: Viewport im Hintergrund, schwebende Panels darüber.
 * Wird von der Anwendung (src/app) in /simulations/:id eingebettet; Navigation und
 * Benutzer-Menü kommen über `leading`/`trailing` von außen.
 */
import type { ReactNode } from 'react';
import { Viewport } from './scene/Viewport';
import { Toolbar } from './ui/toolbar/Toolbar';
import { ViewBar } from './ui/toolbar/ViewBar';
import { SceneTree } from './ui/sceneTree/SceneTree';
import { Inspector } from './ui/inspector/Inspector';
import { Dialogs } from './ui/dialogs/Dialogs';
import { HoverTooltip, MeasurementBar, StatusBar, Toasts } from './ui/overlays/HudOverlays';
import { useShortcuts } from './ui/useShortcuts';
import { useAppStore } from './state/store';

export function SimulatorWorkspace({ leading, trailing, banner }: { leading?: ReactNode; trailing?: ReactNode; banner?: ReactNode }) {
  useShortcuts();
  const left = useAppStore((s) => s.leftPanelOpen);
  const right = useAppStore((s) => s.rightPanelOpen);
  return (
    <div className={`app${left ? ' has-left' : ''}${right ? ' has-right' : ''}`}>
      <Viewport />
      <Toolbar leading={leading} trailing={trailing} />
      <div className="stage-overlay">
        <div className="stage-overlay__top">
          {banner}
          <ViewBar />
        </div>
        <MeasurementBar />
        <Toasts />
      </div>
      {left && <SceneTree />}
      {right && <Inspector />}
      <StatusBar />
      <HoverTooltip />
      <Dialogs />
    </div>
  );
}

/** @deprecated Phase-1/2-Name – entspricht SimulatorWorkspace ohne App-Navigation. */
export const App = SimulatorWorkspace;
