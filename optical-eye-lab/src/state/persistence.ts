/**
 * Lokale Persistenz (LocalStorage) – kein Server, keine Cloud.
 *
 *  - Gespeicherte Szenen (mehrere, benannt)
 *  - Automatische Sicherung des Arbeitsstands (Wiederherstellung nach Neuladen)
 *  - Programmeinstellungen
 *
 * Alle Dokumente laufen beim Laden durch `migrateDocument`, damit ältere
 * Speicherstände auch nach Schema-Änderungen geöffnet werden können.
 */
import { SCHEMA_VERSION, type SceneDocument } from '@/model/types';
import { createEmptyScene, createEye } from '@/model/sceneFactory';
import { applyConstraints, DEFAULT_TEAR_INDEX } from '@/model/derived/contactSeat';
import { placementOf } from '@/model/derived/measurements';
import type { OpticalElement } from '@/model/types';

/**
 * v1 → v2:
 *  - Kontaktlinsen: neue Felder mit Standardwerten; sitzt die Linse (wie in Phase 1 üblich) zentriert
 *    auf der Hornhaut, wird sie als „aufgesetzt“ markiert und der Tränenfilm aktiviert.
 *  - Auge: Ametropie-Modell 'auto'. Sphärische Hornhaut bleibt sphärisch (keine R2-Felder).
 *  - Lichtquellen: Fächermodus 'principal' (verhält sich ohne Astigmatismus wie Phase 1).
 */
export function migrateV1toV2(doc: SceneDocument): SceneDocument {
  const elements = doc.elements.map((e): OpticalElement => {
    if (e.family !== 'lens' || !e.contact) return e;
    const p = placementOf(doc.eye, e);
    const seated = Math.abs(p.vertexDistance - e.contact.tearFilmThickness) < 0.05 && p.decentration.r < 0.2 && p.tiltDeg < 0.5;
    return {
      ...e,
      contact: {
        tearFilm: true,
        nTear: DEFAULT_TEAR_INDEX,
        centration: { x: 0, y: 0 },
        tilt: { x: 0, y: 0 },
        opticZoneDiameter: e.contact.design === 'rigid' ? 7.8 : 8.0,
        peripheralCurves: [],
        eccentricity: 0,
        ...e.contact,
        onEye: e.contact.onEye ?? seated,
      },
    };
  });
  return {
    ...doc,
    schemaVersion: SCHEMA_VERSION,
    eye: { ...doc.eye, ametropiaMode: doc.eye.ametropiaMode ?? 'auto' },
    elements,
    lights: doc.lights.map((l) => ({ ...l, source: { fanMode: 'principal', intensity: 1, deviceRole: 'none', ...l.source } })),
  };
}

const KEY_SCENES = 'optical-eye-lab.scenes.v1';
const KEY_AUTOSAVE = 'optical-eye-lab.autosave.v1';
const KEY_PREFS = 'optical-eye-lab.prefs.v1';

export interface SavedSceneMeta {
  id: string;
  name: string;
  savedAt: string;
  elementCount: number;
}

interface SavedSceneRecord extends SavedSceneMeta {
  doc: SceneDocument;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Ergänzt fehlende Felder und hebt ältere Schemata an. */
export function migrateDocument(raw: unknown): SceneDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SceneDocument>;
  if (!r.eye || !Array.isArray(r.elements)) return null;
  const base = createEmptyScene(r.name ?? 'Szene');
  const eyeBase = createEye();
  const doc: SceneDocument = {
    ...base,
    ...r,
    schemaVersion: SCHEMA_VERSION,
    eye: { ...eyeBase, ...r.eye, anatomy: { ...eyeBase.anatomy, ...(r.eye.anatomy ?? {}) } },
    elements: r.elements,
    lights: Array.isArray(r.lights) ? r.lights : [],
    measurePoints: Array.isArray(r.measurePoints) ? r.measurePoints : [],
    environment: { ...base.environment, ...(r.environment ?? {}) },
    display: { ...base.display, ...(r.display ?? {}) },
  };
  if ((r.schemaVersion ?? 1) < 2) return applyConstraints(migrateV1toV2(doc));
  return applyConstraints(doc);
}

function readRecords(): SavedSceneRecord[] {
  const raw = safeGet(KEY_SCENES);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as SavedSceneRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function listSavedScenes(): SavedSceneMeta[] {
  return readRecords()
    .map(({ id, name, savedAt, elementCount }) => ({ id, name, savedAt, elementCount }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveScene(doc: SceneDocument): boolean {
  const records = readRecords();
  const now = new Date().toISOString();
  const rec: SavedSceneRecord = { id: doc.id, name: doc.name, savedAt: now, elementCount: doc.elements.length, doc: { ...doc, updatedAt: now } };
  const i = records.findIndex((r) => r.id === doc.id);
  if (i >= 0) records[i] = rec;
  else records.push(rec);
  return safeSet(KEY_SCENES, JSON.stringify(records));
}

export function loadScene(id: string): SceneDocument | null {
  const rec = readRecords().find((r) => r.id === id);
  return rec ? migrateDocument(rec.doc) : null;
}

export function deleteSavedScene(id: string): void {
  safeSet(KEY_SCENES, JSON.stringify(readRecords().filter((r) => r.id !== id)));
}

export function writeAutosave(doc: SceneDocument, baseline: SceneDocument | null): void {
  safeSet(KEY_AUTOSAVE, JSON.stringify({ doc, baseline }));
}

export function readAutosave(): { doc: SceneDocument; baseline: SceneDocument | null } | null {
  const raw = safeGet(KEY_AUTOSAVE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { doc: unknown; baseline: unknown };
    const doc = migrateDocument(parsed.doc);
    if (!doc) return null;
    return { doc, baseline: migrateDocument(parsed.baseline) };
  } catch {
    return null;
  }
}

/* ------------------------- Einstellungen ------------------------- */

export type QualityLevel = 'high' | 'balanced' | 'performance';

export interface Preferences {
  quality: QualityLevel;
  decimals: 1 | 2 | 3;
  showHoverInfo: boolean;
  gizmoSize: number;
  translationSnap: number;
  rotationSnap: number;
  /** Zylinderschreibweise in der Anzeige (Phase 2) */
  cylForm: 'minus' | 'plus';
  /** Parametersteuerung im Inspector (Phase 2) */
  paramMode: 'optical' | 'geometry';
}

export const DEFAULT_PREFS: Preferences = {
  quality: 'high',
  decimals: 2,
  showHoverInfo: true,
  gizmoSize: 0.9,
  translationSnap: 0.5,
  rotationSnap: 5,
  cylForm: 'minus',
  paramMode: 'optical',
};

export function readPrefs(): Preferences {
  const raw = safeGet(KEY_PREFS);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(p: Preferences): void {
  safeSet(KEY_PREFS, JSON.stringify(p));
}

/* --------------------------- Datei-Export ------------------------ */

export function exportSceneFile(doc: SceneDocument) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name.replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim() || 'szene'}.oel.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importSceneFile(file: File): Promise<SceneDocument | null> {
  try {
    return migrateDocument(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}
