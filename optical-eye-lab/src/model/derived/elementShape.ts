/**
 * Abgeleitete Geometriegrößen optischer Elemente (lokales Koordinatensystem).
 * Wird von Rendering, Messungen und Raytracing gemeinsam genutzt, damit
 * alle Module dieselbe Geometrie „sehen“.
 *
 * Lokales System: Mittelpunkt = Mitte zwischen den Scheiteln, Licht läuft in +Z.
 */
import type { LensElement, OpticalElement } from '../types';
import { checkLensShapeGeneral, type SurfaceSpec } from '@/core/math/surfaces';
import { outlineRadius } from '@/core/math/outline';

/** Flächenbeschreibungen einer Linse aus dem Datenmodell (freier Zustand). */
export function lensSurfaces(el: LensElement): { front: SurfaceSpec; back: SurfaceSpec } {
  const p = el.lens;
  const front: SurfaceSpec = p.frontRadius2 === undefined ? { R: p.frontRadius } : { R: p.frontRadius, R2: p.frontRadius2, axis: p.frontAxis ?? 180 };
  const back: SurfaceSpec = p.backRadius2 === undefined ? { R: p.backRadius } : { R: p.backRadius, R2: p.backRadius2, axis: p.backAxis ?? 180 };
  return { front, back };
}

/** Konturfunktion r(φ) in lokalen Polarkoordinaten. */
export function lensOutlineFn(el: LensElement): (phi: number) => number {
  const p = el.lens;
  return (phi) => outlineRadius(p.outline, p.diameter, p.width, p.height, phi);
}

export interface LensShape {
  frontVertexZ: number;
  backVertexZ: number;
  centerThickness: number;
  edgeThickness: number;
  semiAperture: number;
  warnings: string[];
}

const lensCache = new WeakMap<LensElement['lens'], LensShape>();

export function resolveLensShape(el: LensElement): LensShape {
  const cached = lensCache.get(el.lens);
  if (cached) return cached;
  const p = el.lens;
  const { front, back } = lensSurfaces(el);
  const isContact = !!el.contact;
  const c = checkLensShapeGeneral(front, back, p.centerThickness, lensOutlineFn(el), isContact ? 0.02 : 0.05);
  const shape: LensShape = {
    frontVertexZ: -c.centerThickness / 2,
    backVertexZ: c.centerThickness / 2,
    centerThickness: c.centerThickness,
    edgeThickness: c.edgeThickness,
    semiAperture: c.semiAperture,
    warnings: c.warnings,
  };
  lensCache.set(el.lens, shape);
  return shape;
}

/** Prismen-Querschnitt: Basisbreite entlang der Achse aus Höhe und brechendem Winkel. */
export function prismBaseDepth(height: number, apexDeg: number) {
  return 2 * height * Math.tan(((apexDeg * Math.PI) / 180) / 2);
}

/**
 * Axiale Ausdehnung eines Elements entlang seiner lokalen Z-Achse:
 * vorderer und hinterer Scheitel (auf der Elementachse).
 */
export function elementAxialExtent(el: OpticalElement): { front: number; back: number } {
  switch (el.family) {
    case 'lens': {
      const s = resolveLensShape(el);
      return { front: s.frontVertexZ, back: s.backVertexZ };
    }
    case 'prism': {
      // auf der Achse (Mitte zwischen Basis und Kante) ist das Prisma halb so dick wie an der Basis
      const d = prismBaseDepth(el.prism.height, el.prism.apexAngle) / 2;
      return { front: -d / 2, back: d / 2 };
    }
    case 'plate':
      return { front: -el.plate.thickness / 2, back: el.plate.thickness / 2 };
    case 'medium': {
      const d = el.body.shape === 'sphere' ? el.body.width : el.body.depth;
      return { front: -d / 2, back: d / 2 };
    }
  }
}

/** Charakteristischer Radius (für Kamera-Fokus, Maßlinien-Versatz). */
export function elementRadius(el: OpticalElement): number {
  switch (el.family) {
    case 'lens':
      return resolveLensShape(el).semiAperture;
    case 'prism':
      return Math.max(el.prism.height, el.prism.width) / 2;
    case 'plate':
      return Math.max(el.plate.width, el.plate.height) / 2;
    case 'medium':
      return Math.max(el.body.width, el.body.height, el.body.depth) / 2;
  }
}
