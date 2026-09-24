/**
 * Dateiformat für Import/Export.
 *
 *  .opticsim (JSON)  { format: 'optical-eye-lab/simulation', version: 1, exportedAt, meta, doc }
 *  Bibliothek (JSON) { format: 'optical-eye-lab/library',    version: 1, exportedAt, simulations: [{ meta, doc }] }
 *  Außerdem lesbar: reine Szenendateien aus Phase 1/2 (.oel.json = SceneDocument).
 *
 * Beim Import wird jedes Dokument durch `migrateDocument` geprüft und angehoben;
 * ungültige Dateien führen zu einer verständlichen Fehlermeldung, nie zu einem Absturz.
 */
import type { SceneDocument } from '@/model/types';
import { migrateDocument } from '@/state/persistence';
import { CATEGORY_LABELS, type SimulationCategory, type SimulationMetadata, type SimulationRecord } from './models';

export const SIMULATION_FORMAT = 'optical-eye-lab/simulation';
export const LIBRARY_FORMAT = 'optical-eye-lab/library';
export const FILE_EXTENSION = '.opticsim';
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Metadaten, die mit exportiert werden (ohne Besitzer/Organisation – die setzt der Import neu). */
export type PortableMeta = Pick<SimulationMetadata, 'name' | 'description' | 'tags' | 'category' | 'createdAt' | 'updatedAt'>;

export interface ImportedSimulation {
  meta: Partial<PortableMeta>;
  doc: SceneDocument;
}

export class ImportError extends Error {}

const portable = (m: SimulationMetadata): PortableMeta => ({
  name: m.name,
  description: m.description,
  tags: m.tags,
  category: m.category,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

export function serializeSimulation(rec: SimulationRecord): string {
  return JSON.stringify({ format: SIMULATION_FORMAT, version: 1, exportedAt: new Date().toISOString(), meta: portable(rec.meta), doc: rec.doc }, null, 2);
}

export function serializeLibrary(records: SimulationRecord[]): string {
  return JSON.stringify(
    { format: LIBRARY_FORMAT, version: 1, exportedAt: new Date().toISOString(), simulations: records.map((r) => ({ meta: portable(r.meta), doc: r.doc })) },
    null,
    2,
  );
}

function cleanMeta(raw: unknown): Partial<PortableMeta> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PortableMeta> = {};
  if (typeof r.name === 'string') out.name = r.name.slice(0, 120);
  if (typeof r.description === 'string') out.description = r.description.slice(0, 2000);
  if (Array.isArray(r.tags)) out.tags = r.tags.filter((t): t is string => typeof t === 'string').slice(0, 20);
  if (typeof r.category === 'string' && r.category in CATEGORY_LABELS) out.category = r.category as SimulationCategory;
  return out;
}

function toItem(meta: unknown, doc: unknown): ImportedSimulation | null {
  const d = migrateDocument(doc);
  if (!d) return null;
  return { meta: cleanMeta(meta), doc: d };
}

/** Liest den Text einer Import-Datei. Wirft `ImportError` mit einer Meldung für den Nutzer. */
export function parseImport(text: string): { kind: 'simulation' | 'library' | 'legacy-scene'; items: ImportedSimulation[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('Die Datei ist keine gültige JSON-Datei.');
  }
  if (!data || typeof data !== 'object') throw new ImportError('Die Datei enthält keine Simulation.');
  const o = data as Record<string, unknown>;
  if (o.format === SIMULATION_FORMAT) {
    if (typeof o.version === 'number' && o.version > 1) throw new ImportError('Die Datei stammt aus einer neueren Programmversion.');
    const it = toItem(o.meta, o.doc);
    if (!it) throw new ImportError('Die Simulation in der Datei ist beschädigt oder unvollständig.');
    return { kind: 'simulation', items: [it], skipped: 0 };
  }
  if (o.format === LIBRARY_FORMAT) {
    if (typeof o.version === 'number' && o.version > 1) throw new ImportError('Die Datei stammt aus einer neueren Programmversion.');
    const list = Array.isArray(o.simulations) ? o.simulations : [];
    const items: ImportedSimulation[] = [];
    let skipped = 0;
    for (const s of list) {
      const it = s && typeof s === 'object' ? toItem((s as Record<string, unknown>).meta, (s as Record<string, unknown>).doc) : null;
      if (it) items.push(it);
      else skipped++;
    }
    if (!items.length) throw new ImportError('Die Bibliotheksdatei enthält keine lesbaren Simulationen.');
    return { kind: 'library', items, skipped };
  }
  // Phase-1/2-Szenendatei (.oel.json)
  const it = toItem({ name: o.name }, o);
  if (it) return { kind: 'legacy-scene', items: [it], skipped: 0 };
  throw new ImportError('Unbekanntes Dateiformat – erwartet wird eine .opticsim- oder .oel.json-Datei.');
}

export async function readImportFile(file: File) {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('Die Datei ist zu groß (max. 20 MB).');
  return parseImport(await file.text());
}

export function safeFileName(name: string, fallback = 'simulation') {
  return name.replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || fallback;
}

export function downloadText(text: string, fileName: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
