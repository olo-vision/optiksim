/**
 * Anwendungs-Shell: Viewport im Hintergrund, schwebende Panels darüber.
 */
import { Viewport } from './scene/Viewport';
import { Toolbar } from './ui/toolbar/Toolbar';
import { ViewBar } from './ui/toolbar/ViewBar';
import { SceneTree } from './ui/sceneTree/SceneTree';
import { Inspector } from './ui/inspector/Inspector';
import { Dialogs } from './ui/dialogs/Dialogs';
import { HoverTooltip, MeasurementBar, StatusBar, Toasts } from './ui/overlays/HudOverlays';
import { useShortcuts } from './ui/useShortcuts';
import { TooltipLayer } from './ui/common/TooltipLayer';
import { useAppStore } from './state/store';

export function App() {
  useShortcuts();
  const left = useAppStore((s) => s.leftPanelOpen);
  const right = useAppStore((s) => s.rightPanelOpen);
  return (
    <div className={`app${left ? ' has-left' : ''}${right ? ' has-right' : ''}`}>
      <Viewport />
      <Toolbar />
      <div className="stage-overlay">
        <ViewBar />
        <MeasurementBar />
        <Toasts />
      </div>
      {left && <SceneTree />}
      {right && <Inspector />}
      <StatusBar />
      <HoverTooltip />
      <Dialogs />
      <TooltipLayer />
    </div>
  );
}
