/**
 * Inspector für optische Elemente.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, LocateFixed } from 'lucide-react';
import type { LensElement, OpticalElement, SurfaceFinish } from '@/model/types';
import { getElementDefinition, isContactLens } from '@/model/elementRegistry';
import { setPath } from '@/model/fieldSchema';
import { CUSTOM_MEDIUM_ID, MEDIA_PRESETS, matchMediumByIndex } from '@/model/media';
import { resolveLensShape } from '@/model/derived/elementShape';
import { computeMeasurements } from '@/model/derived/measurements';
import { entityInfo } from '@/model/derived/infoCards';
import { centerOnAxis, moveToVertexDistance, seatOnCornea } from '@/model/sceneFactory';
import { computeElementOptics, backRadiusForBackVertexPower, frontRadiusForBackVertexPower, thickLens } from '@/engine/physics';
import { formatNumber, formatPower, formatValue } from '@/core/units';
import { useAppStore } from '@/state/store';
import { Section } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, SelectField } from '../common/fields';
import { ElementGlyph } from '../common/ElementGlyph';
import { InfoCardView, InspectorHeader, SchemaFields, TransformSection } from './shared';

const FINISH_OPTIONS: Array<{ value: SurfaceFinish; label: string }> = [
  { value: 'clear', label: 'Klar' },
  { value: 'coated', label: 'Entspiegelt' },
  { value: 'tinted', label: 'Getönt' },
  { value: 'frosted', label: 'Mattiert' },
];

function TargetPowerTool({ el }: { el: LensElement }) {
  const commit = useAppStore((s) => s.commit);
  const current = thickLens(el.medium.n, el.lens.frontRadius, el.lens.backRadius, resolveLensShape(el).centerThickness).backVertexPower;
  const cl = isContactLens(el);
  const [target, setTarget] = useState(Number(current.toFixed(2)));
  const [surface, setSurface] = useState<'front' | 'back'>(cl || el.lens.backRadius === 0 ? 'front' : el.kind === 'spectacle-lens' ? 'back' : 'front');
  const apply = () => {
    const t = el.lens.centerThickness;
    const n = el.medium.n;
    const R =
      surface === 'front' ? frontRadiusForBackVertexPower(target, n, el.lens.backRadius, t) : backRadiusForBackVertexPower(target, n, el.lens.frontRadius, t);
    const key = surface === 'front' ? 'frontRadius' : 'backRadius';
    commit((doc) => ({
      ...doc,
      elements: doc.elements.map((e) => (e.id === el.id && e.family === 'lens' ? { ...e, lens: { ...e.lens, [key]: Number(R.toFixed(3)) } } : e)),
    }));
  };
  return (
    <Section title="Scheitelbrechwert vorgeben" defaultOpen={false}>
      <NumberField label="Soll S'∞" unit="dpt" step={0.25} decimals={2} value={target} min={-40} max={60} onChange={setTarget} />
      <SelectField
        label="Anpassen"
        value={surface}
        onChange={(v) => setSurface(v as 'front' | 'back')}
        options={[
          { value: 'front', label: 'Vorderfläche r₁' },
          { value: 'back', label: cl ? 'Rückfläche (Basiskurve)' : 'Rückfläche r₂' },
        ]}
      />
      <button type="button" className="btn btn--solid btn--block" disabled={el.locked} onClick={apply}>
        Radius berechnen und übernehmen
      </button>
      <p className="insp-hint">Löst S'∞ = F₁/(1 − (d/n)·F₁) + F₂ nach der gewählten Fläche auf (Linse in Luft).</p>
    </Section>
  );
}

export function ElementInspector({ el }: { el: OpticalElement }) {
  const doc = useAppStore((s) => s.doc);
  const commit = useAppStore((s) => s.commit);
  const decimals = useAppStore((s) => s.prefs.decimals);
  const def = getElementDefinition(el.kind);
  const locked = el.locked;

  const report = useMemo(() => computeMeasurements(doc), [doc]);
  const placement = report.placements.find((p) => p.id === el.id);
  const optics = useMemo(() => computeElementOptics(el, placement?.tiltDeg ?? 0), [el, placement?.tiltDeg]);
  const warnings = el.family === 'lens' ? resolveLensShape(el).warnings : [];
  const cl = isContactLens(el);
  const seated = cl && placement ? Math.abs(placement.vertexDistance - (el.family === 'lens' ? (el.contact?.tearFilmThickness ?? 0) : 0)) < 0.03 && placement.decentration.r < 0.05 : false;

  const update = (fn: (e: OpticalElement) => OpticalElement) =>
    commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? fn(e) : e)) }));

  const onField = (path: string, value: unknown) =>
    update((e) => {
      const next = setPath(e, path, value);
      // Kontaktlinse bleibt auf der Hornhaut, wenn sie dort saß
      return seated ? seatOnCornea(next, doc) : next;
    });

  const chainIndex = report.chain.findIndex((c) => c.toId === el.id);
  const prevGap = chainIndex >= 0 ? report.chain[chainIndex] : undefined;
  const nextGap = report.chain.find((c) => c.fromId === el.id);
  const fmtMm = (v: number) => formatValue(v, 'mm', decimals);

  return (
    <>
      <InspectorHeader entity={el} typeLabel={def.label} icon={<ElementGlyph kind={el.kind} size={18} />} />

      <TransformSection entity={el} scale={el.family === 'medium'}>
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" disabled={locked} onClick={() => update((e) => centerOnAxis(e, doc))} data-tip="Auf optische Achse zentrieren und parallel zum Auge ausrichten">
            <Crosshair size={14} />
            <span>Auf Achse zentrieren</span>
          </button>
          {cl && (
            <button type="button" className="btn btn--ghost" disabled={locked} onClick={() => update((e) => seatOnCornea(e, doc))} data-tip="Linse zentriert auf den Hornhautscheitel setzen">
              <LocateFixed size={14} />
              <span>Auf Hornhaut setzen</span>
            </button>
          )}
        </div>
      </TransformSection>

      {placement && (
        <Section title="Lage zum Auge">
          <NumberField
            label={el.kind === 'spectacle-lens' ? 'HSA (axial)' : 'Abstand zum Hornhautscheitel'}
            hint="Axialer Abstand Hornhautscheitel → augenseitiger Scheitel. Eingabe verschiebt das Element entlang der optischen Achse."
            unit="mm"
            step={0.5}
            decimals={decimals}
            value={placement.vertexDistance}
            disabled={locked}
            onChange={(v) => update((e) => moveToVertexDistance(e, doc, placement.vertexDistance, v))}
          />
          <ReadoutRow label="Direkter Abstand" value={fmtMm(placement.directDistance)} />
          <ReadoutRow label="Dezentration horizontal" value={fmtMm(placement.decentration.x)} />
          <ReadoutRow label="Dezentration vertikal" value={fmtMm(placement.decentration.y)} />
          <ReadoutRow label="Neigung zur Achse" value={formatValue(placement.tiltDeg, 'deg', 1)} />
          {prevGap && <ReadoutRow label={`Luftabstand zu ${prevGap.fromName}`} value={fmtMm(prevGap.gap)} tone={prevGap.gap < 0 ? 'warn' : undefined} />}
          {nextGap && <ReadoutRow label={`Luftabstand zu ${nextGap.toName}`} value={fmtMm(nextGap.gap)} tone={nextGap.gap < 0 ? 'warn' : undefined} />}
        </Section>
      )}

      <SchemaFields entity={el} groups={def.fields} onChange={onField} disabled={locked} />

      {warnings.length > 0 && (
        <div className="insp-warning">
          <AlertTriangle size={14} />
          <div>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}

      <Section title="Optisches Medium">
        <SelectField
          label="Medium"
          value={el.medium.presetId}
          disabled={locked}
          options={[
            ...MEDIA_PRESETS.map((m) => ({ value: m.id, label: `${m.name} (${formatNumber(m.n, 3)})`, group: m.group })),
            { value: CUSTOM_MEDIUM_ID, label: 'Benutzerdefiniert', group: 'Sonstige' },
          ]}
          onChange={(id) => {
            const m = MEDIA_PRESETS.find((x) => x.id === id);
            update((e) => ({ ...e, medium: m ? { presetId: m.id, n: m.n, abbe: m.abbe } : { ...e.medium, presetId: CUSTOM_MEDIUM_ID } }));
          }}
        />
        <NumberField
          label="Brechungsindex n"
          unit="n"
          step={0.001}
          decimals={4}
          min={1}
          max={3}
          value={el.medium.n}
          disabled={locked}
          hint="Frei eingebbar. Passt der Wert zu einem Preset, wird dieses ausgewählt."
          onChange={(n) => update((e) => ({ ...e, medium: { presetId: matchMediumByIndex(n)?.id ?? CUSTOM_MEDIUM_ID, n, abbe: matchMediumByIndex(n)?.abbe } }))}
        />
        <ReadoutRow label="Abbe-Zahl ν" value={el.medium.abbe ? formatNumber(el.medium.abbe, 1) : '–'} formula="Vorbereitet für spätere Dispersionsberechnung" />
      </Section>

      {optics.length > 0 && (
        <Section title="Berechnete Werte">
          {optics.map((c) => (
            <ReadoutRow
              key={c.id}
              label={c.label}
              formula={c.formula}
              tone={c.id === 'Sv' || c.id === 'P' ? 'accent' : undefined}
              value={
                c.unit === 'dpt'
                  ? formatPower(c.value)
                  : c.unit === 'none'
                    ? `${formatNumber(c.value, c.decimals)}×`
                    : formatValue(c.value, c.unit, c.decimals)
              }
            />
          ))}
          <p className="insp-hint">Paraxial, Element in Luft. Formel per Maus-Hover.</p>
        </Section>
      )}

      {el.family === 'lens' && <TargetPowerTool key={`${el.id}-${el.lens.frontRadius}-${el.lens.backRadius}`} el={el} />}

      <Section title="Material & Darstellung">
        <SelectField label="Oberfläche" value={el.appearance.finish} disabled={locked} options={FINISH_OPTIONS} onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, finish: v as SurfaceFinish } }))} />
        <ColorField label="Farbton" value={el.appearance.tint} onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, tint: v } }))} />
        <NumberField
          label="Transparenz"
          unit="pct"
          step={1}
          decimals={0}
          min={0}
          max={100}
          value={el.appearance.transparency * 100}
          disabled={locked}
          onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, transparency: v / 100 } }))}
        />
      </Section>

      <InfoCardView card={entityInfo(el)} />
    </>
  );
}
