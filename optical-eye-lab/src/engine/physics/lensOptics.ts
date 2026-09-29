/**
 * Optische Wirkung von Linsen als Sphäre/Zylinder/Achse (Phase 2).
 *
 * SOURCE OF TRUTH ist immer die Geometrie (Radien, Mittendicke, Brechungsindex).
 * Die Rezeptwerte werden daraus berechnet:
 *   F₁ = (n − 1)·K₁ ,  F₂ = (1 − n)·K₂           (K = Krümmungsmatrix, 1/m)
 *   S' = (I − δF₁)⁻¹·F₁ + F₂ ,  δ = d / n          (Scheitelbrechwert, Matrixform, Linse in Luft)
 * Für sphärische Flächen reduziert sich das exakt auf die bisherigen Formeln (thickLens).
 *
 * Die Eingabe optischer Werte löst die Geometrie (designLensForRx) und schreibt nur Geometrie.
 */
import type { EyeEntity, LensElement, LensParams } from '@/model/types';
import { effectiveLens } from '@/model/derived/effectiveLens';
import { lensOutlineFn, resolveLensShape } from '@/model/derived/elementShape';
import { minCenterOf, minEdgeOf, requiredCenterThickness, thicknessModeOf } from './lensThickness';
import {
  backMatrixForBackVertex,
  backVertexMatrix,
  frontMatrixForBackVertex,
  matrixToRx,
  mscale2,
  rxToMatrix,
  principalMeridians,
  type CylForm,
  type Mat2,
  type Rx,
} from '@/core/math/powerMatrix';
import { checkLensShapeGeneral, isToric, specFromCurvatureMatrix, surfacePowerMatrix, type SurfaceSpec } from '@/core/math/surfaces';
import { isContactLens } from '@/model/elementRegistry';

export interface LensOptics {
  /** Scheitelbrechwert-Matrix (dpt) im lokalen TABO-Rahmen der Linse */
  matrix: Mat2;
  rx: Rx;
  front: SurfaceSpec;
  back: SurfaceSpec;
  F1: Mat2;
  F2: Mat2;
  conformed: boolean;
}

/** Wirkung der Linse (freie Geometrie bzw. auf dem Auge angeschmiegt, falls weich und aufgesetzt). */
export function lensOptics(el: LensElement, eye?: EyeEntity, form: CylForm = 'minus'): LensOptics {
  const { front, back, conformed } = effectiveLens(el, eye);
  const n = el.medium.n;
  const F1 = surfacePowerMatrix(front, 1, n);
  const F2 = surfacePowerMatrix(back, n, 1);
  // dieselbe Mittendicke wie Darstellung und Raytracing (resolveLensShape erhöht sie ggf. bei negativer Randdicke)
  const matrix = backVertexMatrix(F1, F2, resolveLensShape(el).centerThickness, n);
  const fallbackAxis = back.axis ?? front.axis ?? 180;
  return { matrix, rx: matrixToRx(matrix, form, fallbackAxis), front, back, F1, F2, conformed };
}

export function lensRx(el: LensElement, form: CylForm = 'minus'): Rx {
  return lensOptics(el, undefined, form).rx;
}

/** Welche Fläche beim Einstellen optischer Werte angepasst wird. */
export function solvedSurface(el: LensElement): 'front' | 'back' {
  // Kontaktlinsen: Basiskurve (Rückfläche) bleibt → Vorderfläche wird berechnet.
  // Brillengläser & Linsen: Basiskurve (Vorderfläche) bleibt → Rückfläche wird berechnet (innentorisch).
  return isContactLens(el) ? 'front' : 'back';
}

export interface LensDesignResult {
  ok: boolean;
  lens: LensParams;
  notes: string[];
}

function specToParams(spec: SurfaceSpec, which: 'front' | 'back'): Partial<LensParams> {
  const R = Number(spec.R.toFixed(6));
  const toric = isToric(spec);
  if (which === 'front')
    return toric ? { frontRadius: R, frontRadius2: Number(spec.R2!.toFixed(6)), frontAxis: spec.axis } : { frontRadius: R, frontRadius2: undefined, frontAxis: undefined };
  return toric ? { backRadius: R, backRadius2: Number(spec.R2!.toFixed(6)), backAxis: spec.axis } : { backRadius: R, backRadius2: undefined, backAxis: undefined };
}

