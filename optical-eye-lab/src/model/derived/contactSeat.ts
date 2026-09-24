/**
 * Kontaktlinse auf dem Auge: Lage-Constraint und Tränenraumprofil.
 *
 * Eine Linse mit contact.onEye = true wird nicht frei positioniert, sondern ihre Transformation
 * wird aus dem Auge abgeleitet:
 *   - Rückflächenscheitel liegt am Hornhautpunkt unter der Linsenmitte, abzüglich Tränenfilm
 *   - Dezentration (centration) im TABO-Rahmen, Neigung (tilt) um lokale x/y-Achsen
 * Die abgeleitete Transformation wird bei jeder Dokumentänderung neu berechnet (applyConstraints),
 * damit Rendering, Messung und Raytracing unverändert mit `transform` arbeiten können.
 *
 * Tränenraumprofil (Grundlage für Fluoreszein, Phase 3):
 *   d(x, y) = z_Hornhaut(x, y) − z_KL-Rückfläche(x, y)   (entlang der Augenachse, Augen-lokal)
 *   d < 0 bedeutet rechnerische Durchdringung = Auflage (Berührung).
 *
 * Phase 4 (Fluoreszein): Die KL-Rückfläche wird zonal ausgewertet – optische Zone (Basiskurve, ggf. torisch)
 * bis BOZD/2, danach die peripheren Kurven (Kugelzonen mit stetigem Übergang der Pfeilhöhe, ohne Verrundung).
 * Die Hornhaut kann asphärisch sein (konische Konstante Q, auch torisch als Bikonik mit gleichem Q).
 * Ohne periphere Kurven und mit Q = 0 ist die Geometrie identisch zu Phase 2.
 */
import type { EyeEntity, LensElement, OpticalElement, SceneDocument, Vec3 } from '../types';
import { elementAxialExtent } from './elementShape';
import { corneaSpec, effectiveLens } from './effectiveLens';
import { curvature, isToric, localToTabo, sag, sagXY, taboToLocal, type SurfaceSpec } from '@/core/math/surfaces';
import { eulerDegToMat3, mat3ToEulerDeg, mulMat3, mulMat3TVec, mulMat3Vec, makeRigid, normalize, toWorldPoint } from '@/core/math/vec';

export const DEFAULT_TEAR_INDEX = 1.336;

export const isOnEye = (el: OpticalElement): el is LensElement => el.family === 'lens' && !!el.contact?.onEye;

/**
 * Pfeilhöhe einer (bi)konischen Fläche mit konischer Konstante Q an lokalem (x, y):
 *   z = (c_u·u² + c_v·v²) / (1 + √(1 − (1+Q)·(c_u²·u² + c_v²·v²)))
 */
export function conicSagXY(spec: SurfaceSpec, Q: number, x: number, y: number): number {
  if (!Q) return sagXY(spec, x, y);
  let cu: number;
  let cv: number;
  let u: number;
  let v: number;
  if (isToric(spec)) {
    const [xt, yt] = localToTabo(x, y);
    const th = ((spec.axis ?? 180) * Math.PI) / 180;
    u = xt * Math.cos(th) + yt * Math.sin(th);
    v = -xt * Math.sin(th) + yt * Math.cos(th);
    cu = curvature(spec.R);
    cv = curvature(spec.R2!);
  } else {
    u = Math.hypot(x, y);
    v = 0;
    cu = curvature(spec.R);
    cv = 0;
  }
  const num = cu * u * u + cv * v * v;
  const root = Math.sqrt(Math.max(0, 1 - (1 + Q) * (cu * cu * u * u + cv * cv * v * v)));
  return num / (1 + root);
}

/** Hornhautvorderfläche (inkl. Asphärizität) an lokalem (x, y) */
export function corneaSagXY(eye: EyeEntity, x: number, y: number): number {
  return conicSagXY(corneaSpec(eye), eye.anatomy.corneaAsphericity ?? 0, x, y);
}

function corneaGradXY(eye: EyeEntity, x: number, y: number): [number, number] {
  const h = 1e-5;
  return [(corneaSagXY(eye, x + h, y) - corneaSagXY(eye, x - h, y)) / (2 * h), (corneaSagXY(eye, x, y + h) - corneaSagXY(eye, x, y - h)) / (2 * h)];
}

