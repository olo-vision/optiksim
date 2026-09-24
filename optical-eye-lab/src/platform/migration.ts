/**
 * Datenmigration Phase 1/2 (v2, Schlüssel „optical-eye-lab.*“) → Phase 3 (v3, Schlüssel „oel:v3:*“).
 *
 *  - Gespeicherte Szenen  → Bibliothekseinträge (Besitzer „legacy“ = für alle Konten sichtbar, Tag „Übernommen“)
 *  - Auto-Sicherung       → „Wiederhergestellter Arbeitsstand“, falls sie sich von allen gespeicherten Szenen unterscheidet
 *  - Einstellungen        → Ausgangswerte für neue Benutzerkonten
 * Die alten Schlüssel werden NICHT gelöscht (Rückfallebene); die Migration läuft genau einmal.
 */
import type { SceneDocument } from '@/model/types';
import { SCHEMA_VERSION } from '@/model/types';
import { migrateDocument, type Preferences } from '@/state/persistence';
import { createId } from '@/core/ids';
import type { Repositories } from './repositories';
import type { SimulationMetadata } from './models';
import { guessCategory, summarizeDocument } from './summary';
import { hasRawAccess, KEYS } from './storage';

export const LEGACY_KEYS = {
  scenes: 'optical-eye-lab.scenes.v1',
  autosave: 'optical-eye-lab.autosave.v1',
  prefs: 'optical-eye-lab.prefs.v1',
} as const;

export const LEGACY_DEFAULT_PREFS_KEY = `${KEYS.meta}:legacy-prefs`;

export interface MigrationReport {
  migratedScenes: number;
  recoveredAutosave: boolean;
  prefsTaken: boolean;
  errors: number;
}

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Inhaltlicher Vergleich (ohne Zeitstempel). */
const fingerprint = (d: SceneDocument) => JSON.stringify({ ...d, updatedAt: '', createdAt: '' });

export async function migrateLegacyData(repos: Repositories): Promise<MigrationReport> {
  const report: MigrationReport = { migratedScenes: 0, recoveredAutosave: false, prefsTaken: false, errors: 0 };
  const storage = repos.storage;
  if (!hasRawAccess(storage)) return report;

  const now = new Date().toISOString();
  const seen = new Set<string>();

  const add = async (doc: SceneDocument, name: string, extraTags: string[], createdAt?: string, updatedAt?: string) => {
    const meta: SimulationMetadata = {
      id: createId('sim'),
      name,
      description: '',
      ownerId: 'legacy',
      createdAt: createdAt ?? doc.createdAt ?? now,
      updatedAt: updatedAt ?? doc.updatedAt ?? now,
      tags: ['Übernommen', ...extraTags],
      category: guessCategory(doc),
      favorite: false,
      archived: false,
      summary: summarizeDocument(doc),
      hasThumbnail: false,
      schemaVersion: SCHEMA_VERSION,
    };
    await repos.saveSim(meta, { ...doc, name });
  };

  // 1. Gespeicherte Szenen
  const scenes = parse(storage.readRaw(LEGACY_KEYS.scenes));
  if (Array.isArray(scenes)) {
    for (const rec of scenes) {
      try {
        const r = rec as { name?: string; savedAt?: string; doc?: unknown };
        const doc = migrateDocument(r.doc);
        if (!doc) {
          report.errors++;
          continue;
        }
        seen.add(fingerprint(doc));
        await add(doc, (r.name || doc.name || 'Übernommene Szene').slice(0, 120), [], doc.createdAt, r.savedAt);
        report.migratedScenes++;
      } catch {
        report.errors++;
      }
    }
  }

  // 2. Automatische Sicherung (letzter Arbeitsstand)
  const auto = parse(storage.readRaw(LEGACY_KEYS.autosave)) as { doc?: unknown } | null;
  if (auto?.doc) {
    const doc = migrateDocument(auto.doc);
    if (doc && !seen.has(fingerprint(doc))) {
      await add(doc, `Wiederhergestellter Arbeitsstand – ${doc.name}`.slice(0, 120), ['Wiederhergestellt']);
      report.recoveredAutosave = true;
    }
  }

  // 3. Einstellungen als Vorgabe für neue Konten
  const prefs = parse(storage.readRaw(LEGACY_KEYS.prefs)) as Partial<Preferences> | null;
  if (prefs && typeof prefs === 'object') {
    await storage.set(LEGACY_DEFAULT_PREFS_KEY, prefs);
    report.prefsTaken = true;
  }
  return report;
}

export const hasLegacyData = (repos: Repositories) =>
  hasRawAccess(repos.storage) && Object.values(LEGACY_KEYS).some((k) => (repos.storage as unknown as { readRaw(k: string): string | null }).readRaw(k) != null);
