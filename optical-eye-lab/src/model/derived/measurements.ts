/**
 * Messungen relativ zum Auge und zur optischen Achse.
 * Bezugssystem: Augen-lokal (Ursprung Hornhautscheitel, +Z ins Auge).
 * Abstände vor dem Auge werden als positive Werte ausgegeben.
 */
import type { EyeEntity, OpticalElement, SceneDocument } from '../types';
import { elementAxialExtent } from './elementShape';
import { eulerDegToMat3, makeRigid, mulMat3Vec, toLocalDir, toLocalPoint, type Vec3 } from '@/core/math/vec';

export interface ElementPlacement {
  id: string;
  name: string;
  element: OpticalElement;
  /** Mittelpunkt in Augenkoordinaten */
  centerLocal: Vec3;
  /** Scheitel in Augenkoordinaten (entlang der Elementachse) */
  frontVertexLocal: Vec3;
  backVertexLocal: Vec3;
  /** Abstand Hornhautscheitel → augenseitiger Scheitel entlang der Achse (HSA bei Brillengläsern) */
  vertexDistance: number;
  /** Euklidischer Abstand Hornhautscheitel → augenseitiger Scheitel */
  directDistance: number;
  /** Dezentration: seitlicher Abstand des Mittelpunkts von der optischen Achse */
  decentration: { x: number; y: number; r: number };
  /** Neigung der Elementachse gegen die optische Achse [°] */
  tiltDeg: number;
}

export interface AxialGap {
  fromId: string | 'eye';
  toId: string;
  fromName: string;
  toName: string;
  /** Luftabstand zwischen einander zugewandten Scheiteln (axial) */
  gap: number;
}

export interface MeasurementReport {
  placements: ElementPlacement[];
  /** sortiert vom Auge nach außen */
  chain: AxialGap[];
}

export function placementOf(eye: EyeEntity, el: OpticalElement): ElementPlacement {
  const rigid = makeRigid(eye.transform.position, eye.transform.rotation);
  const c = toLocalPoint(rigid, el.transform.position);
  const rot = eulerDegToMat3(...el.transform.rotation);
  const axisWorld = mulMat3Vec(rot, [0, 0, 1]);
  const axis = toLocalDir(rigid, axisWorld);
  const ext = elementAxialExtent(el);
  const front: Vec3 = [c[0] + axis[0] * ext.front, c[1] + axis[1] * ext.front, c[2] + axis[2] * ext.front];
  const back: Vec3 = [c[0] + axis[0] * ext.back, c[1] + axis[1] * ext.back, c[2] + axis[2] * ext.back];
  // augenseitiger Scheitel = der näher am Hornhautscheitel liegende (größeres z)
  const eyeSide = back[2] >= front[2] ? back : front;
  const tilt = (Math.acos(Math.max(-1, Math.min(1, Math.abs(axis[2])))) * 180) / Math.PI;
  return {
    id: el.id,
    name: el.name,
    element: el,
    centerLocal: c,
    frontVertexLocal: back[2] >= front[2] ? front : back,
    backVertexLocal: eyeSide,
    vertexDistance: -eyeSide[2],
    directDistance: Math.hypot(eyeSide[0], eyeSide[1], eyeSide[2]),
    decentration: { x: c[0], y: c[1], r: Math.hypot(c[0], c[1]) },
    tiltDeg: tilt,
  };
}

export function computeMeasurements(doc: SceneDocument): MeasurementReport {
  const placements = doc.elements.filter((e) => e.visible).map((e) => placementOf(doc.eye, e));
  // nur Elemente vor dem Auge (oder auf der Hornhaut) in die Maßkette
  const sorted = [...placements].sort((a, b) => b.backVertexLocal[2] - a.backVertexLocal[2]);
  const chain: AxialGap[] = [];
  let prev: { id: string | 'eye'; name: string; frontZ: number } = { id: 'eye', name: 'Hornhautscheitel', frontZ: 0 };
  for (const p of sorted) {
    chain.push({ fromId: prev.id, toId: p.id, fromName: prev.name, toName: p.name, gap: prev.frontZ - p.backVertexLocal[2] });
    prev = { id: p.id, name: p.name, frontZ: p.frontVertexLocal[2] };
  }
  return { placements, chain };
}

/** Abstand zweier Elemente (Mittelpunkte, euklidisch und axial). */
export function distanceBetween(a: ElementPlacement, b: ElementPlacement) {
  const d: Vec3 = [b.centerLocal[0] - a.centerLocal[0], b.centerLocal[1] - a.centerLocal[1], b.centerLocal[2] - a.centerLocal[2]];
  return { direct: Math.hypot(d[0], d[1], d[2]), axial: Math.abs(d[2]) };
}
