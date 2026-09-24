/**
 * Inspector für Lichtquellen, Messpunkte und den Laborraum.
 */
import { Box, Crosshair, Lightbulb } from 'lucide-react';
import type { LightSourceEntity, MeasurePointEntity } from '@/model/types';
import { worldToEyeLocal } from '@/model/sceneFactory';
import { entityInfo } from '@/model/derived/infoCards';
import { formatNumber, formatValue } from '@/core/units';
import { useAppStore } from '@/state/store';
import { useTraceResultStore } from '@/scene/overlays/traceResultStore';
import { Badge, Section } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, SelectField, ToggleField } from '../common/fields';
import { InfoCardView, InspectorHeader, TransformSection } from './shared';

const signedMm = (v: number) => `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${formatNumber(Math.abs(v), 3)} mm`;

export function LightInspector({ light }: { light: LightSourceEntity }) {
  const updateEntity = useAppStore((s) => s.updateEntity);
  const showRays = useAppStore((s) => s.doc.display.showRays);
  const setDocField = useAppStore((s) => s.setDocField);
  const result = useTraceResultStore((s) => s.result);
  const src = light.source;
  const set = (patch: Partial<LightSourceEntity['source']>) => updateEntity(light.id, (e) => ({ ...e, source: { ...(e as LightSourceEntity).source, ...patch } }) as LightSourceEntity);
  const mine = result?.paths.filter((p) => p.sourceId === light.id) ?? [];
  const count = (t: string) => mine.filter((p) => p.termination === t).length;

  return (
    <>
      <InspectorHeader entity={light} typeLabel="Lichtquelle" icon={<Lightbulb size={16} />} />
      <Section title="Strahlenbündel" badge={<Badge tone="accent">Vorschau</Badge>}>
        <SelectField
          label="Art"
          value={src.kind}
          onChange={(v) => set({ kind: v as 'parallel' | 'point' })}
          options={[
            { value: 'parallel', label: 'Parallel (Objekt im Unendlichen)' },
            { value: 'point', label: 'Punktquelle (endliche Entfernung)' },
          ]}
        />
        <NumberField label={src.kind === 'parallel' ? 'Bündeldurchmesser' : 'Öffnung am Auge'} unit="mm" step={0.5} decimals={1} min={0.1} max={80} value={src.beamDiameter} onChange={(v) => set({ beamDiameter: v })} />
        <NumberField label="Strahlen je Schnitt" unit="none" step={1} decimals={0} min={1} max={61} value={src.rayCount} onChange={(v) => set({ rayCount: Math.round(v) })} />
        <ToggleField label="Sagittalschnitt zusätzlich" value={src.sagittal} onChange={(v) => set({ sagittal: v })} />
        <ColorField label="Strahlfarbe" value={src.color} onChange={(v) => set({ color: v })} />
        <NumberField label="Wellenlänge" unit="none" step={1} decimals={1} min={380} max={780} value={src.wavelength} hint="Parameter vorbereitet – Dispersion ist noch nicht aktiv (n gilt für die d-Linie)." onChange={(v) => set({ wavelength: v })} />
        <ToggleField label="Strahlengang anzeigen" value={showRays} onChange={(v) => setDocField('display', { showRays: v })} />
      </Section>
      <TransformSection entity={light}>
        <p className="insp-hint">Die Strahlen verlassen die Quelle entlang ihrer lokalen +Z-Achse.</p>
      </TransformSection>
      {showRays && result && (
        <Section title="Ergebnis">
          <ReadoutRow label="Strahlen gesamt" value={String(mine.length)} />
          <ReadoutRow label="Treffen die Retina" value={String(count('retina'))} tone="accent" />
          <ReadoutRow label="Blockiert (Iris/Rand)" value={String(count('blocked'))} />
          <ReadoutRow label="Verlassen die Szene" value={String(count('escaped'))} />
          {result.focus && (
            <>
              <ReadoutRow
                label="Fokus achsnah (rel. Retina)"
                value={signedMm(result.focus.paraxialDefocusMm)}
                formula="Schnittpunkt von Hauptstrahl und innersten Strahlen im Glaskörper; − = vor der Retina"
                tone="accent"
              />
              <ReadoutRow
                label="Fokus Bündel (kleinste Streuung)"
                value={signedMm(result.focus.defocusMm)}
                formula="Punkt kleinster quadratischer Abweichung aller Strahlen – enthält die sphärische Aberration"
              />
              <ReadoutRow label="Zerstreuungsbild (RMS)" value={formatValue(result.focus.retinaSpotRms * 1000, 'none', 0) + ' µm'} />
            </>
          )}
          <ReadoutRow label="Rechenzeit" value={`${formatNumber(result.computeMs, 2)} ms`} />
          <p className="insp-hint">Vektorielles Snellius-Gesetz an sphärischen und planen Flächen. Noch ohne Dispersion, Fresnel-Verluste und Tränenfilm.</p>
        </Section>
      )}
      <InfoCardView card={entityInfo(light)} />
    </>
  );
}

