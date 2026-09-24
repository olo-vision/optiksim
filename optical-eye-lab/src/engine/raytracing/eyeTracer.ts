/**
 * Sequentielle Strahlverfolgung durch das Modellauge (lokales Augensystem).
 * Flächenfolge: Hornhaut vorn → Hornhaut hinten → (Iris/Pupille) → Linse vorn → Linse hinten → Retina.
 */
import type { EyeEntity } from '@/model/types';
import { computeEyeGeometry, type Ellipse } from '@/model/derived/eyeGeometry';
import { dot, madd, makeRigid, normalize, sub, toLocalDir, toLocalPoint, toWorldDir, toWorldPoint, type RigidTransform, type Vec3 } from '@/core/math/vec';
import { refract } from './refraction';
import { sagNormal, sagRoots } from './csg';
import { corneaSpec } from '@/model/derived/effectiveLens';
import { isToric } from '@/core/math/surfaces';
import type { Ray, RayTermination } from './types';
import { EYE_MEDIA_ABBE, indexAt, isReferenceWavelength, LAMBDA_D } from '@/engine/optics/dispersion';

interface SphereSurface {
  center: Vec3;
  R: number;
  /** maximale radiale Höhe */
  maxH: number;
  /** Scheitelposition – wir nehmen den Schnittpunkt auf der scheitelnahen Kugelhälfte */
  vertexZ: number;
}

function hitSphereCap(o: Vec3, d: Vec3, s: SphereSurface, tMin: number): number | null {
  const oc = sub(o, s.center);
  const b = dot(oc, d);
  const c = dot(oc, oc) - s.R * s.R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [-b - sq, -b + sq]) {
    if (t <= tMin) continue;
    const p = madd(o, d, t);
    const h = Math.hypot(p[0], p[1]);
    // nur die scheitelnahe Kalotte (nicht die Rückseite der Kugel)
    const sameSide = Math.sign(p[2] - s.center[2]) === Math.sign(s.vertexZ - s.center[2]);
    if (h <= s.maxH && sameSide) return t;
  }
  return null;
}

function hitEllipsoid(o: Vec3, d: Vec3, e: Ellipse, tMin: number, far: boolean): number | null {
  // Skalierung auf Einheitskugel
  const O: Vec3 = [o[0] / e.a, o[1] / e.a, (o[2] - e.zc) / e.b];
  const D: Vec3 = [d[0] / e.a, d[1] / e.a, d[2] / e.b];
  const A = dot(D, D);
  const B = dot(O, D);
  const C = dot(O, O) - 1;
  const disc = B * B - A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-B - sq) / A;
  const t1 = (-B + sq) / A;
  if (far) return t1 > tMin ? t1 : null;
  if (t0 > tMin) return t0;
  return t1 > tMin ? t1 : null;
}

export interface EyeTraceModel {
  rigid: RigidTransform;
  /** Erster Schnittpunkt mit dem Auge (Hornhaut oder Sklera) in Welt-t, oder null */
  entryDistance(ray: Ray): number | null;
  /** Verfolgt einen Strahl ab dem Eintrittspunkt durch das Auge (Welt-Punkte). */
  traceInside(ray: Ray, nOutside: number): { points: Vec3[]; termination: RayTermination; finalDir?: Vec3 };
  axisWorld: Vec3;
  apexWorld: Vec3;
  retinaPoleWorld: Vec3;
}

/**
 * @param lambdaNm Wellenlänge (Phase 4): Augenmedien dispersiv mit ν = 55,8 („chromatisches Auge“);
 *                 bei der d-Linie identisch zu Phase 2.
 */
