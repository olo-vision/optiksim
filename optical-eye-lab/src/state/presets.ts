/**
 * Demo-Szenen. Alle optischen Werte werden über die Physik-Engine erzeugt
 * (Ametropie-Löser, Linsendesign aus Rezept) – keine handgesetzten Radien.
 */
import type { LensElement, SceneDocument } from '@/model/types';
import { createElement, createEmptyScene, createLightSource, placeAtVertexDistance } from '@/model/sceneFactory';
import { applyConstraints, tearThicknessForBearing } from '@/model/derived/contactSeat';
import { solveEyeForRefraction } from '@/engine/physics/eyeRefraction';
import { designLensForRx } from '@/engine/physics/lensOptics';
import { computeCorrection } from '@/engine/physics/correction';
import { effectivityMatrix, matrixToRx, rxToMatrix, type Rx } from '@/core/math/powerMatrix';

export interface ScenePreset {
  id: string;
  name: string;
  description: string;
  build: () => SceneDocument;
}

const sph = (s: number): Rx => ({ sph: s, cyl: 0, axis: 180 });

function withLight(doc: SceneDocument, distance = 120, beam = 6, rays = 13): SceneDocument {
  const l = createLightSource(doc, distance);
  l.source.beamDiameter = beam;
  l.source.rayCount = rays;
  return { ...doc, lights: [...doc.lights, l] };
}

function eyeScene(name: string, rx: Rx, mode: 'auto' | 'axial' | 'refractive' = 'auto'): SceneDocument {
  const doc = createEmptyScene(name);
  doc.eye = { ...doc.eye, ametropiaMode: mode, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, mode).anatomy };
  doc.display.showRays = true;
  return doc;
}

/** Brillenglas-Rezept, das eine Refraktion A (am Hornhautscheitel) im Abstand d voll korrigiert: F = A·(I + dA)⁻¹ */
function spectacleRxFor(A: Rx, hsaMm: number): Rx {
  return matrixToRx(effectivityMatrix(rxToMatrix(A), -hsaMm), 'minus', A.axis);
}

