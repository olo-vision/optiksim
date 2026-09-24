/**
 * Sehen des Patienten (Phase 4): Netzhautdefokus, Akkommodation, Punktbildfunktion, Visus-Schätzung.
 *
 * 1) Defokus für ein Sehzeichen in der Prüfentfernung d:
 *      E = A_Auge − L_HS(Objekt)       (computeCorrection mit objectZ = −d; enthält Messgläser, HSA, KL, Tränenlinse)
 *    E = 0: scharf. E < 0: Bild vor der Netzhaut (myop), E > 0: hinter der Netzhaut (hyperop).
 * 2) Akkommodation: Der Patient kann die Brechkraft um α ∈ [0, AB] erhöhen → E' = E − α·I.
 *    Er wählt α so, dass der Kreis kleinster Verwirrung auf der Netzhaut liegt: α = clamp(M, 0, AB),
 *    M = sphärisches Äquivalent von E. Myoper Defokus (M < 0) kann nicht wegakkommodiert werden (→ Nebeln).
 *    Akkommodationsbreite nach Hofstetter (Mittelwert): AB = 18,5 − 0,30 · Alter (≥ 0).
 * 3) Geometrische Punktbildfunktion: Ein Strahl durch den Pupillenpunkt x (m) trifft die Netzhaut mit der
 *    Winkelabweichung Δθ = E·x (rad). Die PSF ist das Bild der Pupillenscheibe unter E – eine gleichmäßig
 *    ausgeleuchtete Ellipse (Halbachsen P·|λ₁|, P·|λ₂|; bei reinem Zylinder eine Linie). Berechnet als
 *    „Spot-Diagramm“ über ein Pupillenraster, anschließend Beugung als Gauß-Näherung des Airy-Scheibchens
 *    σ ≈ 0,42·λ/D. Keine Aberrationen höherer Ordnung, kein Stiles-Crawford-Effekt, keine Streuung.
 * 4) Visus (Schätzung): MAR = √(MAR₀² + (K·p·B)²) mit K ≈ 0,65 (empirische Näherung nach Smith 1991),
 *    p Pupillendurchmesser [mm], B = Blurstärke √(M² + J²) mit J = halber Zylinder, MAR₀ = √(1 + (1,2/p)²)
 *    (Beugungsgrenze bei kleiner Pupille). Visus dezimal = 1/MAR. Ausdrücklich eine Schätzung.
 * 5) Chromatische Längsaberration (Rot-Grün-Test): Refraktion des Modellauges bei λ aus den dispersiven
 *    Augenmedien (dispersion.ts, „chromatisches Auge“) – Rot liegt weiter hinten (hyperoper) als Grün.
 */
import type { EyeAnatomy, SceneDocument } from '@/model/types';
import { computeCorrection } from '@/engine/physics/correction';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { eigen2, madd2, matrixToRx, rxToMatrix, type Mat2 } from '@/core/math/powerMatrix';
import { EYE_MEDIA_ABBE, indexAt, LAMBDA_D } from './dispersion';

export const DEFAULT_TEST_DISTANCE = 6000;

export function accommodationAmplitude(age: number): number {
  return Math.max(0, 18.5 - 0.3 * age);
}

export interface BlurInput {
  /** Fehlermatrix am Hornhautscheitel [dpt] */
  E: Mat2;
  pupilDiameterMm: number;
  wavelengthNm?: number;
}

/** Blurstärke B = √(M² + J²) [dpt] */
export function blurStrength(E: Mat2): number {
  const e = eigen2(E);
  const M = (e.l1 + e.l2) / 2;
  const J = (e.l1 - e.l2) / 2;
  return Math.hypot(M, J);
}

export function estimateAcuity(E: Mat2, pupilDiameterMm: number) {
  const p = Math.max(0.5, pupilDiameterMm);
  const B = blurStrength(E);
  const mar0 = Math.sqrt(1 + (1.2 / p) ** 2);
  const mar = Math.sqrt(mar0 * mar0 + (0.65 * p * B) ** 2);
  return { mar, decimal: 1 / mar, logMAR: Math.log10(mar), blurStrength: B };
}

export const formatVisus = (v: number) => (v >= 1.95 ? '2,0' : v.toFixed(v < 0.1 ? 2 : 1).replace('.', ','));

