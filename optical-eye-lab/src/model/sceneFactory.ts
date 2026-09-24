/**
 * Erzeugung von Szenen und Entitäten (inkl. sinnvoller Platzierung vor dem Auge).
 */
import { createId } from '@/core/ids';
import { makeRigid, toLocalPoint, toWorldPoint, type Vec3 } from '@/core/math/vec';
import { getElementDefinition } from './elementRegistry';
import { DEFAULT_EYE_ANATOMY } from './derived/eyeGeometry';
import { elementAxialExtent } from './derived/elementShape';
import { isOnEye, seatTransform } from './derived/contactSeat';
import {
  SCHEMA_VERSION,
  type ElementKind,
  type EyeEntity,
  type LensElement,
  type LightSourceEntity,
  type MeasurePointEntity,
  type OpticalElement,
  type SceneDocument,
  type Transform,
} from './types';

export const identityTransform = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Transform => ({
  position,
  rotation,
  scale: [1, 1, 1],
});

export function createEye(): EyeEntity {
  return {
    entityType: 'eye',
    id: 'eye',
    name: 'Auge (rechts)',
    visible: true,
    locked: false,
    transform: identityTransform(),
    anatomy: { ...DEFAULT_EYE_ANATOMY },
    viewMode: 'normal',
    irisColor: '#4f7a96',
    showLabels: true,
    physics: {},
  };
}

/** Umrechnung Augen-lokal (Ursprung Hornhautscheitel, +Z ins Auge) → Welt. */
export function eyeLocalToWorld(eye: EyeEntity, p: Vec3): Vec3 {
  return toWorldPoint(makeRigid(eye.transform.position, eye.transform.rotation), p);
}
export function worldToEyeLocal(eye: EyeEntity, p: Vec3): Vec3 {
  return toLocalPoint(makeRigid(eye.transform.position, eye.transform.rotation), p);
}

export function createLightSource(doc: SceneDocument, distance = 120): LightSourceEntity {
  const n = doc.lights.length + 1;
  return {
    entityType: 'light',
    id: createId('light'),
    name: `Lichtquelle ${n}`,
    visible: true,
    locked: false,
    transform: identityTransform(eyeLocalToWorld(doc.eye, [0, 0, -distance]), [...doc.eye.transform.rotation] as Vec3),
    source: { kind: 'parallel', beamDiameter: 6, rayCount: 13, wavelength: 587.6, color: '#ffd27a', sagittal: false },
  };
}

export function createMeasurePoint(doc: SceneDocument, local: Vec3 = [0, 8, -20]): MeasurePointEntity {
  const n = doc.measurePoints.length + 1;
  return {
    entityType: 'measure-point',
    id: createId('mp'),
    name: `Messpunkt ${n}`,
    visible: true,
    locked: false,
    transform: identityTransform(eyeLocalToWorld(doc.eye, local)),
    color: '#7cf3c6',
  };
}

