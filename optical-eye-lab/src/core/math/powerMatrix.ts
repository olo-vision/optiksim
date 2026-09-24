/**
 * Sphäro-zylindrische Wirkungen und dioptrische Wirkungsmatrizen (Keating).
 *
 * KONVENTIONEN (verbindlich):
 *  - Achsen nach TABO: Blick des Untersuchers auf das Auge, 0° rechts, Zählung gegen den Uhrzeigersinn,
 *    Wertebereich (0°, 180°]; 0° wird als 180° geschrieben.
 *  - Rezept (Sph / Cyl / A): Wirkung im Achsmeridian = Sph, im Meridian senkrecht dazu = Sph + Cyl.
 *    Wirkung in einem beliebigen Meridian φ:  F(φ) = Sph + Cyl · sin²(φ − A).
 *  - Wirkungsmatrix im TABO-Rahmen (x = 0°-Richtung, y = 90°-Richtung), Einheit dpt:
 *        F = Sph·I + Cyl·p·pᵀ,   p = (−sin A, cos A)   (p = Hauptschnitt senkrecht zur Achse)
 *    ⇒ F = [[Sph + Cyl·sin²A, −Cyl·sinA·cosA], [−Cyl·sinA·cosA, Sph + Cyl·cos²A]]
 *  - Plus- und Minuszylinder-Schreibweise beschreiben dieselbe Matrix → Transposition ist exakt.
 *  - Abstände für Matrix-Effektivität in Metern (mm/1000).
 */

export interface Rx {
  sph: number;
  cyl: number;
  /** Achse in Grad (TABO), (0, 180] */
  axis: number;
}

export type CylForm = 'minus' | 'plus';

/** Symmetrische 2×2-Matrix [[a, b], [b, c]] */
export interface Mat2 {
  a: number;
  b: number;
  c: number;
}

const D2R = Math.PI / 180;
const EPS = 1e-9;

export const mat = (a: number, b: number, c: number): Mat2 => ({ a, b, c });
export const I2: Mat2 = { a: 1, b: 0, c: 1 };
export const ZERO2: Mat2 = { a: 0, b: 0, c: 0 };
export const madd2 = (x: Mat2, y: Mat2): Mat2 => ({ a: x.a + y.a, b: x.b + y.b, c: x.c + y.c });
export const msub2 = (x: Mat2, y: Mat2): Mat2 => ({ a: x.a - y.a, b: x.b - y.b, c: x.c - y.c });
export const mscale2 = (x: Mat2, s: number): Mat2 => ({ a: x.a * s, b: x.b * s, c: x.c * s });

/** Produkt zweier (kommutierender) Matrizen, symmetrisiert. */
export function mmul2(x: Mat2, y: Mat2): Mat2 {
  const a = x.a * y.a + x.b * y.b;
  const b1 = x.a * y.b + x.b * y.c;
  const b2 = x.b * y.a + x.c * y.b;
  const c = x.b * y.b + x.c * y.c;
  return { a, b: (b1 + b2) / 2, c };
}

export function minv2(x: Mat2): Mat2 {
  const det = x.a * x.c - x.b * x.b;
  if (Math.abs(det) < 1e-18) throw new Error('Matrix nicht invertierbar');
  return { a: x.c / det, b: -x.b / det, c: x.a / det };
}

/** Achse auf (0, 180] normieren. */
export function normalizeAxis(deg: number): number {
  let a = ((deg % 180) + 180) % 180;
  if (a < 1e-7) a = 180;
  return a;
}

/** Hauptmeridian-Richtung im TABO-Rahmen. */
export const meridianVec = (deg: number): [number, number] => [Math.cos(deg * D2R), Math.sin(deg * D2R)];

export function rxToMatrix(rx: Rx): Mat2 {
  const s = Math.sin(rx.axis * D2R);
  const c = Math.cos(rx.axis * D2R);
  return { a: rx.sph + rx.cyl * s * s, b: -rx.cyl * s * c, c: rx.sph + rx.cyl * c * c };
}

export interface Eigen2 {
  /** Eigenwerte (λ1 ≥ λ2) */
  l1: number;
  l2: number;
  /** Meridian (TABO-Grad) des Eigenvektors zu λ1 */
  deg1: number;
}

export function eigen2(m: Mat2): Eigen2 {
  const mean = (m.a + m.c) / 2;
  const r = Math.hypot((m.a - m.c) / 2, m.b);
  const l1 = mean + r;
  const l2 = mean - r;
  // Eigenvektor zu l1
  let deg1: number;
  if (r < EPS) deg1 = 180;
  else {
    const vx = Math.abs(m.b) > EPS ? m.b : m.a >= m.c ? 1 : 0;
    const vy = Math.abs(m.b) > EPS ? l1 - m.a : m.a >= m.c ? 0 : 1;
    deg1 = normalizeAxis(Math.atan2(vy, vx) / D2R);
  }
  return { l1, l2, deg1 };
}

/**
 * Matrix → Rezept.
 * @param fallbackAxis Achse, die bei (nahezu) rein sphärischer Wirkung beibehalten wird.
 */
