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

/* ------------------- Dezentrierte Kontur (Phase 5) ------------------- */

export interface OutlineSpec {
  outline: LensOutline;
  diameter: number;
  width: number;
  height: number;
  /** Mittelpunkt der Kontur (Kastenmitte) in lokalen Elementkoordinaten [mm] relativ zum optischen Mittelpunkt */
  cx?: number;
  cy?: number;
}

/**
 * Konturradius r(φ) gemessen vom optischen Mittelpunkt (Ursprung), wenn die Formscheibe um (cx, cy)
 * verschoben ist. Die Formen sind konvex → sternförmig bezüglich jedes inneren Punkts; der Schnitt des
 * Strahls t·(cos φ, sin φ) mit dem Rand wird per Bisektion bestimmt. Ohne Versatz exakt outlineRadius.
 */
export function outlineRadiusFrom(o: OutlineSpec, phi: number): number {
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  if (Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9) return outlineRadius(o.outline, o.diameter, o.width, o.height, phi);
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  const inside = (t: number) => {
    const px = t * ux - cx;
    const py = t * uy - cy;
    const rho = outlineRadius(o.outline, o.diameter, o.width, o.height, Math.atan2(py, px));
    return Math.hypot(px, py) <= rho;
  };
  let lo = 0;
  let hi = Math.max(o.diameter, o.width, o.height) + Math.hypot(cx, cy) + 1;
  if (!inside(0)) return 0;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (inside(m)) lo = m;
    else hi = m;
  }
  return lo;
}

/** Randpunkte der (ggf. verschobenen) Kontur in lokalen Koordinaten. */
export function outlinePoints(o: OutlineSpec, n = 256): Array<[number, number]> {
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const psi = (i / n) * Math.PI * 2;
    const r = outlineRadius(o.outline, o.diameter, o.width, o.height, psi);
    pts.push([cx + r * Math.cos(psi), cy + r * Math.sin(psi)]);
  }
  return pts;
}

/**
 * Stützfunktion h(φ) = max_Rand (p · u_φ) – Abstand der Tangente in Richtung φ vom Ursprung.
 * Für eine Begrenzung durch Halbräume muss h (nicht r) verwendet werden: Bei nicht kreisförmigen
 * Konturen liegt die Tangente am Randpunkt nicht senkrecht zum Radiusvektor.
 */
export function outlineSupport(points: Array<[number, number]>, phi: number): number {
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  let h = -Infinity;
  for (const [x, y] of points) h = Math.max(h, x * ux + y * uy);
  return h;
}
