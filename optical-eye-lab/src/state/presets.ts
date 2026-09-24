/**
 * Demo-Szenen. Dienen in Phase 1 zur Demonstration der Bedienung;
 * die Werte sind dennoch optisch plausibel berechnet.
 */
import type { LensElement, SceneDocument } from '@/model/types';
import { createElement, createEmptyScene, createLightSource, placeAtVertexDistance } from '@/model/sceneFactory';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { backRadiusForBackVertexPower, frontRadiusForBackVertexPower } from '@/engine/physics/formulas';

export interface ScenePreset {
  id: string;
  name: string;
  description: string;
  build: () => SceneDocument;
}

const MYOPIC_AXIAL_LENGTH = 25.3;

function withLight(doc: SceneDocument, distance = 120, beam = 6): SceneDocument {
  const l = createLightSource(doc, distance);
  l.source.beamDiameter = beam;
  return { ...doc, lights: [...doc.lights, l] };
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'normal-eye',
    name: 'Normales Auge',
    description: 'Emmetropes Modellauge (Le Grand) mit parallelem Lichtbündel.',
    build: () => {
      let doc = createEmptyScene('Normales Auge');
      doc = withLight(doc, 80);
      doc.display.showRays = true;
      return doc;
    },
  },
  {
    id: 'eye-spectacle',
    name: 'Auge + Brillenglas',
    description: 'Kurzsichtiges Modellauge (Baulänge 25,3 mm) mit Korrektionsglas im HSA 12 mm.',
    build: () => {
      let doc = createEmptyScene('Auge + Brillenglas');
      doc.eye.anatomy.axialLength = MYOPIC_AXIAL_LENGTH;
      const refr = summarizeEye(doc.eye.anatomy).refractionAtCornea;
      const hsa = 12;
      const needed = refr / (1 + (hsa / 1000) * refr);
      const lens = createElement('spectacle-lens', doc, hsa) as LensElement;
      // flache Basiskurve für Minusglas; neue Objekte statt Mutation (Geometrie-Cache!)
      const R1 = 250;
      const t = 2;
      const R2 = Number(backRadiusForBackVertexPower(needed, lens.medium.n, R1, t).toFixed(2));
      const designed: LensElement = { ...lens, lens: { ...lens.lens, frontRadius: R1, centerThickness: t, backRadius: R2 } };
      doc.elements = [placeAtVertexDistance(designed, doc, hsa)];
      doc = withLight(doc, 90, 7);
      doc.display.showRays = true;
      return doc;
    },
  },
  {
    id: 'eye-contact',
    name: 'Auge + Kontaktlinse',
    description: 'Kurzsichtiges Modellauge mit formstabiler Kontaktlinse auf der Hornhaut.',
    build: () => {
      let doc = createEmptyScene('Auge + Kontaktlinse');
      doc.eye.anatomy.axialLength = MYOPIC_AXIAL_LENGTH;
      const refr = summarizeEye(doc.eye.anatomy).refractionAtCornea;
      const cl = createElement('rigid-contact-lens', doc) as LensElement;
      const R1 = Number(frontRadiusForBackVertexPower(refr, cl.medium.n, cl.lens.backRadius, cl.lens.centerThickness).toFixed(3));
      doc.elements = [{ ...cl, lens: { ...cl.lens, frontRadius: R1 } }];
      doc = withLight(doc, 60);
      doc.display.showRays = true;
      return doc;
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
      doc = withLight(doc, 290, 8);
      doc.lights[0].source.rayCount = 9;
      doc.display.showRays = true;
      doc.display.showAllDimensions = true;
      return doc;
    },
  },
];

export const DEFAULT_PRESET_ID = 'eye-spectacle';

export function buildPreset(id: string): SceneDocument {
  const p = SCENE_PRESETS.find((x) => x.id === id) ?? SCENE_PRESETS[0];
  return p.build();
}
