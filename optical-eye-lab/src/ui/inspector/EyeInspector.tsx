/**
 * Inspector für das Modellauge.
 */
import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import type { AmetropiaMode, EyeAnatomy, EyeEntity } from '@/model/types';
import { computeCorrection, eyeRefractionState, explainAxialLength, explainEffectivePower, explainEyeRefraction, explainResidual, formatRx, solveEyeForRefraction } from '@/engine/physics';
import { effectivityMatrix, matrixToRx, type Rx } from '@/core/math/powerMatrix';
import { useTraceResultStore } from '@/scene/overlays/traceResultStore';
import { RxEditor } from '../common/RxEditor';
import { DEFAULT_EYE_ANATOMY } from '@/model/derived/eyeGeometry';
import { entityInfo, EYE_PART_LABELS } from '@/model/derived/infoCards';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { formatNumber, formatPower, formatValue, type UnitId } from '@/core/units';
import { useAppStore } from '@/state/store';
import { Section, Segmented } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, ToggleField } from '../common/fields';
import { EyeGlyph } from '../common/ElementGlyph';
import { InfoCardView, InspectorHeader, TransformSection } from './shared';

type Key = Exclude<keyof EyeAnatomy, 'corneaFrontRadius2' | 'corneaAxis' | 'corneaAsphericity'>;
interface F {
  key: Key;
  label: string;
  unit: UnitId;
  step: number;
  decimals: number;
  min: number;
  max: number;
  hint?: string;
}

const GROUPS: Array<{ title: string; fields: F[]; open?: boolean }> = [
  {
    title: 'Hornhaut',
    open: true,
    fields: [
      { key: 'corneaFrontRadius', label: 'Radius vorn (Hauptschnitt 1)', unit: 'mm', step: 0.05, decimals: 2, min: 5, max: 12 },
      { key: 'corneaBackRadius', label: 'Radius hinten', unit: 'mm', step: 0.05, decimals: 2, min: 4, max: 12 },
      { key: 'corneaThickness', label: 'Mittendicke', unit: 'mm', step: 0.01, decimals: 2, min: 0.2, max: 1.2 },
      { key: 'corneaDiameter', label: 'Durchmesser (HVID)', unit: 'mm', step: 0.1, decimals: 1, min: 9, max: 14 },
      { key: 'nCornea', label: 'Brechungsindex', unit: 'n', step: 0.001, decimals: 4, min: 1, max: 2 },
    ],
  },
  {
    title: 'Vorderkammer',
    fields: [
      { key: 'anteriorChamberDepth', label: 'Tiefe (ab Scheitel)', unit: 'mm', step: 0.05, decimals: 2, min: 1.5, max: 5.5, hint: 'Hornhautscheitel → Linsenvorderfläche' },
      { key: 'nAqueous', label: 'Brechungsindex', unit: 'n', step: 0.001, decimals: 4, min: 1, max: 2 },
    ],
  },
  {
    title: 'Pupille',
    open: true,
    fields: [{ key: 'pupilDiameter', label: 'Durchmesser', unit: 'mm', step: 0.1, decimals: 1, min: 1, max: 9 }],
  },
  {
    title: 'Augenlinse',
    fields: [
      { key: 'lensFrontRadius', label: 'Radius vorn', unit: 'mm', step: 0.1, decimals: 2, min: 4, max: 20 },
      { key: 'lensBackRadius', label: 'Radius hinten', unit: 'mm', step: 0.1, decimals: 2, min: -20, max: -3 },
      { key: 'lensThickness', label: 'Dicke', unit: 'mm', step: 0.05, decimals: 2, min: 2, max: 6 },
      { key: 'lensDiameter', label: 'Durchmesser', unit: 'mm', step: 0.1, decimals: 1, min: 6, max: 11 },
      { key: 'nLens', label: 'Brechungsindex', unit: 'n', step: 0.001, decimals: 4, min: 1, max: 2 },
    ],
  },
  {
    title: 'Augapfel',
    open: true,
    fields: [
      { key: 'axialLength', label: 'Baulänge', unit: 'mm', step: 0.1, decimals: 2, min: 18, max: 32, hint: 'Hornhautscheitel → Retina (Achse)' },
      { key: 'globeRadius', label: 'Äquatorradius', unit: 'mm', step: 0.1, decimals: 1, min: 10, max: 14 },
      { key: 'nVitreous', label: 'Brechungsindex Glaskörper', unit: 'n', step: 0.001, decimals: 4, min: 1, max: 2 },
    ],
  },
];