export function buildEyeTraceModel(eye: EyeEntity, lambdaNm = LAMBDA_D): EyeTraceModel {
  const a0 = eye.anatomy;
  const disp = (n: number) => indexAt(n, EYE_MEDIA_ABBE, lambdaNm);
  const a = isReferenceWavelength(lambdaNm) ? a0 : { ...a0, nCornea: disp(a0.nCornea), nAqueous: disp(a0.nAqueous), nLens: disp(a0.nLens), nVitreous: disp(a0.nVitreous) };
  const g = computeEyeGeometry(a);
  const rigid = makeRigid(eye.transform.position, eye.transform.rotation);

  const corneaFront: SphereSurface = { center: [0, 0, a.corneaFrontRadius], R: a.corneaFrontRadius, maxH: g.limbus.h, vertexZ: 0 };
  const corneaBack: SphereSurface = { center: [0, 0, a.corneaThickness + a.corneaBackRadius], R: Math.abs(a.corneaBackRadius), maxH: g.corneaBackMaxH, vertexZ: a.corneaThickness };
  const lensFront: SphereSurface = { center: [0, 0, g.lens.frontZ + a.lensFrontRadius], R: Math.abs(a.lensFrontRadius), maxH: g.lens.semiAperture, vertexZ: g.lens.frontZ };
  const lensBack: SphereSurface = { center: [0, 0, g.lens.backZ + a.lensBackRadius], R: Math.abs(a.lensBackRadius), maxH: g.lens.semiAperture, vertexZ: g.lens.backZ };

  const local = (ray: Ray) => ({ o: toLocalPoint(rigid, ray.origin), d: toLocalDir(rigid, ray.dir) });

  // Hornhautvorderfläche: sphärisch analytisch, torisch (Bikonik) numerisch – identisch zum Tränenfilm-Körper
  const cSpec = corneaSpec(eye);
  const toricCornea = isToric(cSpec);
  const corneaOpt = { rLim: g.limbus.h, zMin: -0.5, zMax: g.limbus.z + 1 };
  const corneaHit = (o: Vec3, d: Vec3, tMin: number): { t: number; normal: Vec3 } | null => {
    if (!toricCornea) {
      const t = hitSphereCap(o, d, corneaFront, tMin);
      return t === null ? null : { t, normal: normalize(sub(madd(o, d, t), corneaFront.center)) };
    }
    const { roots } = sagRoots(o, d, 0, cSpec, corneaOpt);
    const t = roots.find((r) => r > tMin);
    if (t === undefined) return null;
    const p = madd(o, d, t);
    return { t, normal: sagNormal(cSpec, p[0], p[1]) };
  };

  return {
    rigid,
    axisWorld: normalize(toWorldDir(rigid, [0, 0, 1])),
    apexWorld: toWorldPoint(rigid, [0, 0, 0]),
    retinaPoleWorld: toWorldPoint(rigid, [0, 0, a.axialLength]),

    entryDistance(ray) {
      const { o, d } = local(ray);
      const tc = corneaHit(o, d, 1e-6)?.t ?? null;
      const ts = hitEllipsoid(o, d, g.sclera, 1e-6, false);
      // Sklera-Treffer nur hinter dem Limbus zählen
      let tsValid: number | null = null;
      if (ts !== null) {
        const p = madd(o, d, ts);
        if (p[2] >= g.limbus.z - 1e-6) tsValid = ts;
      }
      if (tc === null) return tsValid;
      if (tsValid === null) return tc;
      return Math.min(tc, tsValid);
    },

    traceInside(ray, nOutside) {
      let { o, d } = local(ray);
      const pts: Vec3[] = [];
      const W = (p: Vec3) => toWorldPoint(rigid, p);

      // 1) Hornhautvorderfläche (oder Sklera)
      const hc = corneaHit(o, d, 1e-7);
      if (hc === null) {
        const ts = hitEllipsoid(o, d, g.sclera, 1e-6, false);
        if (ts !== null) pts.push(W(madd(o, d, ts)));
        return { points: pts, termination: 'absorbed' };
      }
      {
        const p = madd(o, d, hc.t);
        pts.push(W(p));
        const r = refract(d, hc.normal, nOutside, a.nCornea);
        if (r.totalInternalReflection) return { points: pts, termination: 'blocked' };
        o = p;
        d = r.dir;
      }
      const steps: Array<{ surf: SphereSurface; n1: number; n2: number }> = [{ surf: corneaBack, n1: a.nCornea, n2: a.nAqueous }];
      for (const s of steps) {
        const t = hitSphereCap(o, d, s.surf, 1e-7);
        if (t === null) return { points: pts, termination: 'blocked' };
        const p = madd(o, d, t);
        pts.push(W(p));
        const nrm = normalize(sub(p, s.surf.center));
        const r = refract(d, nrm, s.n1, s.n2);
        if (r.totalInternalReflection) return { points: pts, termination: 'blocked' };
        o = p;
        d = r.dir;
      }

      // 2) Pupille: Irisebene vs. Linsenvorderfläche
      const tLens = hitSphereCap(o, d, lensFront, 1e-7);
      const tIris = Math.abs(d[2]) > 1e-9 ? (g.iris.z - o[2]) / d[2] : null;
      const pupilR = g.iris.innerR;
      if (tIris !== null && tIris > 0 && (tLens === null || tIris < tLens)) {
        const p = madd(o, d, tIris);
        if (Math.hypot(p[0], p[1]) > pupilR) {
          pts.push(W(p));
          return { points: pts, termination: 'blocked' };
        }
      }
      if (tLens === null) return { points: pts, termination: 'blocked' };
      const pl = madd(o, d, tLens);
      if (Math.hypot(pl[0], pl[1]) > pupilR + 0.05 && pl[2] < g.iris.z) {
        pts.push(W(pl));
        return { points: pts, termination: 'blocked' };
      }

      // 3) Augenlinse
      const lensSteps: Array<{ surf: SphereSurface; n1: number; n2: number }> = [
        { surf: lensFront, n1: a.nAqueous, n2: a.nLens },
        { surf: lensBack, n1: a.nLens, n2: a.nVitreous },
      ];
      for (const s of lensSteps) {
        const t = hitSphereCap(o, d, s.surf, 1e-7);
        if (t === null) return { points: pts, termination: 'blocked' };
        const p = madd(o, d, t);
        pts.push(W(p));
        const nrm = normalize(sub(p, s.surf.center));
        const r = refract(d, nrm, s.n1, s.n2);
        if (r.totalInternalReflection) return { points: pts, termination: 'blocked' };
        o = p;
        d = r.dir;
      }

      // 4) Retina
      const tr = hitEllipsoid(o, d, g.retina, 1e-6, true);
      if (tr === null) return { points: pts, termination: 'absorbed' };
      pts.push(W(madd(o, d, tr)));
      return { points: pts, termination: 'retina', finalDir: toWorldDir(rigid, d) };
    },
  };
}