/**
 * KL-Rückfläche zonal (Linsenrahmen, lokales u, v): optische Zone, dann periphere Kurven.
 * Übergang: gleiche Pfeilhöhe an der Zonengrenze (Knick, keine Verrundung – vereinfacht).
 */
export function contactBackSagXY(el: LensElement, back: SurfaceSpec, u: number, v: number): number {
  const c = el.contact;
  const r = Math.hypot(u, v);
  const pcs = c?.peripheralCurves ?? [];
  const oz = (c?.opticZoneDiameter ?? 0) / 2;
  if (!pcs.length || !oz || r <= oz) return sagXY(back, u, v);
  const dir: [number, number] = r > 0 ? [u / r, v / r] : [1, 0];
  let z = sagXY(back, dir[0] * oz, dir[1] * oz);
  let r0 = oz;
  for (const pc of pcs) {
    const r1 = r0 + Math.max(0, pc.width);
    const rr = Math.min(r, r1);
    z += sag(pc.radius, rr) - sag(pc.radius, r0);
    if (r <= r1) return z;
    r0 = r1;
  }
  // jenseits aller Kurven: letzte Kurve fortsetzen
  const last = pcs[pcs.length - 1];
  return z + sag(last.radius, r) - sag(last.radius, r0);
}

/**
 * Lokaler Rahmen der aufgesetzten Linse im Augen-Koordinatensystem:
 * Die Linsenachse folgt der Hornhautnormale am Zentrierpunkt (Linse „reitet“ auf der Hornhaut),
 * zusätzlich die vom Benutzer eingestellte Neigung.
 */
export function seatFrameLocal(el: LensElement, eye: EyeEntity) {
  const c = el.contact!;
  const [lx, ly] = taboToLocal(c.centration?.x ?? 0, c.centration?.y ?? 0);
  const [gx, gy] = corneaGradXY(eye, lx, ly);
  const m = normalize([-gx, -gy, 1]);
  const autoTilt = eulerDegToMat3((Math.atan2(-m[1], m[2]) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, m[0]))) * 180) / Math.PI, 0);
  const userTilt = eulerDegToMat3(c.tilt?.x ?? 0, c.tilt?.y ?? 0, 0);
  const rot = mulMat3(autoTilt, userTilt);
  const axis = mulMat3Vec(rot, [0, 0, 1]);
  const surface: Vec3 = [lx, ly, corneaSagXY(eye, lx, ly)];
  const backVertex: Vec3 = [surface[0] - axis[0] * c.tearFilmThickness, surface[1] - axis[1] * c.tearFilmThickness, surface[2] - axis[2] * c.tearFilmThickness];
  return { rot, axis, backVertex };
}

/** Abgeleitete Transformation einer aufgesetzten Kontaktlinse. */
export function seatTransform(el: LensElement, eye: EyeEntity) {
  const ext = elementAxialExtent(el);
  const f = seatFrameLocal(el, eye);
  const centerLocal: Vec3 = [f.backVertex[0] - f.axis[0] * ext.back, f.backVertex[1] - f.axis[1] * ext.back, f.backVertex[2] - f.axis[2] * ext.back];
  const eyeRot = eulerDegToMat3(...eye.transform.rotation);
  const position = toWorldPoint(makeRigid(eye.transform.position, eye.transform.rotation), centerLocal);
  return { position, rotation: mat3ToEulerDeg(mulMat3(eyeRot, f.rot)) };
}

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** Wendet alle abgeleiteten Constraints an (derzeit: aufgesetzte Kontaktlinsen). */
export function applyConstraints(doc: SceneDocument): SceneDocument {
  let changed = false;
  const elements = doc.elements.map((e) => {
    if (!isOnEye(e)) return e;
    const t = seatTransform(e, doc.eye);
    if (near(t.position, e.transform.position) && near(t.rotation, e.transform.rotation)) return e;
    changed = true;
    return { ...e, transform: { ...e.transform, position: t.position, rotation: t.rotation } };
  });
  return changed ? { ...doc, elements } : doc;
}

