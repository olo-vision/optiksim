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
import { SPECTRAL_LINES, wavelengthToHex } from '@/engine/optics/dispersion';
import { Badge, Section } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, SelectField, ToggleField } from '../common/fields';
import { InfoCardView, InspectorHeader, TransformSection } from './shared';

const signedMm = (v: number) => `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${formatNumber(Math.abs(v), 3)} mm`;

export function LightInspector({ light }: { light: LightSourceEntity }) {
  const updateEntity = useAppStore((s) => s.updateEntity);
  const showRays = useAppStore((s) => s.doc.display.showRays);
  const setDocField = useAppStore((s) => s.setDocField);
  const result = useTraceResultStore((s) => s.result);
  const expert = useAppStore((s) => s.prefs.expertMode);
  const src = light.source;
  const set = (patch: Partial<LightSourceEntity['source']>) => updateEntity(light.id, (e) => ({ ...e, source: { ...(e as LightSourceEntity).source, ...patch } }) as LightSourceEntity);
  const eyeApex = useAppStore((s) => s.doc.eye.transform.position);
  const workingDistance = Math.hypot(light.transform.position[0] - eyeApex[0], light.transform.position[1] - eyeApex[1], light.transform.position[2] - eyeApex[2]);
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
        <SelectField
          label="Strahlenfächer"
          value={src.fanMode ?? 'principal'}
          onChange={(v) => set({ fanMode: v as 'principal' | 'vertical' | 'cross' })}
          options={[
            { value: 'principal', label: 'Hauptschnitte (automatisch)' },
            { value: 'vertical', label: 'Vertikal' },
            { value: 'cross', label: 'Horizontal + vertikal' },
          ]}
          hint="Bei Astigmatismus werden die Fächer automatisch in die Hauptschnitte gelegt (2. Fächer hellblau)."
        />
        <NumberField label={src.kind === 'parallel' ? 'Bündeldurchmesser' : 'Öffnung am Auge'} unit="mm" step={0.5} decimals={1} min={0.1} max={80} value={src.beamDiameter} onChange={(v) => set({ beamDiameter: v })} />
        <NumberField label="Strahlen je Schnitt" unit="none" step={1} decimals={0} min={1} max={61} value={src.rayCount} onChange={(v) => set({ rayCount: Math.round(v) })} />
        <ToggleField label="Sagittalschnitt zusätzlich" value={src.sagittal} onChange={(v) => set({ sagittal: v })} />
        <ColorField label="Strahlfarbe" value={src.color} onChange={(v) => set({ color: v })} />
        <NumberField label="Wellenlänge [nm]" unit="none" step={1} decimals={1} min={380} max={780} value={src.wavelength} hint="Dispersion aktiv: Glas- und Augenmedien werden aus der Abbe-Zahl für diese Wellenlänge berechnet (d-Linie 587,6 nm = Referenz)." onChange={(v) => set({ wavelength: v, color: wavelengthToHex(v) })} />
        <SelectField
          label="Spektrallinie"
          value={SPECTRAL_LINES.find((l) => Math.abs(l.nm - src.wavelength) < 0.6)?.id ?? ''}
          options={[{ value: '', label: '—' }, ...SPECTRAL_LINES.map((l) => ({ value: l.id, label: l.label }))]}
          onChange={(id) => {
            const l = SPECTRAL_LINES.find((x) => x.id === id);
            if (l) set({ wavelength: l.nm, color: id === 'd' ? '#ffd27a' : wavelengthToHex(l.nm) });
          }}
        />
        <ToggleField label="Strahlengang anzeigen" value={showRays} onChange={(v) => setDocField('display', { showRays: v })} />
      </Section>
      {src.deviceRole === 'retinoscope' && (
        <Section title="Skiaskop" badge={<Badge tone="accent">Gerät</Badge>}>
          <ReadoutRow label="Arbeitsabstand" value={formatValue(workingDistance, 'mm', 1)} />
          <ReadoutRow label="Strichlage" value={`${formatNumber(light.retinoscope?.streakAxis ?? 90, 0)}°`} />
          <ReadoutRow label="Spiegel" value={light.retinoscope?.sleeve === 'concave' ? 'Konkav' : 'Plan'} />
          <button type="button" className="btn" style={{ margin: '4px 0' }} onClick={() => useAppStore.getState().setWorkbench('retinoscopy')}>
            Arbeitsbereich Skiaskopie öffnen
          </button>
          <p className="insp-hint">Das Skiaskop wird nicht als Strahlenbündel verfolgt; der Reflex wird im Arbeitsbereich aus der Vergenzrechnung bestimmt.</p>
        </Section>
      )}
      <Section title="Gerät & Beleuchtung" defaultOpen={false} badge={<Badge tone="dev">vorbereitet</Badge>}>
        <ReadoutRow label="Arbeitsabstand zum Hornhautscheitel" value={formatValue(workingDistance, 'mm', 1)} />
        <NumberField label="Intensität" unit="pct" step={5} decimals={0} min={0} max={100} value={(src.intensity ?? 1) * 100} onChange={(v) => set({ intensity: v / 100 })} />
        <NumberField label="Vergenz des Bündels" unit="dpt" step={0.25} decimals={2} min={-20} max={20} value={src.vergence ?? 0} hint="Vorbereitet für Skiaskop (Plan-/Konkavspiegel); wirkt noch nicht auf die Strahlen." onChange={(v) => set({ vergence: v })} />
        <ReadoutRow label="Spaltlampe / Ophthalmoskop" value="In Entwicklung" />
        <p className="insp-hint">Skiaskop: über „Optisches Element → Untersuchungsgeräte“ oder den Arbeitsbereich Skiaskopie.</p>
      </Section>
      <TransformSection entity={light}>
        <p className="insp-hint">Die Strahlen verlassen die Quelle entlang ihrer lokalen +Z-Achse.</p>
      </TransformSection>
      {showRays && result && (
        <Section title="Ergebnis" defaultOpen={expert}>
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
