/**
 * CSG-Primitive für die Strahl-Körper-Schnittberechnung.
 * Jeder Körper ist der Durchschnitt (∩) mehrerer Primitive; so lassen sich
 * Linsen, Menisken, Prismen, Platten und Zylinder einheitlich behandeln.
 */
import type { Boundary, Interval, Primitive } from './types';
import { dot, madd, normalize, scale, sub, type Vec3 } from '@/core/math/vec';

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
