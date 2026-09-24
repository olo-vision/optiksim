/**
 * Optische Kennwerte einzelner Elemente – ausschließlich berechnete Werte,
 * die im Inspector als „berechnet“ gekennzeichnet angezeigt werden.
 */
import type { OpticalElement } from '@/model/types';
import { resolveLensShape } from '@/model/derived/elementShape';
import {
  deviationToPrismDiopters,
  magnifierPower,
  prismMinimumDeviation,
  thickLens,
  thinPrismDeviation,
} from './formulas';

export interface ComputedValue {
  id: string;
  label: string;
  value: number;
  unit: 'dpt' | 'mm' | 'deg' | 'pdpt' | 'none';
  decimals: number;
  signed?: boolean;
  /** Kurzer Hinweis zur Formel (für späteren Lernmodus) */
  formula?: string;
}

/**
 * @param tiltDeg Neigung der Elementachse zur optischen Achse (für Plattenversatz)
 */
export function computeElementOptics(el: OpticalElement, tiltDeg = 0): ComputedValue[] {
  const n = el.medium.n;
  switch (el.family) {
    case 'lens': {
      const shape = resolveLensShape(el);
      const r = thickLens(n, el.lens.frontRadius, el.lens.backRadius, shape.centerThickness);
      const out: ComputedValue[] = [
        { id: 'F1', label: 'Flächenbrechwert F₁', value: r.F1, unit: 'dpt', decimals: 2, signed: true, formula: "F₁ = (n − 1) / r₁" },
        { id: 'F2', label: 'Flächenbrechwert F₂', value: r.F2, unit: 'dpt', decimals: 2, signed: true, formula: "F₂ = (1 − n) / r₂" },
        { id: 'F', label: 'Brechwert F (äquivalent)', value: r.F, unit: 'dpt', decimals: 2, signed: true, formula: 'F = F₁ + F₂ − (d/n)·F₁·F₂' },
        { id: 'Sv', label: "Scheitelbrechwert S'∞", value: r.backVertexPower, unit: 'dpt', decimals: 2, signed: true, formula: "S'∞ = F₁/(1 − (d/n)·F₁) + F₂" },
        { id: 'f', label: "Brennweite f'", value: r.focalLength, unit: 'mm', decimals: 1, formula: "f' = 1 / F" },
        { id: 'edge', label: 'Randdicke', value: shape.edgeThickness, unit: 'mm', decimals: 2 },
      ];
      if (el.kind === 'magnifier') {
        out.push({ id: 'gamma', label: 'Normalvergrößerung Γ', value: magnifierPower(r.F), unit: 'none', decimals: 2, formula: 'Γ = F / 4 dpt' });
      }
      return out;
    }
    case 'prism': {
      const a = el.prism.apexAngle;
      const dThin = thinPrismDeviation(n, a);
      const dMin = prismMinimumDeviation(n, a);
      return [
        { id: 'dthin', label: 'Ablenkung δ (dünnes Prisma)', value: dThin, unit: 'deg', decimals: 2, formula: 'δ ≈ (n − 1)·α' },
        { id: 'dmin', label: 'Minimalablenkung δ_min', value: dMin, unit: 'deg', decimals: 2, formula: 'δ_min = 2·arcsin(n·sin(α/2)) − α' },
        { id: 'P', label: 'Prismatische Wirkung P', value: deviationToPrismDiopters(dThin), unit: 'pdpt', decimals: 2, formula: 'P = 100·tan δ' },
      ];
    }
    case 'plate': {
      const t = el.plate.thickness;
      const th = (Math.abs(tiltDeg) * Math.PI) / 180;
      const thr = Math.asin(Math.sin(th) / n);
      const shift = th > 1e-6 ? (t * Math.sin(th - thr)) / Math.cos(thr) : 0;
      return [
        { id: 'F', label: 'Brechwert', value: 0, unit: 'dpt', decimals: 2, signed: true },
        { id: 'shift', label: 'Parallelversatz (akt. Neigung)', value: shift, unit: 'mm', decimals: 3, formula: "v = d·sin(ε − ε') / cos ε'" },
        { id: 'axial', label: 'Bildverschiebung (axial)', value: t * (1 - 1 / n), unit: 'mm', decimals: 3, formula: 'Δ = d·(1 − 1/n)' },
      ];
    }
    case 'medium':
      return [];
  }
}
