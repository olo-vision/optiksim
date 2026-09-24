/**
 * Geometrie-Builder für nicht-sphärische Elemente (Prisma, Platte, Medium).
 */
import * as THREE from 'three';
import type { MediumParams, PrismParams } from '@/model/types';
import { computePrismGeometry } from '@/model/derived/prismGeometry';

export function buildPrismGeometry(p: PrismParams): THREE.BufferGeometry {
  const { vertices: v } = computePrismGeometry(p);
  const faces: number[][] = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 1, 4, 3], // Eintrittsfläche
    [0, 3, 5, 2], // Austrittsfläche
    [1, 2, 5, 4], // Basis
  ];
  const pos: number[] = [];
  for (const f of faces) {
    const tris = f.length === 3 ? [f] : [[f[0], f[1], f[2]], [f[0], f[2], f[3]]];
    for (const t of tris) for (const i of t) pos.push(...v[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Normalen nach außen ausrichten (Schwerpunkt-Test)
  const c = new THREE.Vector3();
  v.forEach((p) => c.add(new THREE.Vector3(...p)));
  c.divideScalar(v.length);
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const N = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < P.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(P, i);
    const n = new THREE.Vector3().fromBufferAttribute(N, i);
    if (n.dot(a.clone().sub(c)) < 0) {
      // Dreieck umdrehen
      const b = new THREE.Vector3().fromBufferAttribute(P, i + 1);
      const cc = new THREE.Vector3().fromBufferAttribute(P, i + 2);
      P.setXYZ(i + 1, cc.x, cc.y, cc.z);
      P.setXYZ(i + 2, b.x, b.y, b.z);
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export function buildMediumGeometry(b: MediumParams): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (b.shape === 'box') g = new THREE.BoxGeometry(b.width, b.height, b.depth);
  else if (b.shape === 'cylinder') {
    g = new THREE.CylinderGeometry(b.width / 2, b.width / 2, b.depth, 72, 1);
    g.rotateX(Math.PI / 2);
  } else g = new THREE.SphereGeometry(b.width / 2, 64, 32);
  g.computeBoundingBox();
  return g;
}
