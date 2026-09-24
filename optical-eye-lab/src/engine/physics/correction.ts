/**
 * Korrektion live: Wirkung aller Linsen am Hornhautscheitel und Restrefraktion (Phase 2).
 *
 * Paraxiale Vergenz-Durchrechnung mit dioptrischen Wirkungsmatrizen (Keating):
 *   - Objekt im Unendlichen: Vergenz L = 0 vor dem ersten Element
 *   - an jeder Fläche:          L ← L + F_Fläche
 *   - Übertragung (Strecke d, Medium n):  L ← L·(I − (d/n)·L)⁻¹      (= effectivePower in Matrixform)
 *   - Kontaktlinse auf dem Auge mit Tränenfilm: KL (in Luft) → Tränenlinse (in Luft) → Hornhaut (s. contactLens.ts)
 * Ergebnis am Hornhautscheitel:
 *   Korrektionsvergenz L_HS,   Restrefraktion  R = A_Auge − L_HS   (A_Auge = Refraktion am Hornhautscheitel)
 * Achsen: Elementachsen werden um die Verdrehung des Elements gegenüber dem Auge korrigiert
 * (Drehung um +Z um ψ verringert die TABO-Achse um ψ).
 * Vereinfachung (gekennzeichnet): Dezentration und Neigung werden für die Rezeptrechnung ignoriert;
 * das Raytracing berücksichtigt sie vollständig.
 */
import type { EyeEntity, LensElement, OpticalElement, SceneDocument } from '@/model/types';
import { placementOf } from '@/model/derived/measurements';
import { corneaSpec, effectiveLens } from '@/model/derived/effectiveLens';
import { DEFAULT_TEAR_INDEX, isOnEye } from '@/model/derived/contactSeat';
import { mulMat3TVec, eulerDegToMat3, mulMat3Vec } from '@/core/math/vec';
import {
  effectivityMatrix,
  madd2,
  matrixToRx,
  msub2,
  propagateVergence,
  rotateMatrix,
  ZERO2,
  type CylForm,
  type Mat2,
  type Rx,
} from '@/core/math/powerMatrix';
import { surfacePowerMatrix } from '@/core/math/surfaces';
import { eyeRefractionState, type EyeRefractionState } from './eyeRefraction';
import { lensOptics } from './lensOptics';
import { tearLens, type TearLensResult } from './contactLens';

export interface ElementCorrection {
  id: string;
  name: string;
  /** Eigene Wirkung (Scheitelbrechwert, auf Augenachsen gedreht) */
  ownRx: Rx;
  /** Abstand augenseitiger Scheitel → Hornhautscheitel [mm] */
  vertexDistance: number;
  /** Wirkung dieses Elements allein, übertragen auf den Hornhautscheitel */
  effectiveRx: Rx;
  ownMatrix: Mat2;
  effectiveMatrix: Mat2;
  /** Verdrehung gegenüber dem Auge [°] */
  rollDeg: number;
  tearLens?: TearLensResult;
}

export interface CorrectionResult {
  eye: EyeRefractionState;
  elements: ElementCorrection[];
  /** Vergenz aller Elemente am Hornhautscheitel */
  correctionMatrix: Mat2;
  correctionRx: Rx;
  residualMatrix: Mat2;
  residualRx: Rx;
  notes: string[];
  hasCorrection: boolean;
}

/** Verdrehung ψ eines Elements um die Augenachse (Grad, gegen den Uhrzeigersinn um +Z). */
export function rollRelativeToEye(el: OpticalElement, eye: EyeEntity): number {
  const eyeRot = eulerDegToMat3(...eye.transform.rotation);
  const elRot = eulerDegToMat3(...el.transform.rotation);
  const xWorld = mulMat3Vec(elRot, [1, 0, 0]);
  const xEye = mulMat3TVec(eyeRot, xWorld);
  return (Math.atan2(xEye[1], xEye[0]) * 180) / Math.PI;
}

export interface CorrectionOptions {
  /**
   * Objektpunkt auf der Augenachse (Augen-lokales z in mm, < 0 = vor dem Auge), Phase 4.
   * Fehlt → Objekt im Unendlichen. Beispiele: Skiaskop-Guckloch (−Arbeitsabstand), Sehprobe (−Prüfentfernung).
   * Die Restrefraktion ist dann R = A_Auge − L_HS(Objekt): 0 bedeutet, das Objekt wird scharf auf der Retina abgebildet
   * (Objekt liegt im Fernpunkt des Systems Auge + Gläser).
   */
  objectZ?: number;
}