function uniqueName(base: string, existing: string[]): string {
  let i = 1;
  while (existing.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * Erzeugt ein Element und platziert es auf der optischen Achse vor dem Auge.
 * Überschneidungen mit vorhandenen Elementen werden vermieden.
 * @param distance optionaler Abstand Hornhautscheitel → rückseitiger Scheitel [mm]
 */
export function createElement(kind: ElementKind, doc: SceneDocument, distance?: number): OpticalElement {
  const def = getElementDefinition(kind);
  const draft = def.create();
  const el = {
    ...draft,
    id: createId('el'),
    name: uniqueName(def.label, doc.elements.map((e) => e.name)),
    visible: true,
    locked: false,
    transform: identityTransform(),
  } as OpticalElement;

  const ext = elementAxialExtent(el);
  let centerZ: number;
  if (def.placeOnCornea && distance === undefined) {
    const tear = el.family === 'lens' && el.contact ? el.contact.tearFilmThickness : 0;
    centerZ = -(tear + ext.back);
  } else {
    centerZ = -(distance ?? def.defaultDistance) - ext.back;
    // Kollisionsvermeidung entlang der Achse
    const occupied = doc.elements.map((e) => {
      const c = worldToEyeLocal(doc.eye, e.transform.position)[2];
      const x = elementAxialExtent(e);
      return { min: c + x.front, max: c + x.back };
    });
    const margin = 4;
    for (let guard = 0; guard < 50; guard++) {
      const min = centerZ + ext.front;
      const max = centerZ + ext.back;
      const hit = occupied.find((o) => min < o.max + margin && max > o.min - margin);
      if (!hit) break;
      centerZ = hit.min - margin - ext.back - 16;
    }
  }
  el.transform = identityTransform(eyeLocalToWorld(doc.eye, [0, 0, centerZ]), [...doc.eye.transform.rotation] as Vec3);
  if (isOnEye(el)) {
    const t = seatTransform(el, doc.eye);
    el.transform = { ...el.transform, position: t.position, rotation: t.rotation };
  }
  return el;
}

/** Setzt ein Element (ausgerichtet am Auge) so, dass sein augenseitiger Scheitel im Abstand `distance` vor dem Hornhautscheitel liegt. */
export function placeAtVertexDistance<T extends OpticalElement>(el: T, doc: SceneDocument, distance: number): T {
  const ext = elementAxialExtent(el);
  const centerZ = -distance - ext.back;
  return {
    ...el,
    transform: identityTransform(eyeLocalToWorld(doc.eye, [0, 0, centerZ]), [...doc.eye.transform.rotation] as Vec3),
  };
}

export function createEmptyScene(name = 'Neue Szene'): SceneDocument {
  const now = new Date().toISOString();
  const doc: SceneDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: createId('scene'),
    name,
    createdAt: now,
    updatedAt: now,
    eye: createEye(),
    elements: [],
    lights: [],
    measurePoints: [],
    environment: { showRoom: true, showBench: true, showGrid: true, reflections: true, exposure: 1 },
    display: { showOpticalAxis: true, showDimensions: true, showAllDimensions: false, showRays: false },
  };
  return doc;
}

/** Tiefe Kopie mit neuen IDs (für „Duplizieren“). */
export function cloneElement(el: OpticalElement, existingNames: string[], offset: Vec3 = [0, 0, -15]): OpticalElement {
  const copy = JSON.parse(JSON.stringify(el)) as OpticalElement;
  copy.id = createId('el');
  const base = el.name.replace(/\s+\d+$/, '');
  copy.name = uniqueName(base, existingNames);
  copy.locked = false;
  copy.transform.position = [el.transform.position[0] + offset[0], el.transform.position[1] + offset[1], el.transform.position[2] + offset[2]];
  return copy;
}

/**
 * Setzt eine Kontaktlinse zentriert auf die Hornhaut (contact.onEye = true).
 * Die Lage wird danach als Constraint aus dem Auge abgeleitet (siehe contactSeat.ts).
 */
export function seatOnCornea<T extends OpticalElement>(el: T, doc: SceneDocument): T {
  if (el.family !== 'lens' || !el.contact) return el;
  const next = { ...el, contact: { ...el.contact, onEye: true, centration: { x: 0, y: 0 }, tilt: { x: 0, y: 0 } } } as LensElement;
  const t = seatTransform(next, doc.eye);
  return { ...next, transform: { ...next.transform, position: t.position, rotation: t.rotation } } as unknown as T;
}

/** Verschiebt ein Element entlang der Augenachse, sodass der augenseitige Scheitel den Abstand `distance` hat. */
export function moveToVertexDistance<T extends OpticalElement>(el: T, doc: SceneDocument, currentDistance: number, distance: number): T {
  const rigid = makeRigid(doc.eye.transform.position, doc.eye.transform.rotation);
  const axis = toWorldPoint(rigid, [0, 0, 1]);
  const origin = toWorldPoint(rigid, [0, 0, 0]);
  const dir: Vec3 = [axis[0] - origin[0], axis[1] - origin[1], axis[2] - origin[2]];
  const delta = currentDistance - distance; // > 0: näher ans Auge (in +Achse)
  const p = el.transform.position;
  return { ...el, transform: { ...el.transform, position: [p[0] + dir[0] * delta, p[1] + dir[1] * delta, p[2] + dir[2] * delta] } };
}

/** Zentriert ein Element auf der optischen Achse und richtet es parallel zum Auge aus. */
export function centerOnAxis<T extends OpticalElement>(el: T, doc: SceneDocument): T {
  const local = worldToEyeLocal(doc.eye, el.transform.position);
  return {
    ...el,
    transform: { ...el.transform, position: eyeLocalToWorld(doc.eye, [0, 0, local[2]]), rotation: [...doc.eye.transform.rotation] as Vec3 },
  };
}
