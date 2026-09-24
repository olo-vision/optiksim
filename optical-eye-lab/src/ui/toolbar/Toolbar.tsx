/**
 * Obere Werkzeugleiste: Projekt, Datei, Werkzeuge, Bearbeiten, Simulation, Einstellungen.
 */
import { useRef } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Globe,
  Keyboard,
  Magnet,
  MousePointer2,
  Move3d,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCcw,
  Rotate3d,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Waypoints,
} from 'lucide-react';
import { useAppStore, selectCanRedo, selectCanUndo } from '@/state/store';
import { SCENE_PRESETS } from '@/state/presets';
import { exportSceneFile, importSceneFile } from '@/state/persistence';
import { EYE_ID } from '@/model/types';
import { IconButton } from '../common/controls';
import { Menu } from '../common/overlays';
import { formatNumber } from '@/core/units';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';

function Brand() {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" className="brand__mark" aria-hidden>
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
        <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        <path d="M1.5 12 H6.5 M17.5 12 H22.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.2" />
      </svg>
      <span className="brand__name">Optical Eye Lab</span>
    </div>
  );
}

export function Toolbar() {
  const s = useAppStore();
  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const fileInput = useRef<HTMLInputElement>(null);
  const deletable = !!s.selectedId && s.selectedId !== EYE_ID && !s.selectedId.startsWith('__');
  const duplicable = deletable;
  const hasLights = s.doc.lights.length > 0;

  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--left">
        <Brand />
        <div className="toolbar__sep" />
        <Menu
          trigger={(open) => (
            <button type="button" className={`toolbar__menu-btn${open ? ' is-open' : ''}`}>
              <span className="toolbar__scene-name">{s.doc.name}</span>
              {s.dirty && <span className="dirty-dot" data-tip="Ungespeicherte Änderungen" />}
              <ChevronDown size={13} />
            </button>
          )}
          items={[
            { heading: true, label: 'Szene' },
            { label: 'Neue Szene', icon: FilePlus2, onSelect: s.newScene, description: 'Leere Szene mit Modellauge' },
            { label: 'Speichern', icon: Save, shortcut: `${MOD}S`, onSelect: s.saveCurrent, description: 'Lokal im Browser speichern' },
            { label: 'Gespeicherte Szenen …', icon: FolderOpen, shortcut: `${MOD}O`, onSelect: () => s.openDialog('load') },
            { label: 'Zurücksetzen', icon: RefreshCcw, onSelect: s.resetScene, disabled: !s.dirty, description: 'Auf zuletzt gespeicherten/geladenen Stand' },
            { separator: true, label: '' },
            { label: 'Als Datei exportieren', icon: Download, onSelect: () => exportSceneFile(s.doc), description: 'JSON-Datei (.oel.json)' },
            { label: 'Datei importieren …', icon: Upload, onSelect: () => fileInput.current?.click() },
            { separator: true, label: '' },
            { heading: true, label: 'Demo-Szenen' },
            ...SCENE_PRESETS.map((p) => ({ label: p.name, icon: Sparkles, description: p.description, onSelect: () => s.loadPreset(p.id) })),
          ]}
          width={300}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const doc = await importSceneFile(f);
            if (doc) s.loadDocument(doc, `„${doc.name}“ importiert`);
            else s.notify('Datei konnte nicht gelesen werden (kein gültiges Szenenformat).', 'warning');
          }}
        />
      </div>

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
          <span>Optisches Element</span>
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
        <IconButton icon={Settings} label="Einstellungen" onClick={() => s.openDialog('settings')} />
      </div>
    </header>
  );
}
