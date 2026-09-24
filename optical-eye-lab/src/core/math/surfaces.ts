import { eigen2, normalizeAxis, type Mat2 } from './powerMatrix';
/**
 * Geometrie optischer Flächen.
 *
 * Vorzeichenkonvention (DIN / Optik-Standard):
 *   - Licht läuft in +Z-Richtung (lokales Koordinatensystem jedes Elements).
 *   - Radius R > 0: Krümmungsmittelpunkt liegt in Lichtrichtung hinter dem Scheitel (+Z).
 *   - Radius R < 0: Krümmungsmittelpunkt liegt vor dem Scheitel (−Z).
 *   - R = 0 wird als Planfläche (R = ∞) interpretiert.
 */

export const isPlano = (R: number) => !Number.isFinite(R) || Math.abs(R) < 1e-9 || Math.abs(R) > 1e7;

/**
 * Pfeilhöhe (Sagitta) einer sphärischen Fläche bei Einfallshöhe h.
 * Positiver Wert = Fläche liegt am Rand weiter in +Z als am Scheitel.
 */
export function sag(R: number, h: number): number {
  if (isPlano(R)) return 0;
  const r2 = R * R;
  const h2 = Math.min(h * h, r2);
  return R - Math.sign(R) * Math.sqrt(r2 - h2);
}

/** Maximal mögliche Einfallshöhe einer Kugelfläche (Halbkugel). */
export const maxSemiAperture = (R: number) => (isPlano(R) ? Infinity : Math.abs(R));

export interface LensShapeCheck {
  /** Tatsächlich darstellbare Mittendicke (ggf. automatisch erhöht). */
  centerThickness: number;
  /** Randdicke bei maximaler Einfallshöhe. */
  edgeThickness: number;
  /** Tatsächlich verwendete halbe Öffnung. */
  semiAperture: number;
  warnings: string[];
}

/**
 * Prüft, ob eine Linse mit den Parametern geometrisch darstellbar ist,
 * und korrigiert die Darstellung falls nötig (Werte im Modell bleiben unverändert).
 */
export function checkLensShape(R1: number, R2: number, centerThickness: number, semiAperture: number, minEdge = 0.05): LensShapeCheck {
  const warnings: string[] = [];
  let h = semiAperture;
  const limit = Math.min(maxSemiAperture(R1), maxSemiAperture(R2)) * 0.995;
  if (h > limit) {
    warnings.push(`Durchmesser größer als die Radien zulassen – Darstellung auf Ø ${(2 * limit).toFixed(1)} mm begrenzt.`);
    h = limit;
  }
  const s1 = sag(R1, h);
  const s2 = sag(R2, h);
  let t = centerThickness;
  let edge = t - s1 + s2;
  if (edge < minEdge) {
    const needed = s1 - s2 + minEdge;
    warnings.push(`Randdicke wäre negativ – Mittendicke für die Darstellung auf ${needed.toFixed(2)} mm erhöht.`);
    t = needed;
    edge = minEdge;
  }
  // Mittendicke kann bei Zerstreuungslinsen kleiner werden als die Randdicke – das ist korrekt.
  if (t <= 0) {
    warnings.push('Mittendicke muss größer als 0 sein.');
    t = 0.01;
  }
  return { centerThickness: t, edgeThickness: edge, semiAperture: h, warnings };
}

/* ======================================================================
 * Torische Flächen (Phase 2)
 * ====================================================================== */


/**
 * Beschreibung einer optischen Fläche.
 *  - R  : Radius im Meridian `axis` (TABO-Grad), 0 = plan
 *  - R2 : Radius im Meridian senkrecht dazu; undefined = rotationssymmetrisch (sphärisch)
 *
 * Torische Flächen werden als Bikonik (Zemax-Standard, konische Konstanten = 0) dargestellt:
 *   z = (c_u·u² + c_v·v²) / (1 + √(1 − c_u²·u² − c_v²·v²))
 * u, v = Koordinaten entlang der Hauptschnitte. Die Krümmungen in beiden Hauptschnitten sind exakt;
 * gegenüber einer Torus-Fläche gibt es nur Abweichungen höherer Ordnung außerhalb der Hauptschnitte.
 */
export interface SurfaceSpec {
  R: number;
  R2?: number;
  axis?: number;
}

export const curvature = (R: number) => (isPlano(R) ? 0 : 1 / R);

export function isToric(s: SurfaceSpec): boolean {
  return s.R2 !== undefined && Math.abs(curvature(s.R) - curvature(s.R2)) > 1e-9;
}

/**
 * Lokale Elementkoordinaten (x, y) → TABO-Rahmen.
 * Frontansicht (Kamera bei −Z, Blick +Z): TABO 0° zeigt nach lokal −X, 90° nach lokal +Y.
 */
export const localToTabo = (x: number, y: number): [number, number] => [-x, y];
export const taboToLocal = (xt: number, yt: number): [number, number] => [-xt, yt];