export interface PatientViewState {
  /** Defokus vor Akkommodation */
  E0: Mat2;
  /** gewählte Akkommodation [dpt] */
  accommodation: number;
  amplitude: number;
  /** wirksamer Defokus */
  E: Mat2;
  pupilDiameter: number;
  acuity: ReturnType<typeof estimateAcuity>;
  /** Restfehler als Rezept (Minuszylinder) */
  residualRx: ReturnType<typeof matrixToRx>;
}

export interface PatientViewOptions {
  testDistanceMm?: number;
  /** Pupille überschreiben (z. B. Lochblende) */
  pupilDiameterMm?: number;
  /** Zusätzliche Wirkung vor dem Auge (Kreuzzylinder, Nebelglas) – als dünnes Glas am Hornhautscheitel */
  extra?: Mat2;
  /** Messgläser ignorieren (Vergleich „unkorrigiert“) */
  withoutTrialLens?: boolean;
  /** alle Korrektionsgläser ignorieren */
  uncorrected?: boolean;
}

export function patientViewState(doc: SceneDocument, opts: PatientViewOptions = {}): PatientViewState {
  const d = opts.testDistanceMm ?? doc.refraction?.testDistance ?? DEFAULT_TEST_DISTANCE;
  let src = doc;
  if (opts.uncorrected) src = { ...doc, elements: doc.elements.filter((e) => e.family !== 'lens') };
  else if (opts.withoutTrialLens) src = { ...doc, elements: doc.elements.filter((e) => !(e.family === 'lens' && e.role === 'trial')) };
  const corr = computeCorrection(src, 'minus', { objectZ: -d });
  let E0 = corr.residualMatrix;
  if (opts.extra) E0 = { a: E0.a - opts.extra.a, b: E0.b - opts.extra.b, c: E0.c - opts.extra.c };
  const patient = doc.eye.patient;
  const amplitude = patient ? (patient.amplitude ?? accommodationAmplitude(patient.age)) : 0;
  const e = eigen2(E0);
  const M = (e.l1 + e.l2) / 2;
  const accommodation = patient?.accommodates ? Math.max(0, Math.min(amplitude, M)) : 0;
  const E = { a: E0.a - accommodation, b: E0.b, c: E0.c - accommodation };
  const pupil = opts.pupilDiameterMm ?? doc.eye.anatomy.pupilDiameter;
  return { E0, accommodation, amplitude, E, pupilDiameter: pupil, acuity: estimateAcuity(E, pupil), residualRx: matrixToRx(E, 'minus') };
}

/* ------------------------ Chromatische Aberration ------------------------ */

function anatomyAt(a: EyeAnatomy, lambda: number): EyeAnatomy {
  const f = (n: number) => indexAt(n, EYE_MEDIA_ABBE, lambda);
  return { ...a, nCornea: f(a.nCornea), nAqueous: f(a.nAqueous), nLens: f(a.nLens), nVitreous: f(a.nVitreous) };
}

/**
 * Änderung der Refraktion des Modellauges bei Wellenlänge λ gegenüber der d-Linie [dpt]
 * (> 0: Auge ist für diese Farbe hyperoper, z. B. Rot).
 */
export function chromaticRefractionShift(a: EyeAnatomy, lambda: number): number {
  if (Math.abs(lambda - LAMBDA_D) < 0.5) return 0;
  const sph = { ...a, corneaFrontRadius2: undefined };
  return summarizeEye(anatomyAt(sph, lambda)).refractionAtCornea - summarizeEye(sph).refractionAtCornea;
}

/** Wellenlängen der Duochrom-Filter (Schwerpunkt, Richtwert) */
export const DUOCHROME = { red: 620, green: 535 };

/* ------------------------------ Kreuzzylinder ------------------------------ */

/**
 * Jackson-Kreuzzylinder ±p mit Minusachse bei `axis` (TABO):  = +p sph −2p cyl A axis.
 * Umschlagen (flipped) vertauscht Plus- und Minusachse.
 */
export function jccMatrix(power: number, axis: number, flipped: boolean): Mat2 {
  const minusAxis = flipped ? axis + 90 : axis;
  return rxToMatrix({ sph: power, cyl: -2 * power, axis: minusAxis });
}

