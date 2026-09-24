/**
 * Materialauswahl passend zum Element (Phase 4) und strukturierte Materialdaten.
 * Brillengläser zeigen nur Brillenglasmaterialien, formstabile KL nur formstabile Materialien usw.
 */
import type { MediumRef, OpticalElement } from '@/model/types';
import { CATEGORY_LABEL, CUSTOM_MEDIUM_ID, dkOverT, findMaterial, materialsForElement, oxygenRating } from '@/model/media';
import { indexAt, LAMBDA_C, LAMBDA_F } from '@/engine/optics/dispersion';
import { formatNumber } from '@/core/units';
import { useAppStore } from '@/state/store';
import { ReadoutRow, SelectField } from '../common/fields';

export function MaterialSelect({ el, disabled, onChange }: { el: OpticalElement; disabled?: boolean; onChange: (m: MediumRef) => void }) {
  const design = el.family === 'lens' ? el.contact?.design : undefined;
  const list = materialsForElement(el.kind, design);
  const current = findMaterial(el.medium.presetId);
  const options = [
    ...list.map((m) => ({ value: m.id, label: `${m.name} (${formatNumber(m.n, 3)})`, group: m.category === 'spectacle' ? `Brillenglas · ${m.subgroup}` : CATEGORY_LABEL[m.category] })),
    ...(current && !list.some((m) => m.id === current.id) ? [{ value: current.id, label: `${current.name} (${formatNumber(current.n, 3)})`, group: 'Aktuell (andere Kategorie)' }] : []),
    { value: CUSTOM_MEDIUM_ID, label: 'Benutzerdefiniert', group: 'Sonstige' },
  ];
  return (
    <SelectField
      label="Material"
      value={el.medium.presetId}
      disabled={disabled}
      options={options}
      onChange={(id) => {
        const m = findMaterial(id);
        if (m) onChange({ presetId: m.id, n: m.n, abbe: m.abbe });
        else onChange({ ...el.medium, presetId: CUSTOM_MEDIUM_ID });
      }}
    />
  );
}

/** Materialkennwerte; Details im Expertenmodus */
export function MaterialReadouts({ el, thickness }: { el: OpticalElement; thickness?: number }) {
  const expert = useAppStore((s) => s.prefs.expertMode);
  const m = findMaterial(el.medium.presetId);
  const abbe = el.medium.abbe ?? m?.abbe;
  const n = el.medium.n;
  const isContact = el.family === 'lens' && !!el.contact;
  const dkt = m?.dk !== undefined && thickness ? dkOverT(m.dk, thickness) : null;
  return (
    <>
      <ReadoutRow label="Abbe-Zahl ν_d" value={abbe ? formatNumber(abbe, 1) : '–'} formula={abbe ? 'ν = (n_d − 1)/(n_F − n_C) – je kleiner, desto stärker die Farbzerlegung' : 'Keine Dispersion hinterlegt'} />
      {isContact && m?.dk !== undefined && <ReadoutRow label="Dk" value={formatNumber(m.dk, m.dk < 10 ? 1 : 0)} formula="Sauerstoffdurchlässigkeit ×10⁻¹¹ (cm²/s)·(ml O₂/(ml·mmHg))" />}
      {isContact && dkt !== null && <ReadoutRow label="Dk/t (Mittendicke)" value={formatNumber(dkt, 0)} formula={`Dk/(10·t) ×10⁻⁹ – ${oxygenRating(dkt).label}`} tone={oxygenRating(dkt).tone === 'ok' ? 'ok' : undefined} />}
      {isContact && m?.waterContent !== undefined && <ReadoutRow label="Wassergehalt" value={`${m.waterContent} %`} />}
      {expert && (
        <>
          {abbe && <ReadoutRow label="n_F / n_C" value={`${formatNumber(indexAt(n, abbe, LAMBDA_F), 4)} / ${formatNumber(indexAt(n, abbe, LAMBDA_C), 4)}`} formula="Cauchy-Näherung aus n_d und ν_d" />}
          {m?.density !== undefined && <ReadoutRow label="Dichte" value={`${formatNumber(m.density, 2)} g/cm³`} />}
          {m?.uvCutoff !== undefined && <ReadoutRow label="UV-Kante (Richtwert)" value={`${m.uvCutoff} nm`} />}
          {m?.modulus !== undefined && <ReadoutRow label="E-Modul" value={`${formatNumber(m.modulus, 2)} MPa`} />}
          {m?.wettingAngle !== undefined && <ReadoutRow label="Benetzungswinkel" value={`${m.wettingAngle}°`} />}
          {m && <ReadoutRow label="Materialgruppe" value={`${CATEGORY_LABEL[m.category]} · ${m.subgroup}`} />}
        </>
      )}
    </>
  );
}