/** Krümmungsmatrix (1/mm) im TABO-Rahmen. */
export function curvatureMatrix(s: SurfaceSpec): Mat2 {
  const ka = curvature(s.R);
  const kb = s.R2 === undefined ? ka : curvature(s.R2);
  const th = ((s.axis ?? 180) * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  // K = ka·a·aᵀ + kb·p·pᵀ,  a = (c, s), p = (−s, c)
  return { a: ka * c * c + kb * sn * sn, b: (ka - kb) * c * sn, c: ka * sn * sn + kb * c * c };
}

/** Umkehrung: Krümmungsmatrix → Flächenbeschreibung (Hauptschnitte aus Eigenzerlegung). */
export function specFromCurvatureMatrix(K: Mat2, fallbackAxis = 180): SurfaceSpec {
  const e = eigen2(K);
  const toR = (k: number) => (Math.abs(k) < 1e-12 ? 0 : 1 / k);
  if (e.l1 - e.l2 < 1e-10) return { R: toR((e.l1 + e.l2) / 2), axis: normalizeAxis(fallbackAxis) };
  return { R: toR(e.l1), R2: toR(e.l2), axis: e.deg1 };
}

/** Flächenbrechwert-Matrix (dpt) für den Übergang n1 → n2. */
export function surfacePowerMatrix(s: SurfaceSpec, n1: number, n2: number): Mat2 {
  const K = curvatureMatrix(s);
  const f = 1000 * (n2 - n1);
  return { a: K.a * f, b: K.b * f, c: K.c * f };
}

/** Radius im Meridian φ (TABO-Grad) – für Anzeige und Profilberechnungen. */
export function radiusInMeridian(s: SurfaceSpec, deg: number): number {
  const K = curvatureMatrix(s);
  const th = (deg * Math.PI) / 180;
  const k = K.a * Math.cos(th) ** 2 + 2 * K.b * Math.cos(th) * Math.sin(th) + K.c * Math.sin(th) ** 2;
  return Math.abs(k) < 1e-12 ? 0 : 1 / k;
}

/** Pfeilhöhe an lokalem Punkt (x, y) relativ zum Scheitel. */
export function sagXY(s: SurfaceSpec, x: number, y: number): number {
  if (!isToric(s)) return sag(s.R, Math.hypot(x, y));
  const [xt, yt] = localToTabo(x, y);
  const th = ((s.axis ?? 180) * Math.PI) / 180;
  const u = xt * Math.cos(th) + yt * Math.sin(th);
  const v = -xt * Math.sin(th) + yt * Math.cos(th);
  const cu = curvature(s.R);
  const cv = curvature(s.R2!);
  const num = cu * u * u + cv * v * v;
  const root = Math.sqrt(Math.max(0, 1 - cu * cu * u * u - cv * cv * v * v));
  return num / (1 + root);
}

/** Gradient der Pfeilhöhe (∂z/∂x, ∂z/∂y) in lokalen Koordinaten. */
export function sagGradXY(s: SurfaceSpec, x: number, y: number): [number, number] {
  if (!isToric(s)) {
    const k = curvature(s.R);
    if (k === 0) return [0, 0];
    const q = Math.sqrt(Math.max(1e-12, 1 - k * k * (x * x + y * y)));
    return [(k * x) / q, (k * y) / q];
  }
  const h = 1e-5;
  return [(sagXY(s, x + h, y) - sagXY(s, x - h, y)) / (2 * h), (sagXY(s, x, y + h) - sagXY(s, x, y - h)) / (2 * h)];
}

/** Kleinster Betrag der Radien (begrenzt die nutzbare Apertur). */
export function minAbsRadius(s: SurfaceSpec): number {
  const r = [s.R, s.R2 ?? s.R].filter((v) => !isPlano(v)).map(Math.abs);
  return r.length ? Math.min(...r) : Infinity;
}

/**
 * Allgemeine Randdickenprüfung für beliebige Flächen und Konturen.
 * Die Randdicke wird entlang der Kontur r(φ) in 72 Richtungen bestimmt.
 */
export function checkLensShapeGeneral(
  front: SurfaceSpec,
  back: SurfaceSpec,
  centerThickness: number,
  outline: (phi: number) => number,
  minEdge = 0.05,
): LensShapeCheck {
  const warnings: string[] = [];
  const limit = Math.min(minAbsRadius(front), minAbsRadius(back)) * 0.995;
  let maxR = 0;
  for (let i = 0; i < 72; i++) maxR = Math.max(maxR, outline((i / 72) * Math.PI * 2));
  let scale = 1;
  if (maxR > limit) {
    warnings.push(`Durchmesser größer als die Radien zulassen – Darstellung auf Ø ${(2 * limit).toFixed(1)} mm begrenzt.`);
    scale = limit / maxR;
  }
  let minE = Infinity;
  for (let i = 0; i < 72; i++) {
    const phi = (i / 72) * Math.PI * 2;
    const r = outline(phi) * scale;
    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    minE = Math.min(minE, centerThickness - sagXY(front, x, y) + sagXY(back, x, y));
  }
  let t = centerThickness;
  let edge = minE;
  if (edge < minEdge) {
    const needed = centerThickness + (minEdge - edge);
    warnings.push(`Randdicke wäre negativ – Mittendicke für die Darstellung auf ${needed.toFixed(2)} mm erhöht.`);
    t = needed;
    edge = minEdge;
  }
  return { centerThickness: t, edgeThickness: edge, semiAperture: maxR * scale, warnings };
}