/**
 * Löst die Linsengeometrie für ein gewünschtes Rezept (Scheitelbrechwert in Luft).
 * Die Gegenfläche (Basiskurve) bleibt erhalten.
 *  - Dickenmodus 'auto' (Brillengläser): Mittendicke = max(t_min, e_min + max(s₁ − s₂)) – iterativ, da der
 *    Scheitelbrechwert von der Dicke abhängt (Fixpunkt, konvergiert in wenigen Schritten; auch Verringerung).
 *  - 'manual': Mittendicke bleibt; nur wenn die Randdicke unter das Minimum fiele, wird sie erhöht
 *    (Mindest-Randdicke 0,5 mm Glas / 0,05 mm KL).
 */
export function designLensForRx(el: LensElement, rx: Rx): LensDesignResult {
  const notes: string[] = [];
  const n = el.medium.n;
  const which = solvedSurface(el);
  const T = rxToMatrix(rx);
  const auto = thicknessModeOf(el) === 'auto';
  const minEdge = auto ? minEdgeOf(el) : isContactLens(el) ? 0.05 : el.kind === 'spectacle-lens' ? 0.5 : 0.3;
  const minCenter = auto ? minCenterOf(el) : 0;
  let lens: LensParams = { ...el.lens };
  const fixed = which === 'back'
    ? (lens.frontRadius2 === undefined ? { R: lens.frontRadius } : { R: lens.frontRadius, R2: lens.frontRadius2, axis: lens.frontAxis })
    : (lens.backRadius2 === undefined ? { R: lens.backRadius } : { R: lens.backRadius, R2: lens.backRadius2, axis: lens.backAxis });

  for (let iter = 0; iter < (auto ? 24 : 8); iter++) {
    const t = lens.centerThickness;
    let solved: Mat2;
    let K: Mat2;
    if (which === 'back') {
      solved = backMatrixForBackVertex(T, surfacePowerMatrix(fixed, 1, n), t, n);
      K = mscale2(solved, 1 / (1000 * (1 - n)));
    } else {
      solved = frontMatrixForBackVertex(T, surfacePowerMatrix(fixed, n, 1), t, n);
      K = mscale2(solved, 1 / (1000 * (n - 1)));
    }
    const spec = specFromCurvatureMatrix(K, rx.axis);
    lens = { ...lens, ...specToParams(spec, which) };
    const front: SurfaceSpec = which === 'front' ? spec : fixed;
    const back: SurfaceSpec = which === 'back' ? spec : fixed;
    const check = checkLensShapeGeneral(front, back, t, lensOutlineFn({ ...el, lens }), minEdge);
    if (check.warnings.some((w) => w.startsWith('Durchmesser'))) {
      return { ok: false, lens: el.lens, notes: ['Mit dieser Basiskurve und diesem Durchmesser nicht realisierbar (Radius kleiner als halber Durchmesser).'] };
    }
    if (auto) {
      const tReq = requiredCenterThickness(front, back, lensOutlineFn({ ...el, lens }), minEdge, minCenter);
      if (Math.abs(tReq - t) > 1e-4) {
        lens = { ...lens, centerThickness: Number(tReq.toFixed(4)) };
        continue;
      }
      return { ok: true, lens, notes };
    }
    if (check.centerThickness > t + 1e-4) {
      lens = { ...lens, centerThickness: Number(check.centerThickness.toFixed(3)) };
      continue;
    }
    if (iter > 0) notes.push(`Mittendicke auf ${lens.centerThickness.toFixed(2)} mm erhöht (Mindest-Randdicke ${minEdge} mm).`);
    return { ok: true, lens, notes };
  }
  return { ok: true, lens, notes: [...notes, 'Mittendicke iterativ angepasst.'] };
}

export { principalMeridians };