export function matrixToRx(m: Mat2, form: CylForm = 'minus', fallbackAxis = 180): Rx {
  const e = eigen2(m);
  const cylMag = e.l1 - e.l2;
  if (cylMag < 1e-7) return { sph: (e.l1 + e.l2) / 2, cyl: 0, axis: normalizeAxis(fallbackAxis) };
  if (form === 'minus') return { sph: e.l1, cyl: e.l2 - e.l1, axis: e.deg1 };
  return { sph: e.l2, cyl: e.l1 - e.l2, axis: normalizeAxis(e.deg1 + 90) };
}

/** Transposition: Sph' = Sph + Cyl, Cyl' = −Cyl, A' = A ± 90°. */
export function transposeRx(rx: Rx): Rx {
  return { sph: rx.sph + rx.cyl, cyl: -rx.cyl, axis: normalizeAxis(rx.axis + 90) };
}

/** Schreibweise wählen, ohne die Wirkung zu verändern. */
export function toCylForm(rx: Rx, form: CylForm): Rx {
  if (Math.abs(rx.cyl) < 1e-9) return { ...rx, cyl: 0, axis: normalizeAxis(rx.axis) };
  const isMinus = rx.cyl < 0;
  if ((form === 'minus') === isMinus) return { ...rx, axis: normalizeAxis(rx.axis) };
  return transposeRx(rx);
}

export interface PrincipalMeridian {
  /** Meridian in TABO-Grad */
  meridian: number;
  /** Wirkung in diesem Meridian [dpt] */
  power: number;
}

/** Hauptschnitte: Achsmeridian (Sph) und Meridian senkrecht dazu (Sph + Cyl). */
export function principalMeridians(rx: Rx): [PrincipalMeridian, PrincipalMeridian] {
  return [
    { meridian: normalizeAxis(rx.axis), power: rx.sph },
    { meridian: normalizeAxis(rx.axis + 90), power: rx.sph + rx.cyl },
  ];
}

/** Wirkung in einem beliebigen Meridian φ. */
export const powerInMeridian = (rx: Rx, deg: number) => rx.sph + rx.cyl * Math.sin((deg - rx.axis) * D2R) ** 2;

export const sphericalEquivalent = (rx: Rx) => rx.sph + rx.cyl / 2;

export function rxEquals(a: Rx, b: Rx, tol = 0.005): boolean {
  const ma = rxToMatrix(a);
  const mb = rxToMatrix(b);
  return Math.abs(ma.a - mb.a) < tol && Math.abs(ma.b - mb.b) < tol && Math.abs(ma.c - mb.c) < tol;
}

/* ----------------------- Vergenz / Effektivität ----------------------- */

/**
 * Effektive Wirkung nach Verschiebung um d (in Lichtrichtung, mm):
 *   F_eff = F · (I − d·F)⁻¹       (Matrixform von F/(1 − d·F))
 */
export function effectivityMatrix(F: Mat2, dMm: number): Mat2 {
  const d = dMm / 1000;
  return mmul2(F, minv2(msub2(I2, mscale2(F, d))));
}

/** Reduzierte Ausbreitung in einem Medium n über dMm: Vergenz L → L(I − (d/n)L)⁻¹ */
export const propagateVergence = (L: Mat2, dMm: number, n = 1) => effectivityMatrix(L, dMm / n);

/**
 * Bildseitiger Scheitelbrechwert einer dicken Linse (Matrixform, Linse in Luft):
 *   S' = (I − δF₁)⁻¹F₁ + F₂,   δ = d/n (m)
 * Exakt paraxial auch für torische Flächen mit beliebigen Achsen.
 */
export function backVertexMatrix(F1: Mat2, F2: Mat2, thicknessMm: number, n: number): Mat2 {
  const delta = thicknessMm / 1000 / n;
  return madd2(mmul2(minv2(msub2(I2, mscale2(F1, delta))), F1), F2);
}

/** Vorderflächen-Matrix für einen gewünschten Scheitelbrechwert T (Rückfläche F₂ gegeben). */
export function frontMatrixForBackVertex(T: Mat2, F2: Mat2, thicknessMm: number, n: number): Mat2 {
  const delta = thicknessMm / 1000 / n;
  const X = msub2(T, F2);
  return mmul2(X, minv2(madd2(I2, mscale2(X, delta))));
}

/** Rückflächen-Matrix für einen gewünschten Scheitelbrechwert T (Vorderfläche F₁ gegeben). */
export function backMatrixForBackVertex(T: Mat2, F1: Mat2, thicknessMm: number, n: number): Mat2 {
  const delta = thicknessMm / 1000 / n;
  return msub2(T, mmul2(minv2(msub2(I2, mscale2(F1, delta))), F1));
}

/** Drehung einer Wirkungsmatrix um den Winkel ψ (TABO-Grad, gegen den Uhrzeigersinn). */
export function rotateMatrix(m: Mat2, deg: number): Mat2 {
  const c = Math.cos(deg * D2R);
  const s = Math.sin(deg * D2R);
  // R M Rᵀ
  const a = c * c * m.a - 2 * c * s * m.b + s * s * m.c;
  const b = c * s * (m.a - m.c) + (c * c - s * s) * m.b;
  const cc = s * s * m.a + 2 * c * s * m.b + c * c * m.c;
  return { a, b, c: cc };
}
