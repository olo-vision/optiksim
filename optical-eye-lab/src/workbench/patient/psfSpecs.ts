/**
 * PSF je Bildkanal aus dem Patientenzustand (Phase 4).
 * Farbige Bilder: je Kanal eigener Defokus durch die chromatische Längsaberration des Auges.
 */
import type { SceneDocument } from '@/model/types';
import type { Mat2 } from '@/core/math/powerMatrix';
import { chromaticRefractionShift, DUOCHROME, type PatientViewState } from '@/engine/optics/vision';
import { LAMBDA_D } from '@/engine/optics/dispersion';
import type { ChartKind } from './charts';
import type { PsfSpec } from './psfProtocol';

const shifted = (E: Mat2, d: number): Mat2 => ({ a: E.a + d, b: E.b, c: E.c + d });

export function psfSpecs(doc: SceneDocument, st: PatientViewState, chart: ChartKind, chromatic: boolean): PsfSpec[] {
  const a = doc.eye.anatomy;
  if (chart === 'duochrome') {
    return [
      { E: shifted(st.E, chromaticRefractionShift(a, DUOCHROME.red)), pupil: st.pupilDiameter, lambda: DUOCHROME.red },
      { E: shifted(st.E, chromaticRefractionShift(a, DUOCHROME.green)), pupil: st.pupilDiameter, lambda: DUOCHROME.green },
      { E: shifted(st.E, chromaticRefractionShift(a, DUOCHROME.green)), pupil: st.pupilDiameter, lambda: DUOCHROME.green },
    ];
  }
  if (chromatic || chart === 'scene') {
    return [610, 550, 465].map((lam) => ({ E: shifted(st.E, chromaticRefractionShift(a, lam)), pupil: st.pupilDiameter, lambda: lam }));
  }
  return [{ E: st.E, pupil: st.pupilDiameter, lambda: LAMBDA_D }];
}

/** Prismatische Bildverschiebung [Winkelminuten, Bild: x rechts, y unten] – Bild wandert zur Prismenkante */
export function prismShiftArcmin(doc: SceneDocument): [number, number] {
  const trial = doc.elements.find((e) => e.family === 'lens' && e.role === 'trial' && e.visible);
  const p = trial && trial.family === 'lens' ? trial.trialPrism : undefined;
  if (!p || !p.amount) return [0, 0];
  const arcmin = Math.atan(p.amount / 100) * (180 / Math.PI) * 60;
  const b = (p.base * Math.PI) / 180;
  // Basis (TABO) → Bild zur Kante (−Basis); Patientensicht spiegelt x, Bild-y zeigt nach unten
  return [arcmin * Math.cos(b), arcmin * Math.sin(b)];
}
