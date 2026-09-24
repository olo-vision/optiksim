/**
 * Inspector für das Modellauge.
 */
import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import type { EyeAnatomy, EyeEntity } from '@/model/types';
import { DEFAULT_EYE_ANATOMY } from '@/model/derived/eyeGeometry';
import { entityInfo, EYE_PART_LABELS } from '@/model/derived/infoCards';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { formatNumber, formatPower, formatValue, type UnitId } from '@/core/units';
import { useAppStore } from '@/state/store';
import { Section, Segmented } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, ToggleField } from '../common/fields';
import { EyeGlyph } from '../common/ElementGlyph';
import { InfoCardView, InspectorHeader, TransformSection } from './shared';

type Key = keyof EyeAnatomy;
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
      { key: 'corneaFrontRadius', label: 'Radius vorn', unit: 'mm', step: 0.05, decimals: 2, min: 5, max: 12 },
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
  const setAnat = (k: Key, v: number) => set({ anatomy: { ...a, [k]: v } });
  const locked = eye.locked;

  return (
    <>
      <InspectorHeader entity={eye} typeLabel="Modellauge" icon={<EyeGlyph size={18} />} />
      {part && (
        <div className="insp-part">
          Angeklickt: <strong>{EYE_PART_LABELS[part]}</strong>
        </div>
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

      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} defaultOpen={g.open ?? false}>
          {g.fields.map((f) => (
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

      <Section title="Berechnet (paraxial)">
        <ReadoutRow label="Brechwert Hornhaut" value={formatPower(summary.corneaPower)} formula="Dicke Linse: F = F₁ + F₂ − (d/n)·F₁·F₂" />
        <ReadoutRow label="Brechwert Linse" value={formatPower(summary.lensPower)} />
        <ReadoutRow label="Gesamtbrechwert Auge" value={formatPower(summary.totalPower)} tone="accent" formula="Paraxiale Durchrechnung aller vier Flächen" />
        <ReadoutRow
          label="Bildlage (Objekt ∞)"
          value={Math.abs(summary.defocusMm) < 0.005 ? 'auf der Retina' : `${formatNumber(Math.abs(summary.defocusMm), 2)} mm ${summary.defocusMm < 0 ? 'vor' : 'hinter'} Retina`}
        />
        <ReadoutRow label="Fernpunktrefraktion (HS)" value={formatPower(summary.refractionAtCornea)} tone="accent" formula="Kehrwert des Fernpunktabstands, bezogen auf den Hornhautscheitel" />
        <p className="insp-hint">Grundlage für die späteren Module Fehlsichtigkeit und Korrektion.</p>
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
  );
}
