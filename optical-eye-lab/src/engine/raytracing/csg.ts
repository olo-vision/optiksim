/**
 * CSG-Primitive für die Strahl-Körper-Schnittberechnung.
 * Jeder Körper ist der Durchschnitt (∩) mehrerer Primitive; so lassen sich
 * Linsen, Menisken, Prismen, Platten und Zylinder einheitlich behandeln.
 */
import type { Boundary, Interval, Primitive } from './types';
import { dot, madd, normalize, scale, sub, toLocalDir, toLocalPoint, toWorldDir, type RigidTransform, type Vec3 } from '@/core/math/vec';
import { isPlano, isToric, sagGradXY, sagXY, type SurfaceSpec } from '@/core/math/surfaces';

const INF: Boundary = { t: Infinity, normal: null, optical: true };
const NINF: Boundary = { t: -Infinity, normal: null, optical: true };
const EPS = 1e-12;

/** Halbraum dot(p − p0, n) ≤ 0 (n = Außennormale). */
export function halfSpace(p0: Vec3, n: Vec3, optical = true): Primitive {
  const nn = normalize(n);
  return {
    intervals(o, d) {
      const a = dot(sub(o, p0), nn);
      const b = dot(d, nn);
      if (Math.abs(b) < EPS) return a <= 0 ? [{ enter: NINF, exit: INF }] : [];
      const t = -a / b;
      if (b > 0) return [{ enter: NINF, exit: { t, normal: nn, optical } }];
      return [{ enter: { t, normal: nn, optical }, exit: INF }];
    },
  };
}

function sphereRoots(o: Vec3, d: Vec3, c: Vec3, R: number): [number, number] | null {
  const oc = sub(o, c);
  const b = dot(oc, d);
  const cc = dot(oc, oc) - R * R;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/** Kugelinneres (|p − c| ≤ R). */
export function sphereInside(c: Vec3, R: number, optical = true): Primitive {
  return {
    intervals(o, d) {
      const r = sphereRoots(o, d, c, R);
      if (!r) return [];
      const n0 = scale(sub(madd(o, d, r[0]), c), 1 / R);
      const n1 = scale(sub(madd(o, d, r[1]), c), 1 / R);
      return [{ enter: { t: r[0], normal: n0, optical }, exit: { t: r[1], normal: n1, optical } }];
    },
  };
}

/** Kugeläußeres (|p − c| ≥ R). Außennormale zeigt zum Kugelzentrum. */
export function sphereOutside(c: Vec3, R: number, optical = true): Primitive {
  return {
    intervals(o, d) {
      const r = sphereRoots(o, d, c, R);
      if (!r) return [{ enter: NINF, exit: INF }];
      const n0 = scale(sub(c, madd(o, d, r[0])), 1 / R);
      const n1 = scale(sub(c, madd(o, d, r[1])), 1 / R);
      return [
        { enter: NINF, exit: { t: r[0], normal: n0, optical } },
        { enter: { t: r[1], normal: n1, optical }, exit: INF },
      ];
    },
  };
}

/** Unendlicher Zylinder um die lokale Z-Achse (x² + y² ≤ r²). */
export function cylinderZ(r: number, optical = false): Primitive {
  return {
    intervals(o, d) {
      const a = d[0] * d[0] + d[1] * d[1];
      const b = o[0] * d[0] + o[1] * d[1];
      const c = o[0] * o[0] + o[1] * o[1] - r * r;
      if (a < EPS) return c <= 0 ? [{ enter: NINF, exit: INF }] : [];
      const disc = b * b - a * c;
      if (disc < 0) return [];
      const s = Math.sqrt(disc);
      const t0 = (-b - s) / a;
      const t1 = (-b + s) / a;
      const p0 = madd(o, d, t0);
      const p1 = madd(o, d, t1);
      return [
        {
          enter: { t: t0, normal: normalize([p0[0], p0[1], 0]), optical },
          exit: { t: t1, normal: normalize([p1[0], p1[1], 0]), optical },
        },
      ];
    },
  };
}

/** Durchschnitt zweier Intervalllisten. */
function intersectLists(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const enter = x.enter.t >= y.enter.t ? x.enter : y.enter;
      const exit = x.exit.t <= y.exit.t ? x.exit : y.exit;
      if (enter.t < exit.t) out.push({ enter, exit });
    }
  }
  return out;
}

/** Innenintervalle des Durchschnitts aller Primitive. */
export function intersectPrimitives(prims: Primitive[], o: Vec3, d: Vec3): Interval[] {
  let acc: Interval[] = [{ enter: NINF, exit: INF }];
  for (const p of prims) {
    acc = intersectLists(acc, p.intervals(o, d));
    if (acc.length === 0) break;
  }
  return acc;
}

/* ======================================================================
 * Phase 2: allgemeine (torische) Flächen und Koordinatenrahmen
 * ====================================================================== */


export interface SagRootOptions {
  /** Radius des Suchzylinders (Apertur) */
  rLim: number;
  /** z-Fenster, in dem die Fläche gesucht wird */
  zMin: number;
  zMax: number;
  samples?: number;
}

