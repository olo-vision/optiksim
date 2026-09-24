/**
 * Überführt optische Elemente des Datenmodells in verfolgbare Körper.
 * Neue Elementfamilien benötigen hier genau eine zusätzliche Builder-Funktion.
 */
import type { LensElement, MediumElement, OpticalElement, PlateElement, PrismElement } from '@/model/types';
import { resolveLensShape } from '@/model/derived/elementShape';
import { computePrismGeometry } from '@/model/derived/prismGeometry';
import { isPlano, sag } from '@/core/math/surfaces';
import { outlineRadius } from '@/core/math/outline';
import { makeRigid, toLocalDir, toLocalPoint, toWorldDir, type Vec3 } from '@/core/math/vec';
import { cylinderZ, halfSpace, intersectPrimitives, sphereInside, sphereOutside } from './csg';
import type { Primitive, Ray, SolidHit, TraceableSolid } from './types';

function lensPrimitives(el: LensElement): Primitive[] {
  const s = resolveLensShape(el);
  const { frontRadius: R1, backRadius: R2, outline, diameter, width, height } = el.lens;
  const zf = s.frontVertexZ;
  const zb = s.backVertexZ;
  const h = s.semiAperture;
  const prims: Primitive[] = [];
  // Vorderfläche
  if (isPlano(R1)) prims.push(halfSpace([0, 0, zf], [0, 0, -1]));
  else if (R1 > 0) prims.push(sphereInside([0, 0, zf + R1], R1));
  else prims.push(sphereOutside([0, 0, zf + R1], -R1));
  // Rückfläche
  if (isPlano(R2)) prims.push(halfSpace([0, 0, zb], [0, 0, 1]));
  else if (R2 < 0) prims.push(sphereInside([0, 0, zb + R2], -R2));
  else prims.push(sphereOutside([0, 0, zb + R2], R2));
  // Begrenzungs-Slab gegen Mehrdeutigkeiten der Kugelflächen
  prims.push(halfSpace([0, 0, zf + Math.min(0, sag(R1, h)) - 1e-6], [0, 0, -1], false));
  prims.push(halfSpace([0, 0, zb + Math.max(0, sag(R2, h)) + 1e-6], [0, 0, 1], false));
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

export function primitivesForElement(el: OpticalElement): Primitive[] {
  switch (el.family) {
    case 'lens':
      return lensPrimitives(el);
    case 'prism':
      return prismPrimitives(el);
    case 'plate':
      return platePrimitives(el);
    case 'medium':
      return mediumPrimitives(el);
  }
}

/** Erstellt einen Körper in Weltkoordinaten aus lokalen Primitiven und einer starren Transformation. */
export function solidFromElement(el: OpticalElement): TraceableSolid {
  const rigid = makeRigid(el.transform.position, el.transform.rotation);
  const prims = primitivesForElement(el);
  return {
    id: el.id,
    n: el.medium.n,
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