export function computeCorrection(doc: SceneDocument, form: CylForm = 'minus', opts: CorrectionOptions = {}): CorrectionResult {
  const objectZ = opts.objectZ !== undefined && Number.isFinite(opts.objectZ) && opts.objectZ < -1e-6 ? opts.objectZ : undefined;
  const eyeState = eyeRefractionState(doc.eye.anatomy, form);
  const notes: string[] = [];
  const lenses = doc.elements
    .filter((e): e is LensElement => e.visible && e.family === 'lens')
    .map((e) => ({ el: e, p: placementOf(doc.eye, e) }))
    .filter(({ el, p }) => isOnEye(el) || p.vertexDistance > -0.05)
    // Gläser hinter dem Objekt (vom Auge aus gesehen) wirken nicht
    .filter(({ p }) => objectZ === undefined || p.frontVertexLocal[2] > objectZ + 1e-6)
    .sort((a, b) => a.p.backVertexLocal[2] - b.p.backVertexLocal[2]);

  const others = doc.elements.filter((e) => e.visible && e.family !== 'lens');
  if (others.length) notes.push('Prismen, Platten und freie Medien gehen nicht in die Rezeptrechnung ein (nur im Raytracing).');

  let L: Mat2 = ZERO2;
  let zPrev: number | null = null;
  if (objectZ !== undefined) {
    // divergentes Bündel vom Objektpunkt: Vergenz an der ersten Fläche (bzw. am Hornhautscheitel)
    const z0 = lenses.length ? lenses[0].p.frontVertexLocal[2] : 0;
    const v = -1000 / (z0 - objectZ);
    L = { a: v, b: 0, c: v };
    zPrev = z0;
  }
  const elements: ElementCorrection[] = [];

  for (const { el, p } of lenses) {
    if (p.decentration.r > 0.3 || p.tiltDeg > 1) notes.push(`${el.name}: Dezentration/Neigung in der Rezeptrechnung vernachlässigt (Raytracing berücksichtigt sie).`);
    const roll = rollRelativeToEye(el, doc.eye);
    const rot = (m: Mat2) => rotateMatrix(m, -roll);
    const optics = lensOptics(el, doc.eye);
    const n = el.medium.n;
    const zf = p.frontVertexLocal[2];
    const zb = p.backVertexLocal[2];
    if (zPrev !== null) L = propagateVergence(L, zf - zPrev, 1);
    L = madd2(L, rot(optics.F1));
    L = propagateVergence(L, zb - zf, n);
    L = madd2(L, rot(optics.F2));
    zPrev = zb;

    const ownMatrix = rot(optics.matrix);
    let effectiveMatrix = effectivityMatrix(ownMatrix, p.vertexDistance);
    let tl: TearLensResult | undefined;
    if (isOnEye(el) && (el.contact!.tearFilm ?? true)) {
      tl = tearLens(el, doc.eye, form);
      const nT = el.contact!.nTear ?? DEFAULT_TEAR_INDEX;
      const back = effectiveLens(el, doc.eye).back;
      L = madd2(L, rot(surfacePowerMatrix(back, 1, nT)));
      L = propagateVergence(L, el.contact!.tearFilmThickness, nT);
      L = madd2(L, surfacePowerMatrix(corneaSpec(doc.eye), nT, 1));
      zPrev = 0;
      // Einzelwirkung KL inkl. Tränenlinse am Hornhautscheitel
      let Ls = madd2(ZERO2, rot(optics.matrix));
      Ls = madd2(Ls, rot(surfacePowerMatrix(back, 1, nT)));
      Ls = propagateVergence(Ls, el.contact!.tearFilmThickness, nT);
      effectiveMatrix = madd2(Ls, surfacePowerMatrix(corneaSpec(doc.eye), nT, 1));
    }
    elements.push({
      id: el.id,
      name: el.name,
      ownRx: matrixToRx(ownMatrix, form, optics.rx.axis),
      vertexDistance: p.vertexDistance,
      effectiveRx: matrixToRx(effectiveMatrix, form, optics.rx.axis),
      ownMatrix,
      effectiveMatrix,
      rollDeg: roll,
      tearLens: tl,
    });
  }
  if (zPrev !== null && zPrev < 0) L = propagateVergence(L, -zPrev, 1);

  const residualMatrix = msub2(eyeState.matrix, L);
  return {
    eye: eyeState,
    elements,
    correctionMatrix: L,
    correctionRx: matrixToRx(L, form, eyeState.rx.axis),
    residualMatrix,
    residualRx: matrixToRx(residualMatrix, form, eyeState.rx.axis),
    notes: [...new Set(notes)],
    hasCorrection: lenses.length > 0,
  };
}
