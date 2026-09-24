/**
 * Analytische Linsengeometrie.
 * Vorder- und Rückfläche sind exakte Kugelflächen (bzw. plan) auf einem polaren Gitter,
 * die Kontur (rund, oval, rechteckig) wird über r(φ) beschrieben.
 * Normalen werden analytisch berechnet → saubere Reflexe, harte Kanten am Rand.
 *
 * Lokales System: Licht in +Z, Vorderscheitel bei −t/2, Rückscheitel bei +t/2.
 */
import * as THREE from 'three';
import { sagGradXY, sagXY, type SurfaceSpec } from '@/core/math/surfaces';

export interface LensGeometryInput {
  R1: number;
  R2: number;
  /** Optionale (torische) Flächenbeschreibungen; überschreiben R1/R2 */
  frontSpec?: SurfaceSpec;
  backSpec?: SurfaceSpec;
  /** effektive Mittendicke */
  thickness: number;
  /** Konturfunktion r(φ) */
  outline: (phi: number) => number;
  radialSegments?: number;
  angularSegments?: number;
  /** z-Versatz (z. B. Scheitel bei z = 0 statt Mitte) */
  zOffset?: number;
}

/** Außennormale: vorn (outward −1) zeigt nach −z, hinten (+1) nach +z. */
function surfaceNormal(spec: SurfaceSpec, x: number, y: number, outward: 1 | -1): [number, number, number] {
  const [gx, gy] = sagGradXY(spec, x, y);
  return outward === -1 ? [gx, gy, -1] : [-gx, -gy, 1];
}

export function buildLensGeometry(input: LensGeometryInput): THREE.BufferGeometry {
  const { thickness, outline } = input;
  const front: SurfaceSpec = input.frontSpec ?? { R: input.R1 };
  const back: SurfaceSpec = input.backSpec ?? { R: input.R2 };
  const NR = input.radialSegments ?? 20;
  const NA = input.angularSegments ?? 96;
  const zo = input.zOffset ?? 0;
  const zf = -thickness / 2;
  const zb = thickness / 2;

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const rMax = Array.from({ length: NA }, (_, j) => outline((j / NA) * Math.PI * 2));
  const hRef = Math.max(...rMax);

  const pushV = (x: number, y: number, z: number, n: [number, number, number]) => {
    pos.push(x, y, z + zo);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    nrm.push(n[0] / l, n[1] / l, n[2] / l);
    uv.push(x / (2 * hRef) + 0.5, y / (2 * hRef) + 0.5);
    return pos.length / 3 - 1;
  };

  // --- Flächen (vorn: outward −1, hinten: outward +1) ---
  const buildSurface = (spec: SurfaceSpec, vz: number, outward: 1 | -1) => {
    const center = pushV(0, 0, vz, outward === -1 ? [0, 0, -1] : [0, 0, 1]);
    const ring: number[][] = [];
    for (let i = 1; i <= NR; i++) {
      const s = i / NR;
      const row: number[] = [];
      for (let j = 0; j < NA; j++) {
        const phi = (j / NA) * Math.PI * 2;
        const r = s * rMax[j];
        const x = r * Math.cos(phi);
        const y = r * Math.sin(phi);
        const z = vz + sagXY(spec, x, y);
        row.push(pushV(x, y, z, surfaceNormal(spec, x, y, outward)));
      }
      ring.push(row);
    }
    const tri = (a: number, b: number, c: number) => (outward === -1 ? idx.push(a, c, b) : idx.push(a, b, c));
    for (let j = 0; j < NA; j++) tri(center, ring[0][j], ring[0][(j + 1) % NA]);
    for (let i = 0; i < NR - 1; i++) {
      for (let j = 0; j < NA; j++) {
        const a = ring[i][j], b = ring[i + 1][j], c = ring[i + 1][(j + 1) % NA], d = ring[i][(j + 1) % NA];
        tri(a, b, c);
        tri(a, c, d);
      }
    }
    return ring[NR - 1];
  };

  const frontEdge = buildSurface(front, zf, -1);
  const backEdge = buildSurface(back, zb, 1);

  // --- Rand ---
  const rimF: number[] = [];
  const rimB: number[] = [];
  for (let j = 0; j < NA; j++) {
    const phi = (j / NA) * Math.PI * 2;
    const dphi = 1e-3;
    const r = rMax[j];
    const r1 = outline(phi + dphi);
    const r0 = outline(phi - dphi);
    const dr = (r1 - r0) / (2 * dphi);
    const tx = dr * Math.cos(phi) - r * Math.sin(phi);
    const ty = dr * Math.sin(phi) + r * Math.cos(phi);
    const n: [number, number, number] = [ty, -tx, 0];
    const fi = frontEdge[j] * 3;
    const bi = backEdge[j] * 3;
    rimF.push(pushV(pos[fi], pos[fi + 1], pos[fi + 2] - zo, n));
    rimB.push(pushV(pos[bi], pos[bi + 1], pos[bi + 2] - zo, n));
  }
  for (let j = 0; j < NA; j++) {
    const k = (j + 1) % NA;
    idx.push(rimF[j], rimF[k], rimB[j]);
    idx.push(rimB[j], rimF[k], rimB[k]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Ellipsen-/Profil-Rotationskörper um die Z-Achse (Lathe um Y, danach Y→Z gedreht). */
export function buildLatheZ(profile: Array<{ h: number; z: number }>, segments = 96): THREE.BufferGeometry {
  const pts = profile.map((p) => new THREE.Vector2(Math.max(0, p.h), p.z));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
