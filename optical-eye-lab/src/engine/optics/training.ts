/**
 * Fallbasiertes Training (Phase 4): unbekannter Patient → Skiaskopie/Refraktion → Auswertung.
 * Die „wahre“ Refraktion ist in der Augengeometrie gespeichert (Geometrie = Quelle der Wahrheit);
 * der Trainingsfall blendet die Werte in der Oberfläche nur aus.
 */
import type { SceneDocument, TrainingCase } from '@/model/types';
import { solveEyeForRefraction, eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { createId } from '@/core/ids';
import { matrixToRx, msub2, normalizeAxis, rxToMatrix, type Rx } from '@/core/math/powerMatrix';
import { formatRx } from '@/engine/physics/explain';
import { formatNumber, formatPower } from '@/core/units';
import { blurStrength } from './vision';
import { refractionAtVertex } from './calculators';

export type CaseKind = 'myopia' | 'hyperopia' | 'astigmatism' | 'mixed' | 'random';

export const CASE_KIND_LABEL: Record<CaseKind, string> = {
  myopia: 'Myopie',
  hyperopia: 'Hyperopie',
  astigmatism: 'Astigmatismus',
  mixed: 'gemischt (Sph + Cyl)',
  random: 'zufällig',
};

/** deterministischer Zufallsgenerator (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const step = (v: number, s = 0.25) => Math.round(v / s) * s;

export interface GeneratedCase {
  rx: Rx;
  age: number;
  complaint: string;
  title: string;
}

export function generateCase(kind: CaseKind, seed = Date.now()): GeneratedCase {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const k: CaseKind = kind === 'random' ? pick<CaseKind>(['myopia', 'hyperopia', 'astigmatism', 'mixed']) : kind;
  const axis = normalizeAxis(step(r() * 180, 5) || 180);
  let rx: Rx;
  let complaint: string;
  let age: number;
  switch (k) {
    case 'myopia':
      rx = { sph: step(-0.75 - r() * 5), cyl: 0, axis: 180 };
      age = 16 + Math.floor(r() * 25);
      complaint = pick(['„In der Ferne sehe ich unscharf, z. B. Straßenschilder.“', '„Die Tafel in der Schule ist verschwommen.“', '„Beim Autofahren nachts sehe ich schlecht.“']);
      break;
    case 'hyperopia':
      rx = { sph: step(0.75 + r() * 3), cyl: 0, axis: 180 };
      age = 30 + Math.floor(r() * 25);
      complaint = pick(['„Beim Lesen werden die Augen schnell müde.“', '„Abends habe ich oft Kopfschmerzen nach der Bildschirmarbeit.“']);
      break;
    case 'astigmatism':
      rx = { sph: step(-0.25 - r() * 1), cyl: step(-0.75 - r() * 2.25), axis };
      age = 20 + Math.floor(r() * 30);
      complaint = pick(['„Buchstaben verschwimmen und sehen verzerrt aus.“', '„Lichter nachts ziehen Streifen.“']);
      break;
    default:
      rx = { sph: step(-4 + r() * 6), cyl: step(-0.5 - r() * 2), axis };
      age = 18 + Math.floor(r() * 40);
      complaint = pick(['„Ferne und Nähe sind nicht mehr richtig scharf.“', '„Meine alte Brille passt nicht mehr.“']);
  }
  return { rx, age, complaint, title: `Unbekannter Patient, ${age} Jahre` };
}

/** Wendet einen Fall auf eine Simulation an (Auge einstellen, Messgläser entfernen, Werte verbergen). */
export function applyCase(doc: SceneDocument, c: GeneratedCase, workingDistance = 667): SceneDocument {
  const solved = solveEyeForRefraction(doc.eye.anatomy, c.rx, 'auto');
  const training: TrainingCase = {
    id: createId('case'),
    title: c.title,
    age: c.age,
    complaint: c.complaint,
    hidden: true,
    workingDistance,
    startedAt: new Date().toISOString(),
  };
  return {
    ...doc,
    eye: { ...doc.eye, ametropiaMode: 'auto', anatomy: solved.anatomy, patient: { age: c.age, accommodates: true } },
    elements: doc.elements.filter((e) => !(e.family === 'lens' && e.role === 'trial')),
    // Strahlengang würde die Fokuslage zeigen → aus; Schnittansicht verrät die Baulänge nicht direkt
    display: { ...doc.display, showRays: false },
    training,
  };
}

export interface CaseEvaluation {
  truth: Rx;
  submitted: Rx;
  difference: Rx;
  /** Blurstärke der Differenz [dpt] */
  error: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  gradeLabel: string;
  steps: string[];
}

/** Auswertung: Referenz = Refraktion des Auges in der Brillenglasebene (HSA) für die Ferne. */
export function evaluateCase(doc: SceneDocument, submitted: Rx, hsaMm = 12, grossSph?: number): CaseEvaluation {
  const A = eyeRefractionState(doc.eye.anatomy).matrix;
  const truth = refractionAtVertex(A, hsaMm);
  const D = msub2(rxToMatrix(submitted), rxToMatrix(truth));
  const difference = matrixToRx(D, 'minus');
  const error = blurStrength(D);
  const grade = error <= 0.25 ? 'excellent' : error <= 0.5 ? 'good' : error <= 1 ? 'fair' : 'poor';
  const gradeLabel = { excellent: 'sehr gut (≤ 0,25 dpt)', good: 'gut (≤ 0,50 dpt)', fair: 'ausreichend (≤ 1,00 dpt)', poor: 'deutliche Abweichung (> 1,00 dpt)' }[grade];
  const w = doc.training?.workingDistance ?? 667;
  const wdLens = 1000 / (w - hsaMm);
  const steps = [
    `Wahre Refraktion am Hornhautscheitel: ${formatRx(matrixToRx(A, 'minus'))}.`,
    `Umrechnung auf die Brillenglasebene (HSA ${hsaMm} mm): F = A / (1 + d·A) je Hauptschnitt → ${formatRx(truth)}.`,
    `Skiaskopie: Neutralisationsglas (brutto) = Refraktion + 1/(w − HSA) = Refraktion + ${formatPower(wdLens)} bei w = ${formatNumber(w / 10, 1)} cm. Arbeitsabstandskorrektur: vom Bruttowert ${formatPower(wdLens)} abziehen.`,
    ...(grossSph !== undefined ? [`Ihr Bruttowert (Sph): ${formatPower(grossSph)} → netto ${formatPower(grossSph - wdLens)}.`] : []),
    `Ihr Ergebnis: ${formatRx(submitted)} · Differenz: ${formatRx(difference)} (Blurstärke ${formatNumber(error, 2)} dpt).`,
  ];
  return { truth, submitted, difference, error, grade, gradeLabel, steps };
}
