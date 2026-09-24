/**
 * Leichtgewichtige, framework-unabhängige Vektor-Hilfsfunktionen.
 * Die Physik- und Raytracing-Engine nutzt bewusst KEINE Three.js-Typen,
 * damit sie später auch in Web Workern oder Tests ohne Rendering läuft.
 */

export type Vec3 = [number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** 3×3-Rotationsmatrix (zeilenweise) aus Euler-Winkeln in Grad, Reihenfolge XYZ (wie Three.js). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function eulerDegToMat3(rx: number, ry: number, rz: number): Mat3 {
  const x = (rx * Math.PI) / 180;
  const y = (ry * Math.PI) / 180;
  const z = (rz * Math.PI) / 180;
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // identisch zu THREE.Matrix4.makeRotationFromEuler (Order 'XYZ')
  return [
    c * e, -c * f, d,
    af + be * d, ae - bf * d, -b * c,
    bf - ae * d, be + af * d, a * c,
  ];
}

export const mulMat3Vec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Multiplikation mit der Transponierten (= Inverse bei Rotationsmatrizen). */
export const mulMat3TVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/** Starre Transformation (Rotation + Translation) für Welt ↔ lokal. */
export interface RigidTransform {
  position: Vec3;
  rotation: Mat3;
}

export function makeRigid(position: Vec3, rotationDeg: Vec3): RigidTransform {
  return { position, rotation: eulerDegToMat3(rotationDeg[0], rotationDeg[1], rotationDeg[2]) };
}
export const toWorldPoint = (t: RigidTransform, p: Vec3): Vec3 => add(mulMat3Vec(t.rotation, p), t.position);
export const toWorldDir = (t: RigidTransform, d: Vec3): Vec3 => mulMat3Vec(t.rotation, d);
export const toLocalPoint = (t: RigidTransform, p: Vec3): Vec3 => mulMat3TVec(t.rotation, sub(p, t.position));
export const toLocalDir = (t: RigidTransform, d: Vec3): Vec3 => mulMat3TVec(t.rotation, d);

/** Matrixprodukt A·B (3×3, zeilenweise). */
export function mulMat3(A: Mat3, B: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]);
  return r as Mat3;
}

/** Rotationsmatrix → Euler-Winkel in Grad, Reihenfolge XYZ (wie THREE.Euler.setFromRotationMatrix). */
export function mat3ToEulerDeg(m: Mat3): Vec3 {
  const R2D = 180 / Math.PI;
  const m13 = Math.max(-1, Math.min(1, m[2]));
  const y = Math.asin(m13);
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m[5], m[8]);
    z = Math.atan2(-m[1], m[0]);
  } else {
    x = Math.atan2(m[7], m[4]);
    z = 0;
  }
  return [x * R2D, y * R2D, z * R2D];
}
