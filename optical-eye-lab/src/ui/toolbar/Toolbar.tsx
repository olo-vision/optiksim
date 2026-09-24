/**
 * Obere Werkzeugleiste des Simulators: Navigation (von der App eingesetzt), Werkzeuge,
 * Bearbeiten, Simulation, Einstellungen.
 */
import type { ReactNode } from 'react';
import { Copy, Globe, Keyboard, Magnet, MousePointer2, Move3d, Pause, Play, Plus, Redo2, Rotate3d, Settings, Trash2, Undo2, Waypoints } from 'lucide-react';
import { useAppStore, selectCanRedo, selectCanUndo } from '@/state/store';
import { EYE_ID } from '@/model/types';
import { IconButton } from '../common/controls';
import { formatNumber } from '@/core/units';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';

/**
 * `leading`: Navigation/Breadcrumb der umgebenden Anwendung, `trailing`: z. B. Benutzermenü.
 */
export function Toolbar({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  const s = useAppStore();
  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const deletable = !!s.selectedId && s.selectedId !== EYE_ID && !s.selectedId.startsWith('__');
  const duplicable = deletable;
  const hasLights = s.doc.lights.length > 0;

  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--left">{leading}</div>

      <div className="toolbar__group toolbar__group--center">
        <div className="tool-cluster">
          <IconButton icon={MousePointer2} label="Auswahl" shortcut="Q" active={s.tool === 'select'} onClick={() => s.setTool('select')} />
          <IconButton icon={Move3d} label="Verschieben" shortcut="W" active={s.tool === 'translate'} onClick={() => s.setTool('translate')} />
          <IconButton icon={Rotate3d} label="Drehen" shortcut="E" active={s.tool === 'rotate'} onClick={() => s.setTool('rotate')} />
        </div>
        <div className="tool-cluster">
          <IconButton
            icon={Magnet}
            label={`Einrasten (${formatNumber(s.prefs.translationSnap, 1)} mm / ${s.prefs.rotationSnap}°) – Umschalt kehrt um`}
            shortcut="S"
            active={s.snapping}
            onClick={s.toggleSnapping}
          />
          <IconButton
            icon={Globe}
            label={s.transformSpace === 'world' ? 'Achsen: Welt (umschalten auf Lokal)' : 'Achsen: Lokal (umschalten auf Welt)'}
            shortcut="L"
            active={s.transformSpace === 'local'}
            onClick={() => s.setTransformSpace(s.transformSpace === 'world' ? 'local' : 'world')}
          />
        </div>
        <button type="button" className="btn btn--accent" onClick={() => s.openDialog('add-element')} data-tip="Optisches Element hinzufügen  ·  A">
          <Plus size={15} strokeWidth={2} />
          <span className="btn__label">Optisches Element</span>
        </button>
        <div className="tool-cluster">
          <IconButton icon={Copy} label="Duplizieren" shortcut={`${MOD}D`} disabled={!duplicable} onClick={() => s.selectedId && s.duplicateEntity(s.selectedId)} />
          <IconButton icon={Trash2} label="Löschen" shortcut="Entf" disabled={!deletable} onClick={() => s.selectedId && s.deleteEntity(s.selectedId)} />
        </div>
        <div className="tool-cluster">
          <IconButton icon={Undo2} label="Rückgängig" shortcut={`${MOD}Z`} disabled={!canUndo} onClick={s.undo} />
          <IconButton icon={Redo2} label="Wiederholen" shortcut={`${MOD}⇧Z`} disabled={!canRedo} onClick={s.redo} />
        </div>
      </div>

      <div className="toolbar__group toolbar__group--right">
        <div className="tool-cluster tool-cluster--sim">
          <IconButton
            icon={Waypoints}
            label={hasLights ? 'Strahlengang anzeigen (Vorschau)' : 'Strahlengang – zuerst eine Lichtquelle hinzufügen'}
            shortcut="T"
            active={s.doc.display.showRays}
            disabled={!hasLights}
            onClick={() => s.setDocField('display', { showRays: !s.doc.display.showRays })}
            text="Strahlen"
          />
          <IconButton
            icon={s.simulationLive ? Pause : Play}
            label={s.simulationLive ? 'Simulation pausieren (Strahlengang einfrieren)' : 'Simulation starten (Strahlengang live berechnen)'}
            shortcut="Leertaste"
            active={s.simulationLive && s.doc.display.showRays}
            disabled={!s.doc.display.showRays}
            onClick={() => s.setSimulationLive(!s.simulationLive)}
          />
        </div>
        <IconButton icon={Keyboard} label="Tastenkürzel" shortcut="?" onClick={() => s.openDialog('shortcuts')} />
        <IconButton icon={Settings} label="Schnelleinstellungen" onClick={() => s.openDialog('settings')} />
        {trailing}
      </div>
    </header>
  );
}
