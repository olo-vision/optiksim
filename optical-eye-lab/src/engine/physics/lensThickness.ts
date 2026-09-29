/**
 * Glasdicke aus der Geometrie (Phase 5).
 *
 * Randdicke an einem Konturpunkt (x, y), Mittendicke t, Pfeilhöhen s₁ (Vorderfläche) und s₂ (Rückfläche),
 * beide relativ zum jeweiligen Scheitel und positiv in Lichtrichtung (+Z):
 *
 *     e(x, y) = t − s₁(x, y) + s₂(x, y)
 *
 * Fertigungsbedingungen: e ≥ e_min entlang der gesamten Kontur und t ≥ t_min. Die kleinste zulässige
 * Mittendicke ist daher
 *
 *     t = max( t_min ,  e_min + max_Kontur [ s₁ − s₂ ] )
 *
 *  - Plusglas: s₁ > s₂ → die Randbedingung bestimmt t (dünnster Rand an der am weitesten entfernten Konturstelle).
 *  - Minusglas: s₁ < s₂ → t = t_min; die Randdicke folgt aus der Geometrie (dickster Rand außen).
 *
 * Bei gleicher Wirkung, Basiskurve (Vorderflächenradius), Kontur und Zentrierung benötigt ein höherer Index
 * flachere Rückflächen (|F₂| = (n − 1)/|r₂| bei gleichem F₂ ⇒ |r₂| wächst mit n) → |s₁ − s₂| sinkt → dünneres Glas.
 * Da der Scheitelbrechwert selbst von t abhängt (S' = F₁/(1 − t/n·F₁) + F₂), wird im Optik-Modus iteriert.
 *
 * Keine optische Skalierung: Darstellung, Raytracing und Wirkung verwenden dieselbe Mittendicke.
 */
import type { LensElement, LensParams } from '@/model/types';
import { findMaterial } from '@/model/media';
import { lensOutlineFn, lensSurfaces } from '@/model/derived/elementShape';
import { sagXY, minAbsRadius, type SurfaceSpec } from '@/core/math/surfaces';
import { isContactLens } from '@/model/elementRegistry';

/** Standard-Mindestranddicke (Vollrandfassung) [mm] */
export const DEFAULT_MIN_EDGE = 1.0;
/** Standard-Mindestmittendicke, falls das Material keinen Richtwert hat [mm] */
export const DEFAULT_MIN_CENTER = 1.5;

/** Fassungsarten mit typischer Mindestranddicke (Richtwerte) */
export const RIM_PRESETS: Array<{ id: string; label: string; minEdge: number }> = [
  { id: 'full', label: 'Vollrand', minEdge: 1.0 },
  { id: 'nylor', label: 'Nylor (Rille)', minEdge: 1.8 },
  { id: 'rimless', label: 'Randlos (Bohrung)', minEdge: 2.0 },
];

export const thicknessModeOf = (el: LensElement): 'auto' | 'manual' => (isContactLens(el) ? 'manual' : el.lens.thicknessMode ?? 'manual');

export function minCenterOf(el: LensElement): number {
  return el.lens.minCenterThickness ?? findMaterial(el.medium.presetId)?.minCenterThickness ?? DEFAULT_MIN_CENTER;
}

export const minEdgeOf = (el: LensElement): number => el.lens.minEdgeThickness ?? DEFAULT_MIN_EDGE;

export interface EdgeProfile {
  /** max(s₁ − s₂) entlang der Kontur [mm] */
  maxSagDiff: number;
  /** min(s₁ − s₂) entlang der Kontur [mm] */
  minSagDiff: number;
  /** Winkel (lokal, rad) der dünnsten bzw. dicksten Randstelle */
  thinPhi: number;
  thickPhi: number;
  /** Apertur durch Radien begrenzt? */
  clipped: boolean;
}

