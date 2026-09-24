/**
 * Überführt optische Elemente des Datenmodells in verfolgbare Körper.
 * Neue Elementfamilien benötigen hier genau eine zusätzliche Builder-Funktion.
 */
import type { EyeEntity, LensElement, MediumElement, OpticalElement, PlateElement, PrismElement, SceneDocument } from '@/model/types';
import { EYE_MEDIA_ABBE, indexAt, isReferenceWavelength, LAMBDA_D } from '@/engine/optics/dispersion';
import { findMaterial } from '@/model/media';
import { effectiveLens, corneaSpec } from '@/model/derived/effectiveLens';
import { computeEyeGeometry } from '@/model/derived/eyeGeometry';
import { DEFAULT_TEAR_INDEX, isOnEye } from '@/model/derived/contactSeat';
import { resolveLensShape } from '@/model/derived/elementShape';
import { computePrismGeometry } from '@/model/derived/prismGeometry';
import { sagXY } from '@/core/math/surfaces';
import { outlineRadius } from '@/core/math/outline';
import { makeRigid, toLocalDir, toLocalPoint, toWorldDir, type RigidTransform, type Vec3 } from '@/core/math/vec';
import { cylinderZ, halfSpace, inFrame, intersectPrimitives, sphereInside, surfaceRegion } from './csg';
import type { Primitive, Ray, SolidHit, TraceableSolid } from './types';

function lensPrimitives(el: LensElement, eye?: EyeEntity): Primitive[] {
  const s = resolveLensShape(el);
  const { outline, diameter, width, height } = el.lens;
  const { front, back } = effectiveLens(el, eye);
  const zf = s.frontVertexZ;
  const zb = s.backVertexZ;
  const h = s.semiAperture;
  // größte/kleinste Pfeilhöhe entlang der Kontur (für Such- und Begrenzungsfenster)
  let fMin = 0;
  let bMax = 0;
  let fMax = 0;
  let bMin = 0;
  for (let i = 0; i < 72; i++) {
    const phi = (i / 72) * Math.PI * 2;
    const r = Math.min(outlineRadius(outline, diameter, width, height, phi), h);
    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    const sf = sagXY(front, x, y);
    const sb = sagXY(back, x, y);
    fMin = Math.min(fMin, sf);
    fMax = Math.max(fMax, sf);
    bMin = Math.min(bMin, sb);
    bMax = Math.max(bMax, sb);
  }
  const win = { rLim: h * 1.02, zMin: zf + fMin - 0.5, zMax: zb + bMax + 0.5 };
  const prims: Primitive[] = [];
  prims.push(surfaceRegion(front, zf, true, { ...win, zMin: zf + fMin - 0.5, zMax: zf + fMax + 0.5 }));
  prims.push(surfaceRegion(back, zb, false, { ...win, zMin: zb + bMin - 0.5, zMax: zb + bMax + 0.5 }));
  // Begrenzungs-Slab gegen Mehrdeutigkeiten der Kugelflächen
  prims.push(halfSpace([0, 0, zf + fMin - 1e-6], [0, 0, -1], false));
  prims.push(halfSpace([0, 0, zb + bMax + 1e-6], [0, 0, 1], false));
  // Rand (Kontur)
  if (outline === 'round') prims.push(cylinderZ(h, false));
  else {
    const N = 64;
    for (let i = 0; i < N; i++) {
      const phi = ((i + 0.5) / N) * Math.PI * 2;
      const r = Math.min(outlineRadius(outline, diameter, width, height, phi), h);
      prims.push(halfSpace([r * Math.cos(phi), r * Math.sin(phi), 0], [Math.cos(phi), Math.sin(phi), 0], false));
    }
  }
  return prims;
}

function prismPrimitives(el: PrismElement): Primitive[] {
  return computePrismGeometry(el.prism).planes.map((p) => halfSpace(p.point, p.normal, p.optical));
}

function boxPrimitives(w: number, h: number, d: number, sideOptical: boolean): Primitive[] {
  return [
    halfSpace([0, 0, -d / 2], [0, 0, -1]),
    halfSpace([0, 0, d / 2], [0, 0, 1]),
    halfSpace([w / 2, 0, 0], [1, 0, 0], sideOptical),
    halfSpace([-w / 2, 0, 0], [-1, 0, 0], sideOptical),
    halfSpace([0, h / 2, 0], [0, 1, 0], sideOptical),
    halfSpace([0, -h / 2, 0], [0, -1, 0], sideOptical),
  ];
}

function platePrimitives(el: PlateElement): Primitive[] {
  const { width, height, thickness } = el.plate;
  return boxPrimitives(width, height, thickness, false);
}

