/**
 * Kurzbeschreibung einer Simulation für Bibliothekskarten – rein aus dem SceneDocument
 * abgeleitet (Physik unverändert, keine separat gespeicherten optischen Werte).
 */
import type { SceneDocument } from '@/model/types';
import { getElementDefinition } from '@/model/elementRegistry';
import { isOnEye } from '@/model/derived/contactSeat';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { computeCorrection } from '@/engine/physics/correction';
import { formatRx } from '@/engine/physics/explain';
import type { SimulationCategory, SimulationSummary } from './models';

export function summarizeDocument(doc: SceneDocument): SimulationSummary {
  const highlights: string[] = [];
  let eyeRx = '–';
  try {
    const st = eyeRefractionState(doc.eye.anatomy);
    eyeRx = Math.abs(st.rx.sph) < 0.005 && !st.astigmatic ? 'Emmetrop' : formatRx(st.rx).replace(/\s+/g, ' ');
    if (st.astigmatic) highlights.push('Astigmatismus');
  } catch {
    /* ungültige Anatomie → keine Kurzinfo */
  }
  const kinds = [...new Set(doc.elements.map((e) => e.kind))];
  const elementKinds = kinds.map((k) => {
    try {
      return getElementDefinition(k).label;
    } catch {
      return k;
    }
  });
  if (doc.elements.some((e) => e.family === 'lens' && isOnEye(e) && (e.contact?.tearFilm ?? true))) highlights.push('Tränenlinse');
  if (doc.elements.some((e) => e.family === 'lens' && (e.lens.frontRadius2 !== undefined || e.lens.backRadius2 !== undefined))) highlights.push('Torisch');
  if (doc.lights.length) highlights.push('Strahlengang');
  try {
    const corr = computeCorrection(doc);
    if (corr.hasCorrection) {
      const r = corr.residualRx;
      highlights.push(Math.abs(r.sph) < 0.13 && Math.abs(r.cyl) < 0.13 ? 'Vollkorrektion' : 'Restrefraktion');
    }
  } catch {
    /* ignorieren */
  }
  return { eyeRx, elementCount: doc.elements.length, elementKinds, highlights, modelName: 'Le-Grand-Modellauge' };
}

/** Kategorievorschlag für eine Simulation ohne gewählte Kategorie (z. B. übernommene Altszenen). */
export function guessCategory(doc: SceneDocument): SimulationCategory {
  const cl = doc.elements.filter((e) => e.family === 'lens' && e.contact);
  if (cl.some((e) => e.family === 'lens' && e.contact?.design === 'rigid' && isOnEye(e))) return 'tear-lens';
  if (cl.length) return 'contact-lens';
  if (doc.elements.some((e) => e.kind === 'spectacle-lens')) return 'spectacles';
  const a = doc.eye.anatomy;
  if (a.corneaFrontRadius2 !== undefined && Math.abs(a.corneaFrontRadius2 - a.corneaFrontRadius) > 1e-4) return 'astigmatism';
  if (doc.elements.length === 0) return 'refraction';
  return 'other';
}
