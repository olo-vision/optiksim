/**
 * Grundlegende Formeln der geometrischen Optik.
 * Alle Längen in mm, Brechkräfte in Dioptrien (1/m).
 *
 * Diese Funktionen sind bewusst rein (ohne Seiteneffekte) und unabhängig von
 * React/Three.js, damit sie später im Lernmodus („Mathematisch erklären“)
 * mit eingesetzten Werten dargestellt und getestet werden können.
 */
import { isPlano } from '@/core/math/surfaces';

/** Flächenbrechwert F = (n' − n) / r   [dpt], r in mm. */
export function surfacePower(n1: number, n2: number, radiusMm: number): number {
  if (isPlano(radiusMm)) return 0;
  return (1000 * (n2 - n1)) / radiusMm;
}

export interface ThickLensResult {
  /** Flächenbrechwert Vorderfläche F1 [dpt] */
  F1: number;
  /** Flächenbrechwert Rückfläche F2 [dpt] */
  F2: number;
  /** Äquivalente Brechkraft (Gullstrand) F [dpt] */
  F: number;
  /** Bildseitiger Scheitelbrechwert S'∞ [dpt] */
  backVertexPower: number;
  /** Objektseitiger Scheitelbrechwert S∞ [dpt] */
  frontVertexPower: number;
  /** Bildseitige Brennweite f' [mm] */
  focalLength: number;
}

/**
 * Dicke Linse in einem umgebenden Medium (Standard: Luft).
 *   F = F1 + F2 − (d/n)·F1·F2
 *   S'∞ = F1 / (1 − (d/n)·F1) + F2
 */
export function thickLens(n: number, R1: number, R2: number, thicknessMm: number, nOutside = 1): ThickLensResult {
  const F1 = surfacePower(nOutside, n, R1);
  const F2 = surfacePower(n, nOutside, R2);
  const delta = thicknessMm / 1000 / n;
  const F = F1 + F2 - delta * F1 * F2;
  const backVertexPower = F1 / (1 - delta * F1) + F2;
  const frontVertexPower = F2 / (1 - delta * F2) + F1;
  return { F1, F2, F, backVertexPower, frontVertexPower, focalLength: F !== 0 ? (1000 * nOutside) / F : Infinity };
}

/**
 * Löst die Vorderfläche so auf, dass ein gewünschter bildseitiger Scheitelbrechwert entsteht.
 * Gibt den Vorderflächenradius in mm zurück (0 = plan).
 */
export function frontRadiusForBackVertexPower(target: number, n: number, R2: number, thicknessMm: number, nOutside = 1): number {
  const F2 = surfacePower(n, nOutside, R2);
  const A = target - F2;
  const delta = thicknessMm / 1000 / n;
  const F1 = A / (1 + delta * A);
  if (Math.abs(F1) < 1e-9) return 0;
  return (1000 * (n - nOutside)) / F1;
}

/**
 * Löst die Rückfläche so auf, dass bei gegebener Vorderfläche ein gewünschter
 * bildseitiger Scheitelbrechwert entsteht. Rückgabe: Rückflächenradius in mm (0 = plan).
 */
export function backRadiusForBackVertexPower(target: number, n: number, R1: number, thicknessMm: number, nOutside = 1): number {
  const F1 = surfacePower(nOutside, n, R1);
  const delta = thicknessMm / 1000 / n;
  const F2 = target - F1 / (1 - delta * F1);
  if (Math.abs(F2) < 1e-9) return 0;
  return (1000 * (nOutside - n)) / F2;
}

/** Brechkraft der dünnen Linse (Linsenschleiferformel). */
export function thinLensPower(n: number, R1: number, R2: number, nOutside = 1): number {
  return surfacePower(nOutside, n, R1) + surfacePower(n, nOutside, R2);
}

/** Minimale Ablenkung eines Prismas mit brechendem Winkel α [°]. */
export function prismMinimumDeviation(n: number, apexDeg: number, nOutside = 1): number {
  const a = (apexDeg * Math.PI) / 180;
  const s = (n / nOutside) * Math.sin(a / 2);
  if (s >= 1) return NaN; // Totalreflexion
  return ((2 * Math.asin(s) - a) * 180) / Math.PI;
}

/** Ablenkung eines dünnen Prismas δ ≈ (n − 1)·α  [°]. */
export const thinPrismDeviation = (n: number, apexDeg: number, nOutside = 1) => (n / nOutside - 1) * apexDeg;

/** Umrechnung Ablenkwinkel [°] → Prismendioptrien [cm/m]. */
export const deviationToPrismDiopters = (deg: number) => 100 * Math.tan((deg * Math.PI) / 180);

/**
 * Effektive Brechkraft bei Verschiebung um d (z. B. Hornhautscheitelabstand).
 *   F_eff = F / (1 − d·F)   mit d in m, positiv in Lichtrichtung.
 * Vorbereitet für das spätere HSA-Modul.
 */
export const effectivePower = (F: number, shiftMm: number) => F / (1 - (shiftMm / 1000) * F);

/** Lupen-Normalvergrößerung Γ = F / 4 dpt (Bezugssehweite 250 mm). */
export const magnifierPower = (F: number) => F / 4;