function mediumPrimitives(el: MediumElement): Primitive[] {
  const [sx, sy, sz] = el.transform.scale;
  const { shape, width, height, depth } = el.body;
  if (shape === 'box') return boxPrimitives(width * sx, height * sy, depth * sz, true);
  if (shape === 'cylinder') {
    const r = (width / 2) * Math.max(sx, sy);
    return [cylinderZ(r, true), halfSpace([0, 0, -(depth * sz) / 2], [0, 0, -1]), halfSpace([0, 0, (depth * sz) / 2], [0, 0, 1])];
  }
  return [sphereInside([0, 0, 0], (width / 2) * ((sx + sy + sz) / 3))];
}

export function primitivesForElement(el: OpticalElement, eye?: EyeEntity): Primitive[] {
  switch (el.family) {
    case 'lens':
      return lensPrimitives(el, eye);
    case 'prism':
      return prismPrimitives(el);
    case 'plate':
      return platePrimitives(el);
    case 'medium':
      return mediumPrimitives(el);
  }
}

/** Erstellt einen Körper in Weltkoordinaten aus lokalen Primitiven und einer starren Transformation. */
/** Brechungsindex eines Elements bei λ (Phase 4: Dispersion über die Abbe-Zahl des Materials). */
export function elementIndexAt(el: OpticalElement, lambdaNm = LAMBDA_D): number {
  if (isReferenceWavelength(lambdaNm)) return el.medium.n;
  return indexAt(el.medium.n, el.medium.abbe ?? findMaterial(el.medium.presetId)?.abbe, lambdaNm);
}

export function solidFromElement(el: OpticalElement, eye?: EyeEntity, lambdaNm = LAMBDA_D): TraceableSolid {
  return solidFromPrimitives(el.id, elementIndexAt(el, lambdaNm), primitivesForElement(el, eye), makeRigid(el.transform.position, el.transform.rotation));
}

/** Körper aus Primitiven in einem lokalen Rahmen. */
export function solidFromPrimitives(id: string, n: number, prims: Primitive[], rigid: RigidTransform): TraceableSolid {
  return {
    id,
    n,
    intersect(ray: Ray, tMin: number): SolidHit | null {
      const o = toLocalPoint(rigid, ray.origin);
      const d = toLocalDir(rigid, ray.dir);
      const intervals = intersectPrimitives(prims, o, d);
      let best: SolidHit | null = null;
      for (const iv of intervals) {
        for (const [b, entering] of [
          [iv.enter, true],
          [iv.exit, false],
        ] as const) {
          if (b.t > tMin && Number.isFinite(b.t) && b.normal && (!best || b.t < best.t)) {
            best = { t: b.t, normal: toWorldDir(rigid, b.normal as Vec3), entering, optical: b.optical };
          }
        }
      }
      return best;
    },
  };
}

/**
 * Tränenfilm zwischen aufgesetzter Kontaktlinse und Hornhaut (Phase 2).
 * Körper = hinter der KL-Rückfläche (KL-Rahmen) ∩ vor der Hornhautvorderfläche (Augenrahmen)
 *          ∩ innerhalb des KL-Durchmessers ∩ vor der Limbusebene.
 */
export function tearFilmSolid(el: LensElement, eye: EyeEntity, lambdaNm = LAMBDA_D): TraceableSolid {
  const s = resolveLensShape(el);
  const back = effectiveLens(el, eye).back;
  const clRigid = makeRigid(el.transform.position, el.transform.rotation);
  const eyeRigid = makeRigid(eye.transform.position, eye.transform.rotation);
  const g = computeEyeGeometry(eye.anatomy);
  const h = s.semiAperture;
  const prims: Primitive[] = [
    inFrame(surfaceRegion(back, s.backVertexZ, true, { rLim: h * 1.02, zMin: s.backVertexZ - 0.5, zMax: s.backVertexZ + h + 1 }), clRigid),
    inFrame(cylinderZ(h, true), clRigid),
    inFrame(halfSpace([0, 0, s.frontVertexZ], [0, 0, -1], true), clRigid),
    inFrame(surfaceRegion(corneaSpec(eye), 0, false, { rLim: g.limbus.h, zMin: -0.5, zMax: g.limbus.z + 1 }), eyeRigid),
    inFrame(halfSpace([0, 0, g.limbus.z], [0, 0, 1], true), eyeRigid),
  ];
  return solidFromPrimitives(`${el.id}__tear`, indexAt(el.contact?.nTear ?? DEFAULT_TEAR_INDEX, EYE_MEDIA_ABBE, lambdaNm), prims, { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
}

/** Alle verfolgbaren Körper einer Szene (Elemente + Tränenfilme). */
export function sceneSolids(doc: SceneDocument, lambdaNm = LAMBDA_D): TraceableSolid[] {
  const solids: TraceableSolid[] = [];
  for (const e of doc.elements) {
    if (!e.visible) continue;
    solids.push(solidFromElement(e, doc.eye, lambdaNm));
    if (isOnEye(e) && (e.contact!.tearFilm ?? true) && doc.eye.visible) solids.push(tearFilmSolid(e, doc.eye, lambdaNm));
  }
  return solids;
}