/** Parameterbereich, in dem die Gerade innerhalb von Zylinder r ≤ rLim und z-Fenster liegt. */
function searchWindow(o: Vec3, d: Vec3, opt: SagRootOptions): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  // Zylinder
  const a = d[0] * d[0] + d[1] * d[1];
  const b = o[0] * d[0] + o[1] * d[1];
  const c = o[0] * o[0] + o[1] * o[1] - opt.rLim * opt.rLim;
  if (a < EPS) {
    if (c > 0) return null;
  } else {
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a;
    t1 = (-b + s) / a;
  }
  // z-Fenster
  if (Math.abs(d[2]) < EPS) {
    if (o[2] < opt.zMin || o[2] > opt.zMax) return null;
  } else {
    const za = (opt.zMin - o[2]) / d[2];
    const zb = (opt.zMax - o[2]) / d[2];
    t0 = Math.max(t0, Math.min(za, zb));
    t1 = Math.min(t1, Math.max(za, zb));
  }
  if (!(t0 < t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [t0, t1];
}

/**
 * Nullstellen von f(t) = z(t) − z₀ − sag(x(t), y(t)) im Suchfenster (Abtastung + Bisektion).
 * Liefert zusätzlich das Vorzeichen von f am Fensteranfang.
 */
export function sagRoots(o: Vec3, d: Vec3, vertexZ: number, spec: SurfaceSpec, opt: SagRootOptions): { roots: number[]; startSign: number; window: [number, number] | null } {
  const w = searchWindow(o, d, opt);
  if (!w) return { roots: [], startSign: Math.sign(o[2] - vertexZ) || 1, window: null };
  const f = (t: number) => o[2] + t * d[2] - vertexZ - sagXY(spec, o[0] + t * d[0], o[1] + t * d[1]);
  const N = opt.samples ?? 40;
  const roots: number[] = [];
  let tPrev = w[0];
  let fPrev = f(tPrev);
  const startSign = fPrev >= 0 ? 1 : -1;
  for (let i = 1; i <= N; i++) {
    const t = w[0] + ((w[1] - w[0]) * i) / N;
    const ft = f(t);
    if ((fPrev < 0 && ft >= 0) || (fPrev >= 0 && ft < 0)) {
      let lo = tPrev;
      let hi = t;
      let flo = fPrev;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if ((flo < 0 && fm >= 0) || (flo >= 0 && fm < 0)) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      roots.push((lo + hi) / 2);
    }
    tPrev = t;
    fPrev = ft;
  }
  return { roots, startSign, window: w };
}

/** Flächennormale (Richtung +z-seitig) an lokalem Punkt. */
export function sagNormal(spec: SurfaceSpec, x: number, y: number): Vec3 {
  const [gx, gy] = sagGradXY(spec, x, y);
  return normalize([-gx, -gy, 1]);
}

/**
 * Bereich hinter (materialAfter = true: z ≥ Fläche) bzw. vor (false: z ≤ Fläche) einer
 * beliebigen Fläche. Sphärische/plane Flächen nutzen die exakten analytischen Primitive.
 */
export function surfaceRegion(spec: SurfaceSpec, vertexZ: number, materialAfter: boolean, opt: SagRootOptions, optical = true): Primitive {
  if (!isToric(spec)) {
    const R = spec.R;
    if (isPlano(R)) return halfSpace([0, 0, vertexZ], [0, 0, materialAfter ? -1 : 1], optical);
    const center: Vec3 = [0, 0, vertexZ + R];
    const inside = materialAfter ? R > 0 : R < 0;
    return inside ? sphereInside(center, Math.abs(R), optical) : sphereOutside(center, Math.abs(R), optical);
  }
  const s = materialAfter ? 1 : -1;
  return {
    intervals(o, d) {
      const { roots, startSign } = sagRoots(o, d, vertexZ, spec, opt);
      // innen, wenn s·f ≥ 0
      let inside = s * startSign >= 0;
      const out: Interval[] = [];
      let enter: Boundary = inside ? { t: -Infinity, normal: null, optical } : (null as unknown as Boundary);
      const normalAt = (t: number): Vec3 => {
        const x = o[0] + t * d[0];
        const y = o[1] + t * d[1];
        return scale(sagNormal(spec, x, y), -s);
      };
      for (const t of roots) {
        if (inside) {
          out.push({ enter, exit: { t, normal: normalAt(t), optical } });
          inside = false;
        } else {
          enter = { t, normal: normalAt(t), optical };
          inside = true;
        }
      }
      if (inside) out.push({ enter, exit: { t: Infinity, normal: null, optical } });
      return out;
    },
  };
}

/** Primitive in einem anderen Koordinatenrahmen (starre Transformation, t bleibt erhalten). */
export function inFrame(prim: Primitive, rigid: RigidTransform): Primitive {
  const conv = (b: Boundary): Boundary => (b.normal ? { ...b, normal: toWorldDir(rigid, b.normal) } : b);
  return {
    intervals(o, d) {
      return prim.intervals(toLocalPoint(rigid, o), toLocalDir(rigid, d)).map((iv) => ({ enter: conv(iv.enter), exit: conv(iv.exit) }));
    },
  };
}