function spectacle(doc: SceneDocument, rx: Rx, hsa: number, frontRadius?: number): LensElement {
  let el = createElement('spectacle-lens', { ...doc, elements: [] }) as LensElement;
  if (frontRadius) el = { ...el, lens: { ...el.lens, frontRadius, centerThickness: 2 } };
  el = { ...el, lens: designLensForRx(el, rx).lens };
  return placeAtVertexDistance(el, doc, hsa);
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'normal-eye',
    name: 'Emmetropes Auge',
    description: 'Le-Grand-Modellauge ohne Fehlsichtigkeit, paralleles Lichtbündel.',
    build: () => withLight(eyeScene('Emmetropes Auge', sph(0)), 80),
  },
  {
    id: 'myopia',
    name: 'Myopie −3,00 dpt',
    description: 'Achsenmyopie: Auge verlängert, Fokus vor der Retina.',
    build: () => withLight(eyeScene('Myopie −3,00 dpt', sph(-3), 'axial'), 80),
  },
  {
    id: 'hyperopia',
    name: 'Hyperopie +3,00 dpt',
    description: 'Achsenhyperopie: Auge verkürzt, Fokus hinter der Retina.',
    build: () => withLight(eyeScene('Hyperopie +3,00 dpt', sph(3), 'axial'), 80),
  },
  {
    id: 'astigmatism',
    name: 'Astigmatismus −3,00 / −1,75 A 134°',
    description: 'Achsenmyopie mit Hornhautastigmatismus – zwei Brennlinien (Sturmsches Konoid).',
    build: () => {
      const doc = eyeScene('Astigmatismus −3,00 / −1,75 A 134°', { sph: -3, cyl: -1.75, axis: 134 }, 'auto');
      doc.eye.viewMode = 'section';
      return withLight(doc, 80, 5, 11);
    },
  },
  {
    id: 'eye-spectacle',
    name: 'Myopie + Brillenkorrektion',
    description: 'Auge −3,00 dpt (Hornhautscheitel); Glas im HSA 12 mm mit umgerechneter Wirkung −3,11 dpt → Vollkorrektion.',
    build: () => {
      let doc = eyeScene('Myopie + Brillenkorrektion', sph(-3), 'axial');
      doc = { ...doc, elements: [spectacle(doc, spectacleRxFor(sph(-3), 12), 12, 250)] };
      return withLight(doc, 90, 7);
    },
  },
  {
    id: 'eye-contact',
    name: 'Myopie + Kontaktlinse',
    description: 'Auge −3,00 dpt mit weicher Kontaktlinse −3,00 dpt (angeschmiegt, Tränenfilm aktiv).',
    build: () => {
      let doc = eyeScene('Myopie + Kontaktlinse', sph(-3), 'axial');
      let cl = createElement('soft-contact-lens', doc) as LensElement;
      cl = { ...cl, lens: designLensForRx(cl, sph(-3)).lens };
      doc = applyConstraints({ ...doc, elements: [cl] });
      return withLight(doc, 60);
    },
  },
  {
    id: 'rgp-tear-lens',
    name: 'Formstabile KL mit Tränenlinse',
    description: 'Basiskurve 0,10 mm steiler als die Hornhaut → Plus-Tränenlinse (≈ +0,5 dpt), durch eine entsprechend stärkere Minus-KL ausgeglichen.',
    build: () => {
      let doc = eyeScene('Formstabile KL mit Tränenlinse', sph(-3), 'axial');
      let cl = createElement('rigid-contact-lens', doc) as LensElement;
      cl = { ...cl, lens: { ...cl.lens, backRadius: 7.7 } };
      cl = { ...cl, lens: designLensForRx(cl, sph(-3.5)).lens };
      cl = { ...cl, contact: { ...cl.contact!, tearFilmThickness: Number(tearThicknessForBearing(cl, doc.eye).toFixed(3)) } };
      // KL-Wirkung so nachführen, dass KL + Tränenlinse die Refraktion exakt ausgleichen
      let power = -3.5;
      for (let i = 0; i < 3; i++) {
        const res = computeCorrection(applyConstraints({ ...doc, elements: [cl] })).residualRx.sph;
        power += res;
        cl = { ...cl, lens: designLensForRx(cl, sph(power)).lens };
      }
      doc = applyConstraints({ ...doc, elements: [cl] });
      doc.eye.viewMode = 'section';
      return withLight(doc, 60, 5);
    },
  },
  {
    id: 'hsa-change',
    name: 'Brillenglas mit geändertem HSA',
    description: 'Auge −8,00 dpt, Glas für HSA 12 mm berechnet, aber im HSA 20 mm getragen → Restrefraktion.',
    build: () => {
      let doc = eyeScene('Brillenglas mit geändertem HSA', sph(-8), 'axial');
      doc = { ...doc, elements: [spectacle(doc, spectacleRxFor(sph(-8), 12), 20, 400)] };
      doc.display.showAllDimensions = true;
      return withLight(doc, 100, 7);
    },
  },
  {
    id: 'astig-correction',
    name: 'Astigmatismus + torisches Brillenglas',
    description: 'Auge −3,00 / −1,75 A 134°, Glas −3,00 / −1,75 A 134° im HSA 12 mm – Restrefraktion durch den HSA sichtbar.',
    build: () => {
      let doc = eyeScene('Astigmatismus + torisches Brillenglas', { sph: -3, cyl: -1.75, axis: 134 }, 'auto');
      doc = { ...doc, elements: [spectacle(doc, { sph: -3, cyl: -1.75, axis: 134 }, 12, 250)] };
      return withLight(doc, 90, 6, 11);
    },
  },
  {
    id: 'eye-two-lenses',
    name: 'Auge + zwei Linsen',
    description: 'Kepler-System aus zwei Sammellinsen (f′ ≈ 100 mm) vor einem emmetropen Auge.',
    build: () => {
      let doc = createEmptyScene('Auge + zwei Linsen');
      const l2 = createElement('converging-lens', doc, 40);
      doc.elements = [l2];
      const l1 = createElement('converging-lens', doc, 40 + 5 + 196);
      doc.elements = [l2, l1];
      doc = withLight(doc, 290, 8, 9);
      doc.display.showRays = true;
      doc.display.showAllDimensions = true;
      return doc;
    },
  },
];

export const DEFAULT_PRESET_ID = 'astig-correction';

export function buildPreset(id: string): SceneDocument {
  const p = SCENE_PRESETS.find((x) => x.id === id) ?? SCENE_PRESETS[0];
  return applyConstraints(p.build());
}
