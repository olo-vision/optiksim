/**
 * Wirksame Linsengeometrie „auf dem Auge“.
 *
 * Formstabile Linsen und alle anderen Elemente: Geometrie = gespeicherte (freie) Geometrie.
 *
 * Weiche Kontaktlinsen auf dem Auge (contact.onEye): vereinfachtes Schmiegungsmodell
 *  - Rückfläche übernimmt die Hornhautform, parallel versetzt um den Tränenfilm (R_hinten = R_HH + t_Tränen,
 *    je Hauptschnitt, gleiche Achse) → Tränenlinse ≈ 0 dpt, Hornhautastigmatismus bleibt wirksam.
 *  - Vorderfläche wird so gelöst, dass der Scheitelbrechwert in Luft (Matrixform) der Nennwirkung der
 *    freien Linse entspricht:  F₁ = X·(I + δX)⁻¹,  X = S'_nenn − F₂.
 *  - NICHT modelliert: Biegungseinfluss auf die Wirkung, Dickenänderung, Randverhalten.
 */
import type { EyeEntity, LensElement } from '../types';
import { lensSurfaces } from './elementShape';
import { isPlano, specFromCurvatureMatrix, surfacePowerMatrix, type SurfaceSpec } from '@/core/math/surfaces';
import { backVertexMatrix, frontMatrixForBackVertex, mscale2 } from '@/core/math/powerMatrix';

export interface EffectiveLens {
  front: SurfaceSpec;
  back: SurfaceSpec;
  /** true = Geometrie weicht wegen Schmiegung von der freien Geometrie ab */
  conformed: boolean;
}

export function corneaSpec(eye: EyeEntity): SurfaceSpec {
  const a = eye.anatomy;
  return a.corneaFrontRadius2 === undefined
    ? { R: a.corneaFrontRadius }
    : { R: a.corneaFrontRadius, R2: a.corneaFrontRadius2, axis: a.corneaAxis ?? 180 };
}

const cache = new WeakMap<object, WeakMap<object, EffectiveLens>>();

export function isSoftOnEye(el: LensElement): boolean {
  return !!el.contact && !!el.contact.onEye && el.contact.design === 'soft';
}

export function effectiveLens(el: LensElement, eye?: EyeEntity): EffectiveLens {
  const free = lensSurfaces(el);
  if (!eye || !isSoftOnEye(el)) return { ...free, conformed: false };
  let inner = cache.get(el.lens);
  if (!inner) {
    inner = new WeakMap();
    cache.set(el.lens, inner);
  }
  const key = el.contact as object;
  const hit = inner.get(eye.anatomy) ;
  if (hit && (hit as EffectiveLens & { _k?: object })._k === key) return hit;

  const n = el.medium.n;
  const t = el.lens.centerThickness;
  const tear = el.contact!.tearFilmThickness;
  const c = corneaSpec(eye);
  const back: SurfaceSpec = {
    R: isPlano(c.R) ? 0 : c.R + tear,
    R2: c.R2 === undefined ? undefined : c.R2 + tear,
    axis: c.axis,
  };
  const nominal = backVertexMatrix(surfacePowerMatrix(free.front, 1, n), surfacePowerMatrix(free.back, n, 1), t, n);
  const F2 = surfacePowerMatrix(back, n, 1);
  const F1 = frontMatrixForBackVertex(nominal, F2, t, n);
  const K1 = mscale2(F1, 1 / (1000 * (n - 1)));
  const front = specFromCurvatureMatrix(K1, c.axis ?? 180);
  const res = { front, back, conformed: true, _k: key } as EffectiveLens & { _k: object };
  inner.set(eye.anatomy, res);
  return res;
}
