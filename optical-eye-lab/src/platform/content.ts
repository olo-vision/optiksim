/**
 * Inhaltsspeicher (0.10.0): Simulationen und eigene Vorlagen.
 *
 * Zwei Umsetzungen derselben Schnittstelle:
 *   - Repositories        – lokal im Browser (Modus ohne Konto, Tests)
 *   - CloudContentStore   – im Supabase-Konto (SaaS-Modus, src/app/cloudContent.ts)
 * Die Bibliothek (LibraryService) kennt nur diese Schnittstelle.
 * Entwürfe (Absturzsicherung) bleiben immer lokal auf dem Gerät.
 */
import type { SceneDocument } from '@/model/types';
import type { SimulationMetadata, SimulationRecord, Template } from './models';

export interface CommitOptions {
  /** Neueren Stand eines anderen Geräts bewusst überschreiben */
  force?: boolean;
}

export interface ContentRepository {
  readonly contentKind: 'local' | 'cloud';
  listSimMeta(): Promise<SimulationMetadata[]>;
  getSimMeta(id: string): Promise<SimulationMetadata | null>;
  getSim(id: string): Promise<SimulationRecord | null>;
  /** Neue Simulation anlegen (Vorschaubild optional) */
  createSim(meta: SimulationMetadata, doc: SceneDocument, thumbnail?: string | null): Promise<SimulationMetadata>;
  /**
   * Dokument einer bestehenden Simulation speichern. Wirft ContentConflictError, wenn der Stand
   * inzwischen an anderer Stelle geändert wurde (nur Cloud) – außer mit { force: true }.
   */
  commitSim(id: string, doc: SceneDocument, patch: (m: SimulationMetadata) => SimulationMetadata, thumbnail?: string | null, opts?: CommitOptions): Promise<SimulationMetadata | null>;
  /** Nur Metadaten ändern (Name, Favorit, Archiv, zuletzt geöffnet …) */
  patchSimMeta(id: string, patch: (m: SimulationMetadata) => SimulationMetadata): Promise<SimulationMetadata | null>;
  /** Namen auch im gespeicherten Dokument führen */
  renameSimDoc(id: string, name: string): Promise<void>;
  deleteSim(id: string): Promise<void>;
  getThumb(id: string): Promise<string | null>;
  listCustomTemplates(): Promise<Template[]>;
  saveTemplate(t: Template): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  /** Lokalen Entwurf verwerfen (nach erfolgreichem Speichern) */
  clearDraft(id: string): Promise<void>;
}

/** Speichern abgelehnt, weil der Stand in der Cloud inzwischen neuer ist (anderes Gerät/Fenster) */
export class ContentConflictError extends Error {
  constructor(
    message = 'Diese Simulation wurde zwischenzeitlich an anderer Stelle gespeichert.',
    /** true = auf einem anderen Gerät gelöscht (nur „Als Kopie speichern“ möglich) */
    readonly remoteDeleted = false,
  ) {
    super(message);
    this.name = 'ContentConflictError';
  }
}