export interface TearProfile {
  /** Rasterweite [mm], Raster (2N+1)², Ursprung = Linsenmitte, TABO-Rahmen */
  step: number;
  N: number;
  /** Tränenfilmdicke [mm]; NaN außerhalb der Linse */
  values: Float32Array;
  central: number;
  min: number;
  max: number;
  /** Anteil der Linsenfläche mit Auflage (d ≤ 0,002 mm) */
  bearingFraction: number;
  /** Dicke am Rand der optischen Zone (Mittelwert über den Umfang) */
  edgeClearance: number;
}

/**
 * Tränenfilmdicke entlang der Augenachse an Punkt (x, y) im TABO-Rahmen relativ zur Linsenmitte [mm].
 * Die KL-Rückfläche wird exakt im Linsenrahmen ausgewertet (Fixpunkt-Iteration für den Rahmenwechsel).
 */
export function tearThicknessAt(el: LensElement, eye: EyeEntity, xt: number, yt: number): number {
  const c = el.contact!;
  const [cx, cy] = taboToLocal(c.centration?.x ?? 0, c.centration?.y ?? 0);
  const [dx, dy] = taboToLocal(xt, yt);
  const qx = cx + dx;
  const qy = cy + dy;
  const back = effectiveLens(el, eye).back;
  const f = seatFrameLocal(el, eye);
  // Punkt der Rückfläche finden, der in Augenkoordinaten bei (qx, qy) liegt
  let u = dx;
  let v = dy;
  let p: Vec3 = [0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const pl: Vec3 = [u, v, contactBackSagXY(el, back, u, v)];
    const r = mulMat3Vec(f.rot, pl);
    p = [f.backVertex[0] + r[0], f.backVertex[1] + r[1], f.backVertex[2] + r[2]];
    const ex = qx - p[0];
    const ey = qy - p[1];
    if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) break;
    const corr = mulMat3TVec(f.rot, [ex, ey, 0]);
    u += corr[0];
    v += corr[1];
  }
  return corneaSagXY(eye, qx, qy) - p[2];
}

export function computeTearProfile(el: LensElement, eye: EyeEntity, N = 24): TearProfile {
  const R = el.lens.diameter / 2;
  const step = R / N;
  const size = 2 * N + 1;
  const values = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  let inside = 0;
  let bearing = 0;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = (i - N) * step;
      const y = (j - N) * step;
      const idx = j * size + i;
      if (Math.hypot(x, y) > R) {
        values[idx] = NaN;
        continue;
      }
      const d = tearThicknessAt(el, eye, x, y);
      values[idx] = d;
      min = Math.min(min, d);
      max = Math.max(max, d);
      inside++;
      if (d <= 0.002) bearing++;
    }
  const oz = (el.contact?.opticZoneDiameter ?? el.lens.diameter * 0.8) / 2;
  let edgeSum = 0;
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    edgeSum += tearThicknessAt(el, eye, oz * Math.cos(a), oz * Math.sin(a));
  }
  return {
    step,
    N,
    values,
    central: tearThicknessAt(el, eye, 0, 0),
    min,
    max,
    bearingFraction: inside ? bearing / inside : 0,
    edgeClearance: edgeSum / 36,
  };
}

/**
 * Zentrale Tränenfilmdicke für „Auflage“ innerhalb der optischen Zone (einfaches Sitzmodell):
 * die Linse liegt dort auf, wo die Scheitelhöhendifferenz am größten ist; Mindestspalt 5 µm.
 */
export function tearThicknessForBearing(el: LensElement, eye: EyeEntity, minGap = 0.005): number {
  const probe: LensElement = { ...el, contact: { ...el.contact!, tearFilmThickness: 0, centration: { x: 0, y: 0 }, tilt: { x: 0, y: 0 } } };
  const oz = (el.contact?.opticZoneDiameter ?? el.lens.diameter * 0.8) / 2;
  let minD = Infinity;
  for (let r = 0; r <= oz + 1e-9; r += oz / 20)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      minD = Math.min(minD, tearThicknessAt(probe, eye, r * Math.cos(a), r * Math.sin(a)));
    }
  return Math.max(minGap, minGap - minD);
}
