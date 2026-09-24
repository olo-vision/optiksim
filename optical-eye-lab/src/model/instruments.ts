/**
 * Untersuchungsgeräte und Messgläser (Phase 4).
 *
 * Geräte sind normale Szenenobjekte (Transform, Szenenbaum, Gizmo, Speichern):
 *   - Skiaskop = Lichtquelle mit deviceRole 'retinoscope' und RetinoscopeParams
 *   - Messglas  = Brillenglas mit role 'trial' (Phoropter-/Messbrillenglas im HSA)
 * Registry der Instrumente mit fachlich ehrlichem Status (aktiv / Messwerkzeug / in Entwicklung).
 */
import type { LensElement, LightSourceEntity, SceneDocument, Vec3 } from './types';
import { createElement, createLightSource, eyeLocalToWorld, placeAtVertexDistance } from './sceneFactory';
import { placementOf } from './derived/measurements';
import { designLensForRx } from '@/engine/physics/lensOptics';
import { lensOptics } from '@/engine/physics/lensOptics';
import { DEFAULT_RETINOSCOPE } from '@/engine/optics/retinoscopy';
import type { Rx } from '@/core/math/powerMatrix';

export type InstrumentStatus = 'active' | 'tool' | 'planned';

export interface InstrumentInfo {
  id: string;
  title: string;
  status: InstrumentStatus;
  description: string;
  /** Wo es in der Anwendung zu finden ist */
  where?: string;
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'retinoscope', title: 'Strichskiaskop', status: 'active', description: 'Objektive Refraktion über Reflexbewegung; Plan-/Konkavspiegel, Strichlage, Schwenk.', where: 'Arbeitsbereich Skiaskopie' },
  { id: 'phoropter', title: 'Messbrille / Phoropter', status: 'active', description: 'Messglas Sph/Cyl/Achse im HSA, Nebeln, Kreuzzylinder, Lochblende, Rot-Grün-Test.', where: 'Arbeitsbereich Refraktion' },
  { id: 'autorefractor', title: 'Autorefraktometer', status: 'tool', description: 'Objektiver Messwert (idealisiert): Refraktion des Modellauges in der Brillenglasebene.', where: 'Refraktion → Ausgangswerte' },
  { id: 'keratometer', title: 'Keratometer', status: 'tool', description: 'Hornhautradien und Brechwerte (keratometrischer Index 1,3375) in den Hauptschnitten.', where: 'Inspector → Werkzeuge (Auge)' },
  { id: 'lensmeter', title: 'Scheitelbrechwertmesser', status: 'tool', description: 'Scheitelbrechwert (Sph/Cyl/A) und prismatische Wirkung eines ausgewählten Glases.', where: 'Inspector → Werkzeuge (Glas)' },
  { id: 'slit-lamp', title: 'Spaltlampe (Kobaltblau)', status: 'active', description: 'Fluoreszeinbild formstabiler Kontaktlinsen mit Kobaltblau-Beleuchtung und Gelbfilter.', where: 'Arbeitsbereich Kontaktlinse' },
  { id: 'ophthalmoscope', title: 'Ophthalmoskop', status: 'planned', description: 'Direkte Ophthalmoskopie – Fundusdarstellung erfordert ein Netzhautmodell (geplant).' },
  { id: 'slit-beam', title: 'Spaltlampe (Spaltbeleuchtung)', status: 'planned', description: 'Optischer Schnitt, Beleuchtungsarten – geplant.' },
];

/* ------------------------------ Skiaskop ------------------------------ */

export function createRetinoscope(doc: SceneDocument, workingDistance = 667): LightSourceEntity {
  const base = createLightSource(doc, workingDistance);
  const n = doc.lights.filter((l) => l.source.deviceRole === 'retinoscope').length + 1;
  return {
    ...base,
    name: n === 1 ? 'Skiaskop' : `Skiaskop ${n}`,
    source: { ...base.source, kind: 'line', beamDiameter: 4, rayCount: 7, color: '#ffb36b', deviceRole: 'retinoscope', intensity: 1, lineLength: 12 },
    retinoscope: { ...DEFAULT_RETINOSCOPE },
  };
}

/** Skiaskop auf der Augenachse in neuen Arbeitsabstand setzen (Ausrichtung bleibt zum Auge). */
export function placeRetinoscope(doc: SceneDocument, scope: LightSourceEntity, workingDistance: number, lateral: [number, number] = [0, 0]): LightSourceEntity {
  const pos: Vec3 = eyeLocalToWorld(doc.eye, [lateral[0], lateral[1], -workingDistance]);
  return { ...scope, transform: { ...scope.transform, position: pos, rotation: [...doc.eye.transform.rotation] as Vec3 } };
}

/* ------------------------------ Messglas ------------------------------ */

export const TRIAL_VERTEX_DISTANCE = 12;

/** Messglas mit gegebenem Rezept im HSA anlegen. */
export function createTrialLens(doc: SceneDocument, rx: Rx, vertexDistance = TRIAL_VERTEX_DISTANCE): LensElement {
  let el = createElement('spectacle-lens', { ...doc, elements: [] }) as LensElement;
  el = {
    ...el,
    name: 'Messglas',
    role: 'trial',
    lens: { ...el.lens, outline: 'round', diameter: 38, frontRadius: 120, centerThickness: 2.5 },
    appearance: { ...el.appearance, tint: '#dff3ff', transparency: 0.94 },
  };
  el = { ...el, lens: designLensForRx(el, rx).lens };
  return placeAtVertexDistance(el, doc, vertexDistance);
}

/** Rezept eines Messglases setzen; HSA und Verdrehung bleiben erhalten. */
export function setTrialRx(doc: SceneDocument, el: LensElement, rx: Rx): LensElement {
  const hsa = placementOf(doc.eye, el).vertexDistance;
  // Vorderfläche passend zur Wirkung wählen (Plus: steiler, Minus: flacher), damit das Glas darstellbar bleibt
  const se = rx.sph + rx.cyl / 2;
  const front = se > 4 ? 60 : se > 0 ? 90 : se > -4 ? 160 : 400;
  const lens = { ...el.lens, frontRadius: front, frontRadius2: undefined, frontAxis: undefined, centerThickness: se > 0 ? 2.5 + se * 0.35 : 1.8 };
  const designed = { ...el, lens: designLensForRx({ ...el, lens }, rx).lens };
  const placed = placeAtVertexDistance(designed, doc, hsa);
  return { ...designed, transform: placed.transform };
}

/** Rezept eines Glases (Scheitelbrechwert) */
export const trialRxOf = (el: LensElement, doc: SceneDocument) => lensOptics(el, doc.eye).rx;
