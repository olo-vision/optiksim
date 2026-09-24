import type { LensOutline } from '@/model/types';

const RECT_EXPONENT = 7; // Superellipse: rechteckig mit weich gerundeten Ecken

/** Konturradius r(φ) einer Linsenform (sternförmig um die Mitte). */
export function outlineRadius(outline: LensOutline, diameter: number, width: number, height: number, phi: number): number {
  if (outline === 'round') return diameter / 2;
  const a = width / 2;
  const b = height / 2;
  const c = Math.abs(Math.cos(phi));
  const s = Math.abs(Math.sin(phi));
  if (outline === 'oval') {
    return (a * b) / Math.sqrt((b * c) ** 2 + (a * s) ** 2);
  }
  const n = RECT_EXPONENT;
  return Math.pow(Math.pow(c / a, n) + Math.pow(s / b, n), -1 / n);
}

/** Größter Konturradius (für Randdicken-Prüfung und Raytracing-Apertur). */
export function maxOutlineRadius(outline: LensOutline, diameter: number, width: number, height: number): number {
  if (outline === 'round') return diameter / 2;
  let m = 0;
  for (let i = 0; i < 90; i++) m = Math.max(m, outlineRadius(outline, diameter, width, height, (i / 90) * (Math.PI / 2)));
  return m;
}