/** Pfeilhöhendifferenz entlang der Kontur (72 Richtungen). */
export function edgeProfile(front: SurfaceSpec, back: SurfaceSpec, outline: (phi: number) => number, samples = 144): EdgeProfile {
  const limit = Math.min(minAbsRadius(front), minAbsRadius(back)) * 0.995;
  let maxD = -Infinity;
  let minD = Infinity;
  let thinPhi = 0;
  let thickPhi = 0;
  let clipped = false;
  for (let i = 0; i < samples; i++) {
    const phi = (i / samples) * Math.PI * 2;
    let r = outline(phi);
    if (r > limit) {
      r = limit;
      clipped = true;
    }
    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    const d = sagXY(front, x, y) - sagXY(back, x, y);
    if (d > maxD) {
      maxD = d;
      thinPhi = phi;
    }
    if (d < minD) {
      minD = d;
      thickPhi = phi;
    }
  }
  return { maxSagDiff: maxD, minSagDiff: minD, thinPhi, thickPhi, clipped };
}

/** Kleinste zulässige Mittendicke für gegebene Flächen, Kontur und Mindestdicken. */
export function requiredCenterThickness(front: SurfaceSpec, back: SurfaceSpec, outline: (phi: number) => number, minEdge: number, minCenter: number): number {
  const p = edgeProfile(front, back, outline);
  return Math.max(minCenter, minEdge + p.maxSagDiff);
}

/**
 * Mittendicke im Modus 'auto' für die aktuelle Geometrie (Radien fest, Wirkung folgt).
 * Im Modus 'manual' unverändert.
 */
export function withAutoThickness(el: LensElement): LensParams {
  if (thicknessModeOf(el) !== 'auto') return el.lens;
  const { front, back } = lensSurfaces(el);
  const t = requiredCenterThickness(front, back, lensOutlineFn(el), minEdgeOf(el), minCenterOf(el));
  return Math.abs(t - el.lens.centerThickness) < 1e-5 ? el.lens : { ...el.lens, centerThickness: Number(t.toFixed(4)) };
}

export interface LensMassProperties {
  /** Volumen [mm³] */
  volume: number;
  /** Masse [g] (falls Dichte bekannt) */
  mass: number | null;
  /** Randdicke min/max entlang der Kontur [mm] */
  edgeMin: number;
  edgeMax: number;
}

/**
 * Volumen durch Integration der lokalen Dicke e(x, y) = t − s₁ + s₂ über die Kontur (Polarraster):
 *   V = ∫∫ e(r, φ) r dr dφ ,   m = V · ρ   (ρ in g/cm³, V in mm³ → g = mm³ · ρ / 1000)
 */
export function lensMassProperties(el: LensElement, t = el.lens.centerThickness): LensMassProperties {
  const { front, back } = lensSurfaces(el);
  const outline = lensOutlineFn(el);
  const limit = Math.min(minAbsRadius(front), minAbsRadius(back)) * 0.995;
  const NA = 96;
  const NR = 40;
  let V = 0;
  let edgeMin = Infinity;
  let edgeMax = -Infinity;
  for (let i = 0; i < NA; i++) {
    const phi = ((i + 0.5) / NA) * Math.PI * 2;
    const R = Math.min(outline(phi), limit);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const dr = R / NR;
    for (let j = 0; j < NR; j++) {
      const r = (j + 0.5) * dr;
      const e = t - sagXY(front, r * c, r * s) + sagXY(back, r * c, r * s);
      V += Math.max(0, e) * r * dr * ((2 * Math.PI) / NA);
    }
    const eEdge = t - sagXY(front, R * c, R * s) + sagXY(back, R * c, R * s);
    edgeMin = Math.min(edgeMin, eEdge);
    edgeMax = Math.max(edgeMax, eEdge);
  }
  const density = findMaterial(el.medium.presetId)?.density;
  return { volume: V, mass: density ? (V * density) / 1000 : null, edgeMin, edgeMax };
}

/**
 * Basiskurve (Vorderflächenwirkung) nach der Vogel-Regel als Richtwert:
 *   Plusgläser  F_B ≈ SÄ + 6 dpt,   Minusgläser  F_B ≈ SÄ/2 + 6 dpt   (SÄ = sphärisches Äquivalent)
 * Der Radius folgt aus dem Material: r₁ = (n − 1) / F_B – derselbe Flächenbrechwert ist bei höherem Index flacher.
 */
export function vogelBaseCurve(sphericalEquivalent: number, n: number): { power: number; radius: number } {
  const raw = sphericalEquivalent >= 0 ? sphericalEquivalent + 6 : sphericalEquivalent / 2 + 6;
  const power = Math.min(14, Math.max(0.5, raw));
  return { power, radius: (1000 * (n - 1)) / power };
}
