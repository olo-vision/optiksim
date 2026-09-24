/**
 * Eingebaute Vorlagen. Sie erzeugen ihr Dokument über die Demo-Szenen (Physik-Engine),
 * eigene Vorlagen speichern ein SceneDocument.
 */
import type { SceneDocument } from '@/model/types';
import { createEmptyScene } from '@/model/sceneFactory';
import { applyConstraints } from '@/model/derived/contactSeat';
import { buildPreset } from '@/state/presets';
import { migrateDocument } from '@/state/persistence';
import { createId } from '@/core/ids';
import type { SimulationCategory, Template } from './models';
import type { UserPreferences } from './preferences';

const T0 = '2026-01-01T00:00:00.000Z';

const builtin = (id: string, presetId: string, name: string, description: string, category: SimulationCategory, tags: string[]): Template => ({
  id,
  name,
  description,
  category,
  tags,
  visibility: 'builtin',
  createdAt: T0,
  presetId,
});

export const BLANK_TEMPLATE_ID = 'blank';

export const BUILTIN_TEMPLATES: Template[] = [
  builtin('tpl-emmetropia', 'normal-eye', 'Emmetropes Auge', 'Le-Grand-Modellauge ohne Fehlsichtigkeit mit parallelem Lichtbündel.', 'refraction', ['Grundlagen']),
  builtin('tpl-myopia', 'myopia', 'Myopie', 'Achsenmyopie −3,00 dpt: Fokus vor der Netzhaut.', 'refraction', ['Fehlsichtigkeit']),
  builtin('tpl-hyperopia', 'hyperopia', 'Hyperopie', 'Achsenhyperopie +3,00 dpt: Fokus hinter der Netzhaut.', 'refraction', ['Fehlsichtigkeit']),
  builtin('tpl-astigmatism', 'astigmatism', 'Astigmatismus', 'Hornhautastigmatismus mit Sturmschem Konoid und zwei Brennlinien.', 'astigmatism', ['Fehlsichtigkeit', 'Brennlinien']),
  builtin('tpl-spectacle', 'eye-spectacle', 'Brillenkorrektion', 'Myopes Auge mit Brillenglas im HSA 12 mm – Vollkorrektion.', 'spectacles', ['Korrektion', 'HSA']),
  builtin('tpl-toric-spectacle', 'astig-correction', 'Torisches Brillenglas', 'Astigmatisches Auge mit torischem Brillenglas; Restrefraktion durch den HSA.', 'spectacles', ['Korrektion', 'Torisch']),
  builtin('tpl-soft-cl', 'eye-contact', 'Sphärische Kontaktlinse', 'Myopes Auge mit weicher sphärischer KL, Tränenfilm aktiv.', 'contact-lens', ['Kontaktlinse']),
  builtin('tpl-toric-cl', 'toric-contact', 'Torische Kontaktlinse', 'Hornhautastigmatismus mit weicher torischer KL korrigiert.', 'contact-lens', ['Kontaktlinse', 'Torisch']),
  builtin('tpl-rgp', 'rgp-tear-lens', 'Formstabile KL + Tränenlinse', 'Steilere Basiskurve erzeugt eine Plus-Tränenlinse – durch die KL-Wirkung ausgeglichen.', 'tear-lens', ['Kontaktlinse', 'Tränenlinse']),
  builtin('tpl-hsa', 'hsa-change', 'HSA-Änderung', 'Glas für HSA 12 mm im HSA 20 mm getragen → Restrefraktion.', 'demonstration', ['HSA', 'Effektivität']),
  builtin('tpl-bench', 'optical-bench', 'Freie optische Bank', 'Auge, Lichtquelle und Sammellinse auf der optischen Bank – frei experimentieren.', 'demonstration', ['Experiment']),
  builtin('tpl-kepler', 'eye-two-lenses', 'Kepler-System', 'Zwei Sammellinsen vor einem emmetropen Auge.', 'demonstration', ['Fernrohr']),
];

/** Leere Simulation mit den Standardwerten des Benutzers. */
export function createBlankDocument(name: string, prefs?: Partial<UserPreferences>): SceneDocument {
  const doc = createEmptyScene(name);
  if (prefs) {
    doc.display = {
      ...doc.display,
      showOpticalAxis: prefs.newSceneOpticalAxis ?? doc.display.showOpticalAxis,
      showDimensions: prefs.newSceneDimensions ?? doc.display.showDimensions,
    };
    doc.environment = { ...doc.environment, showBench: prefs.newSceneBench ?? doc.environment.showBench };
    doc.eye = { ...doc.eye, ametropiaMode: prefs.defaultAmetropiaMode ?? doc.eye.ametropiaMode };
  }
  return doc;
}

/** Erzeugt ein neues, eigenständiges Dokument aus einer Vorlage (neue ID, neuer Name). */
export function documentFromTemplate(t: Template, name?: string): SceneDocument {
  let doc: SceneDocument | null = null;
  if (t.presetId) doc = buildPreset(t.presetId);
  else if (t.doc) doc = migrateDocument(structuredClone(t.doc));
  if (!doc) doc = createEmptyScene(name ?? t.name);
  const now = new Date().toISOString();
  return applyConstraints({ ...doc, id: createId('scene'), name: name?.trim() || t.name, createdAt: now, updatedAt: now });
}
