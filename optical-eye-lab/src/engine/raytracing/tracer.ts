/**
 * Haupt-Tracer: nicht-sequentiell durch die optischen Elemente,
 * anschließend sequentiell durch das Modellauge.
 */
import type { LightSourceEntity, SceneDocument } from '@/model/types';
import { add, dot, madd, makeRigid, normalize, scale, sub, toWorldDir, toWorldPoint, type Vec3 } from '@/core/math/vec';
import { solidFromElement } from './solids';
import { buildEyeTraceModel, type EyeTraceModel } from './eyeTracer';
import { refract } from './refraction';
import type { FocusAnalysis, Ray, RayPath, RayTermination, TraceResult, TraceSettings, TraceableSolid } from './types';

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  maxSteps: 48,
  escapeLength: 120,
  ambientIndex: 1.0,
};

/** Erzeugt die Startstrahlen einer Lichtquelle (Meridional- und optional Sagittalschnitt). */
export function generateSourceRays(src: LightSourceEntity, eyeApex: Vec3): Array<Ray & { offset: number }> {
  const rigid = makeRigid(src.transform.position, src.transform.rotation);
  const origin = src.transform.position;
  const forward = normalize(toWorldDir(rigid, [0, 0, 1]));
  const up = normalize(toWorldDir(rigid, [0, 1, 0]));
  const right = normalize(toWorldDir(rigid, [1, 0, 0]));
  const { rayCount, beamDiameter, kind, sagittal } = src.source;
  const count = Math.max(1, Math.min(101, Math.round(rayCount)));
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(count === 1 ? 0 : -beamDiameter / 2 + (beamDiameter * i) / (count - 1));
  const axes: Vec3[] = sagittal ? [up, right] : [up];
  const rays: Array<Ray & { offset: number }> = [];
  for (const ax of axes) {
    for (const off of offsets) {
      if (ax === right && Math.abs(off) < 1e-9) continue; // Hauptstrahl nicht doppelt
      if (kind === 'parallel') {
        rays.push({ origin: madd(origin, ax, off), dir: forward, offset: off });
      } else {
        // Punktquelle: Zielpunkte in der Ebene des Hornhautscheitels
        const dist = Math.max(1, dot(sub(eyeApex, origin), forward));
        const target = madd(madd(origin, forward, dist), ax, off);
        rays.push({ origin, dir: normalize(sub(target, origin)), offset: off });
      }
    }
  }
  return rays;
}

function traceRay(ray0: Ray, solids: TraceableSolid[], eye: EyeTraceModel | null, settings: TraceSettings): Omit<RayPath, 'index' | 'sourceId' | 'color' | 'offset'> {
  const points: Vec3[] = [ray0.origin];
  let ray = ray0;
  const stack: TraceableSolid[] = [];
  const currentN = () => (stack.length ? stack[stack.length - 1].n : settings.ambientIndex);

  for (let step = 0; step < settings.maxSteps; step++) {
    let best: { t: number; solid: TraceableSolid; normal: Vec3; entering: boolean; optical: boolean } | null = null;
    for (const s of solids) {
      const h = s.intersect(ray, 1e-6);
      if (h && (!best || h.t < best.t)) best = { ...h, solid: s };
    }
    const tEye = eye && stack.length === 0 ? eye.entryDistance(ray) : null;

    if (tEye !== null && (!best || tEye < best.t)) {
      const inside = eye!.traceInside(ray, currentN());
      points.push(...inside.points);
      return { points, termination: inside.termination, finalDir: inside.finalDir };
    }
    if (!best) {
      points.push(madd(ray.origin, ray.dir, settings.escapeLength));
      return { points, termination: 'escaped' };
    }
    const p = madd(ray.origin, ray.dir, best.t);
    points.push(p);
    if (!best.optical) return { points, termination: 'blocked' };

    const n1 = currentN();
    let n2: number;
    if (best.entering) n2 = best.solid.n;
    else {
      const rest = stack.filter((s) => s !== best!.solid);
      n2 = rest.length ? rest[rest.length - 1].n : settings.ambientIndex;
    }
    const r = refract(ray.dir, best.normal, n1, n2);
    if (!r.totalInternalReflection) {
      if (best.entering) stack.push(best.solid);
      else {
        const i = stack.lastIndexOf(best.solid);
        if (i >= 0) stack.splice(i, 1);
      }
    }
    ray = { origin: p, dir: r.dir };
  }
  return { points, termination: 'max-steps' };
}

type Line3 = { o: Vec3; d: Vec3 };

