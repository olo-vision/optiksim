/**
 * Schwebende Ansichtsleiste über dem Viewport: Projektion, Standardansichten,
 * Fokus-Funktionen, Augenansicht (Normal/Schnitt) und Einblendungen.
 */
import { Axis3d, Crosshair, Home, Maximize, Ruler, ScanEye } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { EYE_ID } from '@/model/types';
import { IconButton, Segmented } from '../common/controls';

export function ViewBar() {
  const projection = useAppStore((s) => s.projection);
  const setProjection = useAppStore((s) => s.setProjection);
  const cam = useAppStore((s) => s.sendCameraCommand);
  const viewMode = useAppStore((s) => s.doc.eye.viewMode);
  const display = useAppStore((s) => s.doc.display);
  const setDocField = useAppStore((s) => s.setDocField);
  const updateEntity = useAppStore((s) => s.updateEntity);
  const hasSelection = useAppStore((s) => !!s.selectedId);

  return (
    <div className="viewbar">
      <Segmented
        size="sm"
        value={projection}
        onChange={setProjection}
        options={[
          { value: 'perspective', label: 'Perspektive', tip: 'Perspektivische Ansicht  ·  5' },
          { value: 'orthographic', label: 'Ortho', tip: 'Orthografische Ansicht  ·  5' },
        ]}
      />
      <div className="viewbar__sep" />
      <div className="viewbar__views">
        <button type="button" className="chip" onClick={() => cam({ type: 'view', view: 'front' })} data-tip="Frontansicht (Blick auf das Auge)  ·  1">
          Front
        </button>
        <button type="button" className="chip" onClick={() => cam({ type: 'view', view: 'side' })} data-tip="Seitenansicht  ·  3">
          Seite
        </button>
        <button type="button" className="chip" onClick={() => cam({ type: 'view', view: 'top' })} data-tip="Draufsicht  ·  7">
          Oben
        </button>
      </div>
      <div className="viewbar__sep" />
      <IconButton size="sm" icon={ScanEye} label="Auge fokussieren" shortcut="G" onClick={() => cam({ type: 'focus-eye' })} />
      <IconButton size="sm" icon={Maximize} label="Szene fokussieren" shortcut="H" onClick={() => cam({ type: 'focus-scene' })} />
      <IconButton size="sm" icon={Crosshair} label="Auswahl fokussieren" shortcut="F" disabled={!hasSelection} onClick={() => cam({ type: 'focus-selection' })} />
      <IconButton size="sm" icon={Home} label="Kamera zurücksetzen" shortcut="Pos1" onClick={() => cam({ type: 'reset' })} />
      <div className="viewbar__sep" />
      <Segmented
        size="sm"
        value={viewMode}
        onChange={(v) => updateEntity(EYE_ID, (e) => ({ ...e, viewMode: v }) as typeof e)}
        options={[
          { value: 'normal', label: 'Normal', tip: 'Äußere Ansicht des Auges' },
          { value: 'section', label: 'Schnitt', tip: 'Halbschnitt mit Beschriftung  ·  X' },
        ]}
      />
      <div className="viewbar__sep" />
      <IconButton size="sm" icon={Axis3d} label="Optische Achse" active={display.showOpticalAxis} onClick={() => setDocField('display', { showOpticalAxis: !display.showOpticalAxis })} />
      <IconButton size="sm" icon={Ruler} label="Bemaßung" shortcut="M" active={display.showDimensions} onClick={() => setDocField('display', { showDimensions: !display.showDimensions })} />
    </div>
  );
}
