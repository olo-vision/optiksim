/**
 * Haupt-Tracer: nicht-sequentiell durch die optischen Elemente,
 * anschließend sequentiell durch das Modellauge.
 */
import type { LightSourceEntity, SceneDocument } from '@/model/types';
import { add, dot, madd, makeRigid, normalize, scale, sub, toWorldDir, toWorldPoint, type Vec3 } from '@/core/math/vec';
import { sceneSolids } from './solids';
import { buildEyeTraceModel, type EyeTraceModel } from './eyeTracer';
import { refract } from './refraction';
import { isReferenceWavelength, LAMBDA_D } from '@/engine/optics/dispersion';
import type { AstigmaticFocus, FocusAnalysis, Ray, RayPath, RayTermination, SolidHit, TraceResult, TraceSettings, TraceableSolid } from './types';

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  maxSteps: 48,
  escapeLength: 120,
  ambientIndex: 1.0,
};

/**
 * Erzeugt die Startstrahlen einer Lichtquelle.
 * Standard: Meridionalschnitt (lokal Y) und optional Sagittalschnitt (lokal X).
 * Mit `fanDirs` (Welt-Richtungen) werden die Fächer entlang dieser Richtungen gelegt
 * (z. B. Hauptschnitte eines astigmatischen Systems).
 */
export function generateSourceRays(
  src: LightSourceEntity,
  eyeApex: Vec3,
  fanDirs?: Vec3[],
  countOverride?: number,
  diameterOverride?: number,
): Array<Ray & { offset: number; fan: number }> {
  const rigid = makeRigid(src.transform.position, src.transform.rotation);
  const origin = src.transform.position;
  const forward = normalize(toWorldDir(rigid, [0, 0, 1]));
  const up = normalize(toWorldDir(rigid, [0, 1, 0]));
  const right = normalize(toWorldDir(rigid, [1, 0, 0]));
  const { kind, sagittal } = src.source;
  const beamDiameter = diameterOverride ?? src.source.beamDiameter;
  const count = Math.max(1, Math.min(101, Math.round(countOverride ?? src.source.rayCount)));
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(count === 1 ? 0 : -beamDiameter / 2 + (beamDiameter * i) / (count - 1));
  const project = (v: Vec3) => normalize(sub(v, scale(forward, dot(v, forward))));
  const axes: Vec3[] = fanDirs ? fanDirs.map(project) : sagittal ? [up, right] : [up];
  const rays: Array<Ray & { offset: number; fan: number }> = [];
  axes.forEach((ax, fan) => {
    for (const off of offsets) {
      if (fan > 0 && Math.abs(off) < 1e-9) continue; // Hauptstrahl nicht doppelt
      if (kind === 'parallel' || kind === 'line') {
        rays.push({ origin: madd(origin, ax, off), dir: forward, offset: off, fan });
      } else {
        // Punktquelle: Zielpunkte in der Ebene des Hornhautscheitels
        const dist = Math.max(1, dot(sub(eyeApex, origin), forward));
        const target = madd(madd(origin, forward, dist), ax, off);
        rays.push({ origin, dir: normalize(sub(target, origin)), offset: off, fan });
      }
    }
  });
  return rays;
}

const TIE = 1e-6;

/**
 * Verfolgt einen Strahl. Koinzidente Grenzflächen (z. B. KL-Rückfläche = Tränenfilm-Vorderfläche)
 * werden in einem Schritt behandelt: erst alle Medienwechsel, dann eine Brechung n₁ → n₂.
 * Trifft der Strahl die Hornhaut (auch aus dem Tränenfilm heraus), übernimmt der sequentielle Augen-Tracer
 * mit dem aktuellen Außenmedium.
 */