export function MeasurePointInspector({ point }: { point: MeasurePointEntity }) {
  const updateEntity = useAppStore((s) => s.updateEntity);
  const eye = useAppStore((s) => s.doc.eye);
  const decimals = useAppStore((s) => s.prefs.decimals);
  const p = worldToEyeLocal(eye, point.transform.position);
  const fmt = (v: number) => formatValue(v, 'mm', decimals);
  return (
    <>
      <InspectorHeader entity={point} typeLabel="Messpunkt" icon={<Crosshair size={16} />} />
      <TransformSection entity={point} rotation={false} />
      <Section title="Messwerte">
        <ReadoutRow label="Abstand zum Hornhautscheitel" value={fmt(Math.hypot(p[0], p[1], p[2]))} tone="accent" />
        <ReadoutRow label="Axial (vor dem Auge +)" value={fmt(-p[2])} />
        <ReadoutRow label="Abstand zur optischen Achse" value={fmt(Math.hypot(p[0], p[1]))} />
        <ReadoutRow label="Augenkoordinaten x / y / z" value={`${formatNumber(p[0], 1)} / ${formatNumber(p[1], 1)} / ${formatNumber(p[2], 1)}`} />
      </Section>
      <Section title="Darstellung">
        <ColorField label="Farbe" value={point.color} onChange={(v) => updateEntity(point.id, (e) => ({ ...e, color: v }) as MeasurePointEntity)} />
      </Section>
      <InfoCardView card={entityInfo(point)} />
    </>
  );
}

export function RoomInspector() {
  const env = useAppStore((s) => s.doc.environment);
  const display = useAppStore((s) => s.doc.display);
  const quality = useAppStore((s) => s.prefs.quality);
  const setDocField = useAppStore((s) => s.setDocField);
  return (
    <>
      <div className="insp-header">
        <div className="insp-header__top">
          <span className="insp-header__icon">
            <Box size={16} />
          </span>
          <span className="insp-header__type">Laborraum</span>
        </div>
      </div>
      <Section title="Umgebung">
        <ToggleField label="Raum (Boden, Podest)" value={env.showRoom} onChange={(v) => setDocField('environment', { showRoom: v })} />
        <ToggleField label="Optische Bank" value={env.showBench} onChange={(v) => setDocField('environment', { showBench: v })} />
        <ToggleField label="Bodenraster" value={env.showGrid} onChange={(v) => setDocField('environment', { showGrid: v })} />
        <ToggleField label="Bodenreflexion" value={env.reflections} disabled={quality !== 'high'} onChange={(v) => setDocField('environment', { reflections: v })} />
        {quality !== 'high' && <p className="insp-hint">Reflexionen nur in der Qualitätsstufe „Hoch“ (Einstellungen).</p>}
        <NumberField label="Belichtung" unit="none" step={0.05} decimals={2} min={0.4} max={2} value={env.exposure} onChange={(v) => setDocField('environment', { exposure: v })} />
      </Section>
      <Section title="Einblendungen">
        <ToggleField label="Optische Achse" value={display.showOpticalAxis} onChange={(v) => setDocField('display', { showOpticalAxis: v })} />
        <ToggleField label="Bemaßung" value={display.showDimensions} onChange={(v) => setDocField('display', { showDimensions: v })} />
        <ToggleField label="Maßkette aller Elemente" value={display.showAllDimensions} onChange={(v) => setDocField('display', { showAllDimensions: v })} />
        <ToggleField label="Strahlengang" value={display.showRays} onChange={(v) => setDocField('display', { showRays: v })} />
      </Section>
    </>
  );
}