export function EyeInspector({ eye }: { eye: EyeEntity }) {
  const updateEntity = useAppStore((s) => s.updateEntity);
  const part = useAppStore((s) => s.selectedEyePart);
  const a = eye.anatomy;
  const summary = useMemo(() => summarizeEye(a), [a]);
  const set = (patch: Partial<EyeEntity>) => updateEntity(eye.id, (e) => ({ ...e, ...patch }) as EyeEntity);
  const form = useAppStore((s) => s.prefs.cylForm);
  const notify = useAppStore((s) => s.notify);
  const doc = useAppStore((s) => s.doc);
  const showRays = doc.display.showRays;
  const trace = useTraceResultStore((s) => s.result);
  const mode = eye.ametropiaMode ?? 'auto';
  const refr = useMemo(() => eyeRefractionState(a, form), [a, form]);
  const correction = useMemo(() => computeCorrection(doc, form), [doc, form]);
  const spectacleRx = useMemo(() => matrixToRx(effectivityMatrix(refr.matrix, -12), form, refr.rx.axis), [refr, form]);
  const applyRefraction = (rx: Rx, m: AmetropiaMode) => {
    const r = solveEyeForRefraction(a, rx, m);
    if (!r.reachable) notify(r.notes[0], 'warning');
    set({ anatomy: r.anatomy, ametropiaMode: m });
  };
  const signed = (v: number) => `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${formatNumber(Math.abs(v), 2)} mm`;
  const setAnat = (k: Key, v: number) => set({ anatomy: { ...a, [k]: v } });
  const locked = eye.locked;
  const expert = useAppStore((s) => s.prefs.expertMode);

  return (
    <>
      <InspectorHeader entity={eye} typeLabel="Modellauge" icon={<EyeGlyph size={18} />} />
      {part && (
        <div className="insp-part">
          Angeklickt: <strong>{EYE_PART_LABELS[part]}</strong>
        </div>
      )}

      {doc.training?.hidden ? (
        <Section title="Trainingsfall">
          <p className="insp-hint">
            Refraktion, Anatomie und Korrektionswerte sind verborgen. Bestimme die Refraktion in den Arbeitsbereichen Skiaskopie oder Refraktion.
          </p>
          <ReadoutRow label="Patient" value={doc.training.title} />
          <ReadoutRow label="Beschwerde" value={doc.training.complaint} />
        </Section>
      ) : (
      <>
      <Section title="Refraktionsstatus">
        <div className="field">
          <span className="field__label">Art der Fehlsichtigkeit</span>
          <div className="field__control field__control--flush">
            <Segmented
              size="sm"
              value={mode}
              onChange={(v) => {
                updateEntity(eye.id, (e) => ({ ...e, ametropiaMode: v }) as EyeEntity);
                applyRefraction(refr.rx, v);
              }}
              options={[
                { value: 'auto', label: 'Auto', tip: 'Standardmodell: Sphäre als Achsenametropie, Zylinder als Hornhautastigmatismus' },
                { value: 'axial', label: 'Achse', tip: 'Achsenametropie: Baulänge wird angepasst' },
                { value: 'refractive', label: 'Brechung', tip: 'Brechungsametropie: Hornhautradien werden angepasst, Baulänge = Le Grand' },
              ]}
            />
          </div>
        </div>
        <RxEditor value={refr.rx} disabled={locked} onChange={(rx) => applyRefraction(rx, mode)} hint="Refraktion am Hornhautscheitel" />
        <ReadoutRow label={`Hauptschnitt ${formatNumber(refr.meridians[0].meridian, 0)}°`} value={`r ${formatNumber(refr.meridians[0].corneaRadius, 2)} mm · ${formatPower(refr.meridians[0].refraction)}`} explain={explainEyeRefraction(refr.meridians[0], refr.meridians[1], refr.rx)} />
        {refr.astigmatic && <ReadoutRow label={`Hauptschnitt ${formatNumber(refr.meridians[1].meridian, 0)}°`} value={`r ${formatNumber(refr.meridians[1].corneaRadius, 2)} mm · ${formatPower(refr.meridians[1].refraction)}`} />}
        <ReadoutRow label="Baulänge" value={formatValue(a.axialLength, 'mm', 2)} explain={mode !== 'refractive' ? explainAxialLength(refr.meridians[0].refraction, a.axialLength) : undefined} />
        {refr.astigmatic && <ReadoutRow label="Sturmsches Intervall (paraxial)" value={formatValue(refr.sturmIntervalMm, 'mm', 2)} />}
        <ReadoutRow
          label="Brillenwert bei HSA 12 mm"
          value={formatRx(spectacleRx)}
          explain={explainEffectivePower(refr.rx.sph, -12, spectacleRx.sph, 'Brillenglasort (HSA 12 mm)')}
        />
        <p className="insp-hint">Ausgangspunkt ist das Le-Grand-Normalauge. Achsenametropie ändert die Baulänge, Brechungsametropie die Hornhautradien; Astigmatismus entsteht über eine torische Hornhaut.</p>
      </Section>

      {correction.hasCorrection && (
        <Section title="Korrektion">
          <ReadoutRow label="Korrektion am Hornhautscheitel" value={formatRx(correction.correctionRx)} />
          <ReadoutRow
            label="Restrefraktion"
            value={formatRx(correction.residualRx)}
            tone={Math.abs(correction.residualRx.sph) < 0.125 && Math.abs(correction.residualRx.cyl) < 0.125 ? 'ok' : 'warn'}
            explain={explainResidual(correction.eye.rx, correction.correctionRx, correction.residualRx)}
          />
          {correction.elements.map((c) => (
            <ReadoutRow key={c.id} label={`${c.name} (am HS)`} value={formatRx(c.effectiveRx)} />
          ))}
        </Section>
      )}

      {showRays && trace?.focus && (
        <Section title="Fokuslage (Raytracing)">
          {trace.focus.astigmatism ? (
            <>
              {trace.focus.astigmatism.lines.map((l, i) => (
                <ReadoutRow key={i} label={`Brennlinie ${i + 1} (Meridian ${formatNumber(l.meridianDeg, 0)}°)`} value={signed(l.defocusMm)} />
              ))}
              <ReadoutRow label="Sturmsches Intervall" value={formatValue(trace.focus.astigmatism.sturmIntervalMm, 'mm', 2)} />
              <ReadoutRow label="Kreis kleinster Verwirrung (vereinfacht)" value={signed(trace.focus.astigmatism.leastConfusionDefocusMm)} />
            </>
          ) : (
            <ReadoutRow label="Fokus relativ zur Retina" value={signed(trace.focus.paraxialDefocusMm)} tone={Math.abs(trace.focus.paraxialDefocusMm) < 0.05 ? 'ok' : undefined} />
          )}
          <p className="insp-hint">− = vor der Retina, + = hinter der Retina.</p>
        </Section>
      )}

      </>
      )}
      <Section title="Ansicht">
        <div className="field">
          <span className="field__label">Darstellung</span>
          <div className="field__control field__control--flush">
            <Segmented
              size="sm"
              value={eye.viewMode}
              onChange={(v) => set({ viewMode: v })}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'section', label: 'Schnitt' },
                { value: 'fluorescein', label: 'Fluo' },
              ]}
            />
          </div>
        </div>
        <ToggleField label="Beschriftung im Schnitt" value={eye.showLabels} onChange={(v) => set({ showLabels: v })} />
        <ColorField label="Irisfarbe" value={eye.irisColor} onChange={(v) => set({ irisColor: v })} />
      </Section>

      <TransformSection entity={eye}>
        <p className="insp-hint">Ursprung des Auges = Hornhautscheitel. Die Rotation entspricht der Blickrichtung.</p>
      </TransformSection>

      {!doc.training?.hidden && (
      <>
      {!expert && <p className="insp-hint" style={{ padding: '6px 12px 0' }}>Standardansicht: wichtigste Anatomiewerte. Brechungsindizes und Augenlinse im Expertenmodus.</p>}
      {GROUPS.filter((g) => expert || (g.title !== 'Augenlinse' && g.title !== 'Vorderkammer')).map((g) => (
        <Section key={g.title} title={g.title} defaultOpen={g.open ?? false}>
          {g.title === 'Hornhaut' && (
            <>
              {expert && (
                <NumberField label="Asphärizität Q" unit="none" step={0.05} decimals={2} min={-1} max={0.5} value={a.corneaAsphericity ?? 0} disabled={locked} hint="Konische Konstante (typ. −0,26). Wirkt auf KL-Sitz und Fluoreszein; paraxial ohne Einfluss." onChange={(v) => set({ anatomy: { ...a, corneaAsphericity: v } })} />
              )}
              <ToggleField
                label="Torische Hornhaut"
                value={a.corneaFrontRadius2 !== undefined}
                disabled={locked}
                onChange={(v) => set({ anatomy: v ? { ...a, corneaFrontRadius2: a.corneaFrontRadius, corneaAxis: a.corneaAxis ?? 180 } : { ...a, corneaFrontRadius2: undefined } })}
              />
              {a.corneaFrontRadius2 !== undefined && (
                <>
                  <NumberField label="Radius vorn, Hauptschnitt 2" unit="mm" step={0.05} decimals={2} min={5} max={12} value={a.corneaFrontRadius2} disabled={locked} onChange={(v) => set({ anatomy: { ...a, corneaFrontRadius2: v } })} />
                  <NumberField label="Achslage Hauptschnitt 1" unit="deg" step={1} decimals={0} min={0} max={180} value={a.corneaAxis ?? 180} disabled={locked} onChange={(v) => set({ anatomy: { ...a, corneaAxis: v } })} />
                </>
              )}
            </>
          )}
          {g.fields.filter((f) => expert || f.unit !== 'n').map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              unit={f.unit}
              step={f.step}
              decimals={f.decimals}
              min={f.min}
              max={f.max}
              hint={f.hint}
              value={a[f.key]}
              disabled={locked}
              onChange={(v) => setAnat(f.key, v)}
            />
          ))}
        </Section>
      ))}

      <Section title="Brechwerte (paraxial)" defaultOpen={false}>
        {refr.meridians.slice(0, refr.astigmatic ? 2 : 1).map((m) => (
          <div key={m.meridian}>
            {refr.astigmatic && <div className="subhead">Hauptschnitt {formatNumber(m.meridian, 0)}°</div>}
            <ReadoutRow label="Gesamtbrechwert Auge" value={formatPower(m.totalPower)} tone="accent" formula="Paraxiale Durchrechnung aller vier Flächen" />
            <ReadoutRow
              label="Bildlage (Objekt ∞)"
              value={Math.abs(m.defocusMm) < 0.005 ? 'auf der Retina' : `${formatNumber(Math.abs(m.defocusMm), 2)} mm ${m.defocusMm < 0 ? 'vor' : 'hinter'} Retina`}
            />
          </div>
        ))}
        <ReadoutRow label="Brechwert Hornhaut (HS 1)" value={formatPower(summary.corneaPower)} formula="Dicke Linse: F = F₁ + F₂ − (d/n)·F₁·F₂" />
        <ReadoutRow label="Brechwert Linse" value={formatPower(summary.lensPower)} />
      </Section>

      <div className="btn-row btn-row--pad">
        <button type="button" className="btn btn--ghost" disabled={locked} onClick={() => set({ anatomy: { ...DEFAULT_EYE_ANATOMY } })}>
          <RotateCcw size={14} />
          <span>Le-Grand-Werte wiederherstellen</span>
        </button>
      </div>

      <InfoCardView card={entityInfo(eye, part)} />
      <p className="insp-hint insp-hint--pad">Tipp: Teile des Auges anklicken, um ihre Daten zu sehen. Baulänge: {formatValue(a.axialLength, 'mm', 2)}</p>
      </>
      )}
    </>
  );
}