function traceRay(ray0: Ray, solids: TraceableSolid[], eye: EyeTraceModel | null, settings: TraceSettings): Omit<RayPath, 'index' | 'sourceId' | 'color' | 'offset'> {
  const points: Vec3[] = [ray0.origin];
  let ray = ray0;
  let stack: TraceableSolid[] = [];
  const topN = (st: TraceableSolid[]) => (st.length ? st[st.length - 1].n : settings.ambientIndex);

  for (let step = 0; step < settings.maxSteps; step++) {
    const hits: Array<SolidHit & { solid: TraceableSolid }> = [];
    for (const s of solids) {
      const h = s.intersect(ray, 1e-6);
      if (h) hits.push({ ...h, solid: s });
    }
    let best = hits.length ? hits.reduce((a, b) => (b.t < a.t ? b : a)) : null;
    const tEye = eye ? eye.entryDistance(ray) : null;

    if (tEye !== null && (!best || tEye <= best.t + TIE)) {
      const inside = eye!.traceInside(ray, topN(stack));
      points.push(...inside.points);
      return { points, termination: inside.termination, finalDir: inside.finalDir };
    }
    if (!best) {
      points.push(madd(ray.origin, ray.dir, settings.escapeLength));
      return { points, termination: 'escaped' };
    }
    const group = hits.filter((h) => h.t <= best!.t + TIE);
    const p = madd(ray.origin, ray.dir, best.t);
    points.push(p);
    if (group.some((h) => !h.optical)) return { points, termination: 'blocked' };

    const next = [...stack];
    for (const h of group) {
      if (h.entering) next.push(h.solid);
      else {
        const i = next.lastIndexOf(h.solid);
        if (i >= 0) next.splice(i, 1);
      }
    }
    const n1 = topN(stack);
    const n2 = topN(next);
    const r = Math.abs(n1 - n2) < 1e-12 ? { dir: ray.dir, totalInternalReflection: false } : refract(ray.dir, best.normal, n1, n2);
    if (!r.totalInternalReflection) stack = next;
    ray = { origin: p, dir: r.dir };
    best = null;
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

/* ---------------------- Astigmatismus-Analyse ---------------------- */

/** Welt-Richtung eines Meridians (TABO-Grad) im Augenrahmen. */
function meridianWorld(eye: EyeTraceModel, deg: number): Vec3 {
  const th = (deg * Math.PI) / 180;
  return normalize(toWorldDir(eye.rigid, [-Math.cos(th), Math.sin(th), 0]));
}

interface MeridianFocus {
  deg: number;
  point: Vec3;
  defocus: number;
}

/**
 * Abtastung der Fokuslage in 36 Meridianen (je Hauptstrahl + zwei achsnahe Strahlen, ±0,4 mm).
 * Anpassung D(φ) = a + b·cos2φ + c·sin2φ liefert die Hauptschnitte (Brennlinien).
 */
function meridianScan(src: LightSourceEntity, solids: TraceableSolid[], eye: EyeTraceModel, settings: TraceSettings): { a: number; amp: number; degMax: number; samples: MeridianFocus[] } | null {
  const retinaAxial = dot(sub(eye.retinaPoleWorld, eye.apexWorld), eye.axisWorld);
  const samples: MeridianFocus[] = [];
  for (let deg = 0; deg < 180; deg += 5) {
    const rays = generateSourceRays(src, eye.apexWorld, [meridianWorld(eye, deg)], 3, 0.8);
    const lines: Array<{ o: Vec3; d: Vec3 }> = [];
    for (const r of rays) {
      const res = traceRay(r, solids, eye, settings);
      if (res.termination !== 'retina' || !res.finalDir) break;
      lines.push({ o: res.points[res.points.length - 1], d: normalize(res.finalDir) });
    }
    if (lines.length !== 3) continue;
    const pnt = leastSquaresPoint(lines);
    if (!pnt) continue;
    samples.push({ deg, point: pnt, defocus: dot(sub(pnt, eye.apexWorld), eye.axisWorld) - retinaAxial });
  }
  if (samples.length < 6) return null;
  // Kleinste Quadrate für a, b, c
  let S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const y = [0, 0, 0];
  for (const smp of samples) {
    const f = [1, Math.cos((2 * smp.deg * Math.PI) / 180), Math.sin((2 * smp.deg * Math.PI) / 180)];
    for (let i = 0; i < 3; i++) {
      y[i] += f[i] * smp.defocus;
      for (let j = 0; j < 3; j++) S[i * 3 + j] += f[i] * f[j];
    }
  }
  const det = S[0] * (S[4] * S[8] - S[5] * S[7]) - S[1] * (S[3] * S[8] - S[5] * S[6]) + S[2] * (S[3] * S[7] - S[4] * S[6]);
  if (Math.abs(det) < 1e-12) return null;
  const solve = (col: number) => {
    const M = [...S];
    M[col] = y[0];
    M[3 + col] = y[1];
    M[6 + col] = y[2];
    return (M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6])) / det;
  };
  const a = solve(0);
  const b = solve(1);
  const c = solve(2);
  S = [];
  const amp = Math.hypot(b, c);
  let degMax = ((Math.atan2(c, b) / 2) * 180) / Math.PI;
  degMax = ((degMax % 180) + 180) % 180 || 180;
  return { a, amp, degMax, samples };
}

function focalPointForMeridian(src: LightSourceEntity, solids: TraceableSolid[], eye: EyeTraceModel, settings: TraceSettings, deg: number): Vec3 | null {
  const rays = generateSourceRays(src, eye.apexWorld, [meridianWorld(eye, deg)], 3, 0.8);
  const lines: Array<{ o: Vec3; d: Vec3 }> = [];
  for (const r of rays) {
    const res = traceRay(r, solids, eye, settings);
    if (res.termination !== 'retina' || !res.finalDir) return null;
    lines.push({ o: res.points[res.points.length - 1], d: normalize(res.finalDir) });
  }
  return leastSquaresPoint(lines);
}