/** Punkt mit minimalem quadratischen Abstand zu allen Geraden: Σ(I − ddᵀ)x = Σ(I − ddᵀ)o */
function leastSquaresPoint(lines: Line3[]): Vec3 | null {
  if (lines.length < 2) return null;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  for (const { o, d } of lines) {
    const m = [1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2], -d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2], -d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]];
    for (let i = 0; i < 9; i++) A[i] += m[i];
    b[0] += m[0] * o[0] + m[1] * o[1] + m[2] * o[2];
    b[1] += m[3] * o[0] + m[4] * o[1] + m[5] * o[2];
    b[2] += m[6] * o[0] + m[7] * o[1] + m[8] * o[2];
  }
  const det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (Math.abs(det) < 1e-14) return null;
  const inv = [
    (A[4] * A[8] - A[5] * A[7]) / det, (A[2] * A[7] - A[1] * A[8]) / det, (A[1] * A[5] - A[2] * A[4]) / det,
    (A[5] * A[6] - A[3] * A[8]) / det, (A[0] * A[8] - A[2] * A[6]) / det, (A[2] * A[3] - A[0] * A[5]) / det,
    (A[3] * A[7] - A[4] * A[6]) / det, (A[1] * A[6] - A[0] * A[7]) / det, (A[0] * A[4] - A[1] * A[3]) / det,
  ];
  const p: Vec3 = [
    inv[0] * b[0] + inv[1] * b[1] + inv[2] * b[2],
    inv[3] * b[0] + inv[4] * b[1] + inv[5] * b[2],
    inv[6] * b[0] + inv[7] * b[1] + inv[8] * b[2],
  ];
  return p.every(Number.isFinite) ? p : null;
}

/**
 * Fokusanalyse im Glaskörper:
 *  - achsnah: aus dem Hauptstrahl und den innersten Strahlen (≈ paraxial, vergleichbar mit der Refraktion)
 *  - Bündel: Punkt kleinster Streuung aller Strahlen (enthält die sphärische Aberration)
 */
function analyzeFocus(paths: RayPath[], eye: EyeTraceModel): FocusAnalysis | null {
  const hits = paths.filter((p) => p.termination === 'retina' && p.finalDir && p.points.length >= 2);
  const toLine = (p: RayPath): Line3 => ({ o: p.points[p.points.length - 1], d: normalize(p.finalDir!) });
  const all = leastSquaresPoint(hits.map(toLine));
  if (!all) return null;
  const nonZero = hits.map((p) => Math.abs(p.offset)).filter((x) => x > 1e-6);
  const minOff = nonZero.length ? Math.min(...nonZero) : 0;
  const inner = hits.filter((p) => Math.abs(p.offset) <= minOff * 1.01 + 1e-6);
  const parax = leastSquaresPoint(inner.map(toLine)) ?? all;

  const retinaAxial = dot(sub(eye.retinaPoleWorld, eye.apexWorld), eye.axisWorld);
  const axialOf = (p: Vec3) => dot(sub(p, eye.apexWorld), eye.axisWorld);
  const pts = hits.map((h) => h.points[h.points.length - 1]);
  const c = scale(pts.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
  const rms = Math.sqrt(pts.reduce((s, p) => s + dot(sub(p, c), sub(p, c)), 0) / pts.length);
  return {
    paraxialFocusWorld: parax,
    paraxialDefocusMm: axialOf(parax) - retinaAxial,
    focusWorld: all,
    defocusMm: axialOf(all) - retinaAxial,
    retinaSpotRms: rms,
    raysUsed: hits.length,
  };
}

export function traceScene(doc: SceneDocument, settings: TraceSettings = DEFAULT_TRACE_SETTINGS): TraceResult {
  const t0 = performance.now();
  const solids = doc.elements.filter((e) => e.visible).map(solidFromElement);
  const eye = doc.eye.visible ? buildEyeTraceModel(doc.eye) : null;
  const apex = eye ? eye.apexWorld : toWorldPoint(makeRigid(doc.eye.transform.position, doc.eye.transform.rotation), [0, 0, 0]);
  const stats: Record<RayTermination, number> = { retina: 0, escaped: 0, blocked: 0, absorbed: 0, 'max-steps': 0 };
  const paths: RayPath[] = [];
  for (const src of doc.lights) {
    if (!src.visible) continue;
    const rays = generateSourceRays(src, apex);
    rays.forEach((r, i) => {
      const res = traceRay(r, solids, eye, settings);
      stats[res.termination]++;
      paths.push({ ...res, index: i, sourceId: src.id, color: src.source.color, offset: r.offset });
    });
  }
  const focus = eye ? analyzeFocus(paths, eye) : null;
  return { paths, focus, stats, computeMs: performance.now() - t0 };
}
