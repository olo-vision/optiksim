/**
 * Prismen-Geometrie im lokalen Elementsystem (Licht in +Z).
 * Querschnitt: Dreieck in der Y-Z-Ebene, Basis zeigt vor der Basislage-Drehung nach −Y
 * (entspricht Basislage 270° = „Basis unten“). Extrudiert entlang X.
 */
import type { PrismParams } from '../types';
import type { Vec3 } from '@/core/math/vec';
import { prismBaseDepth } from './elementShape';

export interface Plane {
  point: Vec3;
  normal: Vec3;
  optical: boolean;
}

export interface PrismGeometryData {
  /** 6 Eckpunkte: [apex−x, base1−x, base2−x, apex+x, base1+x, base2+x] */
  vertices: Vec3[];
  planes: Plane[];
  /** Drehwinkel um Z (Radiant), abgeleitet aus der Basislage */
  rotationZ: number;
}

/**
 * Basislage θ (TABO-ähnlich, Frontansicht auf das Auge): 0° rechts, 90° oben, 180° links, 270° unten.
 * In der Frontansicht (Kamera bei −Z, Blick +Z) zeigt „rechts“ in Richtung −X.
 */
export function prismRotationZ(baseSettingDeg: number): number {
  return ((270 - baseSettingDeg) * Math.PI) / 180;
}

const rotZ = (v: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
};

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function computePrismGeometry(p: PrismParams): PrismGeometryData {
  const H = p.height;
  const W = p.width;
  const B = prismBaseDepth(H, p.apexAngle);
  const a = prismRotationZ(p.baseSetting);
  const raw: Vec3[] = [
    [-W / 2, H / 2, 0],
    [-W / 2, -H / 2, -B / 2],
    [-W / 2, -H / 2, B / 2],
    [W / 2, H / 2, 0],
    [W / 2, -H / 2, -B / 2],
    [W / 2, -H / 2, B / 2],
  ];
  const planes: Plane[] = [
    { point: [0, H / 2, 0], normal: norm([0, B / 2, -H]), optical: true }, // Eintrittsfläche
    { point: [0, H / 2, 0], normal: norm([0, B / 2, H]), optical: true }, // Austrittsfläche
    { point: [0, -H / 2, 0], normal: [0, -1, 0], optical: false }, // Basis (mattiert)
    { point: [W / 2, 0, 0], normal: [1, 0, 0], optical: false },
    { point: [-W / 2, 0, 0], normal: [-1, 0, 0], optical: false },
  ];
  return {
    vertices: raw.map((v) => rotZ(v, a)),
    planes: planes.map((pl) => ({ point: rotZ(pl.point, a), normal: rotZ(pl.normal, a), optical: pl.optical })),
    rotationZ: a,
  };
}