/** Ausdehnung eines Strahlenfächers in einer Ebene senkrecht zur Augenachse. */
function fanWidthAt(paths: RayPath[], fan: number, planePoint: Vec3, axis: Vec3): number {
  const pts: Vec3[] = [];
  for (const p of paths) {
    if (p.fan !== fan || p.termination !== 'retina' || !p.finalDir) continue;
    const o = p.points[p.points.length - 1];
    const d = normalize(p.finalDir);
    const den = dot(d, axis);
    if (Math.abs(den) < 1e-9) continue;
    const t = dot(sub(planePoint, o), axis) / den;
    pts.push(madd(o, d, t));
  }
  if (pts.length < 2) return 0;
  let w = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) w = Math.max(w, Math.hypot(...sub(pts[i], pts[j])));
  return w;
}

const ASTIG_THRESHOLD_MM = 0.01;

export function traceScene(doc: SceneDocument, settings: TraceSettings = DEFAULT_TRACE_SETTINGS): TraceResult {
  const t0 = performance.now();
  // Phase 4: Dispersion – Körper und Auge je Wellenlänge (d-Linie = Phase-2-Verhalten)
  // Geräte (Skiaskop) haben eigene Darstellungen und werden hier nicht als Strahlenbündel verfolgt
  const traced = doc.lights.filter((l) => l.visible && (l.source.deviceRole ?? 'none') === 'none');
  const principalLambda = traced[0]?.source.wavelength ?? LAMBDA_D;
  const byLambda = new Map<number, { solids: TraceableSolid[]; eye: EyeTraceModel | null }>();
  const forLambda = (lam: number) => {
    const key = isReferenceWavelength(lam) ? LAMBDA_D : Math.round(lam * 10) / 10;
    let e = byLambda.get(key);
    if (!e) {
      e = { solids: sceneSolids(doc, key), eye: doc.eye.visible ? buildEyeTraceModel(doc.eye, key) : null };
      byLambda.set(key, e);
    }
    return e;
  };
  const { solids, eye } = forLambda(principalLambda);
  const apex = eye ? eye.apexWorld : toWorldPoint(makeRigid(doc.eye.transform.position, doc.eye.transform.rotation), [0, 0, 0]);
  const stats: Record<RayTermination, number> = { retina: 0, escaped: 0, blocked: 0, absorbed: 0, 'max-steps': 0 };
  const paths: RayPath[] = [];
  let astig: AstigmaticFocus | null = null;
  const principalSource = traced[0];

  // 1) Meridian-Abtastung (unsichtbare Analysestrahlen) mit der ersten Lichtquelle
  let principal: [number, number] | null = null;
  let scan: ReturnType<typeof meridianScan> = null;
  if (eye && principalSource) {
    scan = meridianScan(principalSource, solids, eye, settings);
    if (scan && 2 * scan.amp > ASTIG_THRESHOLD_MM) principal = [scan.degMax, (scan.degMax + 90) % 180 || 180];
  }

  // 2) Sichtbare Strahlen
  for (const src of traced) {
    const mode = src.source.fanMode ?? 'principal';
    const fanDirs =
      eye && principal && mode === 'principal' ? [meridianWorld(eye, principal[0]), meridianWorld(eye, principal[1])] : undefined;
    const rays = generateSourceRays(src, apex, fanDirs ?? (mode === 'cross' && eye ? [meridianWorld(eye, 90), meridianWorld(eye, 180)] : undefined));
    const media = forLambda(src.source.wavelength ?? LAMBDA_D);
    rays.forEach((r, i) => {
      const res = traceRay(r, media.solids, media.eye, settings);
      stats[res.termination]++;
      paths.push({ ...res, index: i, sourceId: src.id, color: r.fan === 1 && fanDirs ? SECOND_FAN_COLOR : src.source.color, offset: r.offset, fan: r.fan });
    });
  }

  // 3) Brennlinien
  if (eye && principalSource && principal && scan) {
    const retinaAxial = dot(sub(eye.retinaPoleWorld, eye.apexWorld), eye.axisWorld);
    const lines = principal.map((deg, k) => {
      const pnt = focalPointForMeridian(principalSource, solids, eye, settings, deg) ?? eye.retinaPoleWorld;
      const width = fanWidthAt(paths, 1 - k, pnt, eye.axisWorld);
      return {
        meridianDeg: deg,
        defocusMm: dot(sub(pnt, eye.apexWorld), eye.axisWorld) - retinaAxial,
        pointWorld: pnt,
        lineDirWorld: meridianWorld(eye, deg + 90),
        lengthMm: Math.max(0.3, width),
      };
    }) as AstigmaticFocus['lines'];
    const mid = scale(add(lines[0].pointWorld, lines[1].pointWorld), 0.5);
    astig = {
      lines,
      sturmIntervalMm: Math.abs(lines[0].defocusMm - lines[1].defocusMm),
      leastConfusionWorld: mid,
      leastConfusionDefocusMm: (lines[0].defocusMm + lines[1].defocusMm) / 2,
    };
  }

  const focus = eye ? analyzeFocus(paths, eye) : null;
  if (focus && astig) focus.astigmatism = astig;
  return { paths, focus, stats, computeMs: performance.now() - t0 };
}

export const SECOND_FAN_COLOR = '#7fd8ff';
