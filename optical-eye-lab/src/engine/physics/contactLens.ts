/**
 * Kontaktlinsen-Optik: Tränenlinse und Sitzbeurteilung (Phase 2).
 *
 * Tränenlinse = Tränenfilm zwischen KL-Rückfläche und Hornhautvorderfläche (n ≈ 1,336).
 * Zerlegung über einen gedachten Luftspalt der Dicke 0 (paraxial exakt):
 *   KL (in Luft)  +  Tränenlinse (in Luft)  +  Auge (Hornhaut gegen Luft)
 * Tränenlinse als dicke Linse (Matrixform, torische Hornhaut möglich):
 *   F₁ = (n_T − 1)·K_KL-Rückfläche,  F₂ = (1 − n_T)·K_Hornhaut,  S'_TL = (I − δF₁)⁻¹F₁ + F₂,  δ = t_T / n_T
 * Sphärische Näherung zur Kontrolle: F_TL ≈ (n_T − 1)·(1/r_KL − 1/r_HH)  (r in m)
 */
import type { EyeEntity, LensElement } from '@/model/types';
import { corneaSpec, effectiveLens } from '@/model/derived/effectiveLens';
import { DEFAULT_TEAR_INDEX } from '@/model/derived/contactSeat';
import { backVertexMatrix, matrixToRx, type CylForm, type Mat2, type Rx } from '@/core/math/powerMatrix';
import { radiusInMeridian, surfacePowerMatrix } from '@/core/math/surfaces';

export type FitClass = 'steep' | 'parallel' | 'flat' | 'conformed';

export interface TearLensResult {
  nTear: number;
  thickness: number;
  matrix: Mat2;
  rx: Rx;
  /** KL-Basiskurve im flachen Hornhautmeridian [mm] */
  baseCurve: number;
  /** flacher Hornhautradius (größerer Radius) [mm] */
  flatK: number;
  steepK: number;
  /** Basiskurve − flacher Hornhautradius [mm] */
  deltaR: number;
  fit: FitClass;
  fitLabel: string;
}

export function tearLens(el: LensElement, eye: EyeEntity, form: CylForm = 'minus'): TearLensResult {
  const nTear = el.contact?.nTear ?? DEFAULT_TEAR_INDEX;
  const t = el.contact?.tearFilmThickness ?? 0;
  const back = effectiveLens(el, eye).back;
  const cornea = corneaSpec(eye);
  const F1 = surfacePowerMatrix(back, 1, nTear);
  const F2 = surfacePowerMatrix(cornea, nTear, 1);
  const matrix = backVertexMatrix(F1, F2, t, nTear);
  const r1 = cornea.R;
  const r2 = cornea.R2 ?? cornea.R;
  const flatK = Math.max(r1, r2);
  const steepK = Math.min(r1, r2);
  const flatMeridian = r1 >= r2 ? cornea.axis ?? 180 : (cornea.axis ?? 180) + 90;
  const baseCurve = radiusInMeridian(effectiveLens(el).back, flatMeridian);
  const deltaR = baseCurve - flatK;
  let fit: FitClass;
  if (el.contact?.design === 'soft' && el.contact.onEye) fit = 'conformed';
  else if (deltaR < -0.05) fit = 'steep';
  else if (deltaR > 0.05) fit = 'flat';
  else fit = 'parallel';
  const fitLabel = { steep: 'steiler als K (Tränenlinse +)', parallel: 'parallel (≈ K)', flat: 'flacher als K (Tränenlinse −)', conformed: 'angeschmiegt (weich)' }[fit];
  return { nTear, thickness: t, matrix, rx: matrixToRx(matrix, form, cornea.axis ?? 180), baseCurve, flatK, steepK, deltaR, fit, fitLabel };
}
