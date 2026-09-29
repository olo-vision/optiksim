/**
 * Dickenberechnung, Formscheiben-Zentrierung und Gewicht eines Glases (Phase 5).
 * Gemeinsam genutzt vom Inspector und vom Modul „Brillenglas“ – keine doppelte Logik:
 * alle Werte kommen aus engine/physics/lensThickness.ts.
 */
import { useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import type { LensElement, LensParams } from '@/model/types';
import { findMaterial } from '@/model/media';
import { resolveLensShape } from '@/model/derived/elementShape';
import { lensMassProperties, minCenterOf, minEdgeOf, RIM_PRESETS, thicknessModeOf, vogelBaseCurve, DEFAULT_MIN_CENTER } from '@/engine/physics/lensThickness';
import { lensOptics } from '@/engine/physics/lensOptics';
import { formatNumber } from '@/core/units';
import { Segmented } from '../common/controls';
import { NumberField, ReadoutRow } from '../common/fields';

export function useLensThicknessInfo(el: LensElement) {
  return useMemo(() => {
    const shape = resolveLensShape(el);
    const mass = lensMassProperties(el, shape.centerThickness);
    const rx = lensOptics(el).rx;
    const se = rx.sph + rx.cyl / 2;
    const plusLike = mass.edgeMin < shape.centerThickness - 1e-3;
    return { shape, mass, rx, se, plusLike, minCenter: minCenterOf(el), minEdge: minEdgeOf(el), auto: thicknessModeOf(el) === 'auto' };
  }, [el]);
}

export function LensThicknessFields({
  el,
  onPatch,
  onBaseCurve,
  disabled,
  compact,
}: {
  el: LensElement;
  /** Parameteränderung (Aufrufer entscheidet: Wirkung halten oder Geometrie übernehmen) */
  onPatch: (patch: Partial<LensParams>) => void;
  /** Basiskurve setzen (Vorderflächenradius) – nur im Optik-Modus sinnvoll */
  onBaseCurve?: (radius: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const info = useLensThicknessInfo(el);
  const mat = findMaterial(el.medium.presetId);
  const { shape, mass, auto } = info;
  const off = el.lens.opticalCenterOffset ?? { x: 0, y: 0 };
  const vogel = vogelBaseCurve(info.se, el.medium.n);
  return (
    <>
      <div className="field">
        <span className="field__label">Dicke</span>
        <div className="field__control field__control--flush">
          <Segmented
            size="sm"
            value={auto ? 'auto' : 'manual'}
            onChange={(v) => onPatch({ thicknessMode: v })}
            options={[
              { value: 'auto', label: 'Automatisch', tip: 'Mittendicke aus Mindest-Mitten- und Mindest-Randdicke (Fertigung)' },
              { value: 'manual', label: 'Manuell', tip: 'Mittendicke frei eingeben' },
            ]}
          />
        </div>
      </div>
      {auto && (
        <>
          <NumberField
            label="Mindestmittendicke"
            unit="mm"
            step={0.1}
            decimals={2}
            min={0.3}
            max={10}
            value={info.minCenter}
            disabled={disabled}
            hint={`Richtwert ${mat?.name ?? 'Material'}: ${formatNumber(mat?.minCenterThickness ?? DEFAULT_MIN_CENTER, 1)} mm – bestimmt die Dicke von Minusgläsern.`}
            onChange={(v) => onPatch({ minCenterThickness: v })}
          />
          <NumberField
            label="Mindestranddicke"
            unit="mm"
            step={0.1}
            decimals={2}
            min={0.3}
            max={10}
            value={info.minEdge}
            disabled={disabled}
            hint="Dünnste Stelle der Kontur – bestimmt die Mittendicke von Plusgläsern (Fassungsart)."
            onChange={(v) => onPatch({ minEdgeThickness: v })}
          />
          <div className="chip-row">
            {RIM_PRESETS.map((r) => (
              <button key={r.id} type="button" className={`chip${Math.abs(info.minEdge - r.minEdge) < 1e-6 ? ' is-on' : ''}`} disabled={disabled} onClick={() => onPatch({ minEdgeThickness: r.minEdge })}>
                {r.label} {formatNumber(r.minEdge, 1)}
              </button>
            ))}
          </div>
        </>
      )}
      {!compact && (
        <>
          <NumberField
            label="Opt. Mittelpunkt horizontal"
            unit="mm"
            step={0.5}
            decimals={1}
            min={-15}
            max={15}
            value={off.x}
            disabled={disabled}
            hint="Lage des optischen Mittelpunkts relativ zur Kastenmitte der Formscheibe (+ = Richtung 0° TABO). Verschiebt dünne/dicke Randstellen."
            onChange={(v) => onPatch({ opticalCenterOffset: { x: v, y: off.y } })}
          />
          <NumberField
            label="Opt. Mittelpunkt vertikal"
            unit="mm"
            step={0.5}
            decimals={1}
            min={-15}
            max={15}
            value={off.y}
            disabled={disabled}
            hint="+ = nach oben (90°)."
            onChange={(v) => onPatch({ opticalCenterOffset: { x: off.x, y: v } })}
          />
        </>
      )}
      <ReadoutRow label="Mittendicke" value={`${formatNumber(shape.centerThickness, 2)} mm`} tone="accent" formula={auto ? 't = max(t_min ; e_min + max(s₁ − s₂))' : 'manuell'} />
      <ReadoutRow label="Randdicke min / max" value={`${formatNumber(mass.edgeMin, 2)} / ${formatNumber(mass.edgeMax, 2)} mm`} formula="e = t − s₁ + s₂ entlang der Kontur" />
      {auto && <ReadoutRow label="Bestimmend" value={info.plusLike && mass.edgeMin <= info.minEdge + 0.01 ? 'Mindestranddicke (Plusglas)' : 'Mindestmittendicke'} />}
      <ReadoutRow label="Volumen / Gewicht" value={`${formatNumber(mass.volume / 1000, 2)} cm³${mass.mass !== null ? ` · ${formatNumber(mass.mass, 1)} g` : ''}`} formula="V = ∬ e(x, y) dA,  m = V · ρ" />
      {onBaseCurve && (
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" disabled={disabled} onClick={() => onBaseCurve(Number(vogel.radius.toFixed(1)))} data-tip={`Vogel-Regel: Basiskurve ≈ ${info.se >= 0 ? 'SÄ + 6' : 'SÄ/2 + 6'} dpt = ${formatNumber(vogel.power, 2)} dpt → r₁ = (n − 1)/F = ${formatNumber(vogel.radius, 1)} mm`}>
            <Wand2 size={14} />
            <span>Basiskurve nach Vogel ({formatNumber(vogel.power, 2)} dpt)</span>
          </button>
        </div>
      )}
    </>
  );
}