/* -------------------------------- PSF -------------------------------- */

export interface PsfKernel {
  data: Float64Array;
  size: number;
}

/**
 * Punktbildfunktion als Kern in Pixeln.
 * @param arcminPerPx Winkelmaßstab des Bildes
 */
export function psfKernel(E: Mat2, pupilDiameterMm: number, arcminPerPx: number, lambdaNm = 555, maxSize = 255): PsfKernel {
  const P = pupilDiameterMm / 2000; // m
  const radPerPx = (arcminPerPx / 60) * (Math.PI / 180);
  // Beugung: σ ≈ 0,42 λ / D
  const sigmaDiff = (0.42 * lambdaNm * 1e-9) / (pupilDiameterMm / 1000) / radPerPx;
  const e = eigen2(E);
  const extent = (P * Math.max(Math.abs(e.l1), Math.abs(e.l2))) / radPerPx;
  let half = Math.ceil(extent + 3 * Math.max(0.5, sigmaDiff) + 1);
  half = Math.min(half, (maxSize - 1) / 2);
  const size = 2 * half + 1;
  const data = new Float64Array(size * size);
  // Spot-Diagramm über ein Pupillenraster (gleichmäßig), bilinear in die Pixel verteilt
  const nGrid = Math.min(96, Math.max(24, Math.ceil(extent * 1.5)));
  for (let j = 0; j < nGrid; j++)
    for (let i = 0; i < nGrid; i++) {
      const ux = ((i + 0.5) / nGrid) * 2 - 1;
      const uy = ((j + 0.5) / nGrid) * 2 - 1;
      if (ux * ux + uy * uy > 1) continue;
      const x = ux * P;
      const y = uy * P;
      // Δθ = E·x im TABO-Rahmen (Blick auf das Auge). Das Bild zeigt die Sicht DES PATIENTEN:
      // TABO 0° (rechts vom Untersucher) liegt für den Patienten links → x spiegeln; TABO y (oben) → Zeile nach oben.
      const dx = -(E.a * x + E.b * y) / radPerPx;
      const dy = -(E.b * x + E.c * y) / radPerPx;
      const px = dx + half;
      const py = dy + half;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fx = px - x0;
      const fy = py - y0;
      const put = (X: number, Y: number, w: number) => {
        if (X >= 0 && Y >= 0 && X < size && Y < size) data[Y * size + X] += w;
      };
      put(x0, y0, (1 - fx) * (1 - fy));
      put(x0 + 1, y0, fx * (1 - fy));
      put(x0, y0 + 1, (1 - fx) * fy);
      put(x0 + 1, y0 + 1, fx * fy);
    }
  // Beugung (und Pixelglättung) als separierbarer Gauß
  const sigma = Math.max(0.35, sigmaDiff);
  const r = Math.min(half, Math.ceil(3 * sigma));
  const g = new Float64Array(2 * r + 1);
  let gs = 0;
  for (let i = -r; i <= r; i++) gs += g[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < g.length; i++) g[i] /= gs;
  const tmp = new Float64Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const X = x + k;
        if (X >= 0 && X < size) acc += data[y * size + X] * g[k + r];
      }
      tmp[y * size + x] = acc;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const Y = y + k;
        if (Y >= 0 && Y < size) acc += tmp[Y * size + x] * g[k + r];
      }
      data[y * size + x] = acc;
    }
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  if (sum > 0) for (let i = 0; i < data.length; i++) data[i] /= sum;
  return { data, size };
}

/** Zweite Momente der PSF (für Tests/Erklärung): Standardabweichung in x/y [px] */
export function kernelSpread(k: PsfKernel): { sx: number; sy: number } {
  const c = (k.size - 1) / 2;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < k.size; y++)
    for (let x = 0; x < k.size; x++) {
      const v = k.data[y * k.size + x];
      sx += v * (x - c) ** 2;
      sy += v * (y - c) ** 2;
    }
  return { sx: Math.sqrt(sx), sy: Math.sqrt(sy) };
}

/** Nebelglas: +x dpt vor dem Auge (als zusätzliche Wirkung) */
export const fogMatrix = (plus: number): Mat2 => ({ a: plus, b: 0, c: plus });

export const addM = madd2;
