/**
 * Inhalte des Kundenkontos in Supabase (0.10.0).
 *
 * Setzt die Schnittstelle ContentRepository über das CloudBackend um:
 *  - Simulationen (inkl. Vorschaubild) und eigene Vorlagen liegen in user_simulations / user_templates
 *    (RLS: nur das eigene Konto). Damit stehen sie auf jedem Gerät zur Verfügung.
 *  - Optimistische Nebenläufigkeit: gespeichert wird nur, wenn die Dokument-Revision noch der Revision
 *    entspricht, die dieses Fenster geladen hat. Sonst ContentConflictError (Dialog im Simulator).
 *  - Entwürfe der Absturzsicherung bleiben lokal auf dem Gerät (Repositories).
 *  - Im Browser werden nur Zwischenspeicher im Arbeitsspeicher gehalten – nichts Dauerhaftes.
 */
import type { SceneDocument } from '@/model/types';
import { SCHEMA_VERSION } from '@/model/types';
import { migrateDocument } from '@/state/persistence';
import type { CloudBackend } from '@/cloud/backend';
import { CloudError, type CloudSimulationPatch, type CloudSimulationRow, type CloudTemplateRow } from '@/cloud/types';
import { CATEGORY_LABELS, type SimulationCategory, type SimulationMetadata, type SimulationRecord, type SimulationSummary, type Template } from '@/platform/models';
import { ContentConflictError, type CommitOptions, type ContentRepository } from '@/platform/content';
import type { Repositories } from '@/platform/repositories';

/** Größte gespeicherte Vorschau (Datenbank erlaubt 600 kB) */
export const MAX_THUMBNAIL_CHARS = 580_000;

export interface CloudIdentity {
  /** Supabase-Benutzer-ID */
  cloudUserId: string;
  /** ID des lokalen Arbeitsbereichs-Benutzers (sb_<uuid>) */
  workspaceUserId: string;
  /** ID der Arbeitsbereichs-Organisation (sb_org_<institution>) */
  organizationId?: string;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as SimulationCategory[];
const asCategory = (c: string): SimulationCategory => (CATEGORIES.includes(c as SimulationCategory) ? (c as SimulationCategory) : 'other');

function asSummary(raw: unknown): SimulationSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SimulationSummary>;
  return {
    eyeRx: typeof r.eyeRx === 'string' ? r.eyeRx : '–',
    elementCount: typeof r.elementCount === 'number' ? r.elementCount : 0,
    elementKinds: Array.isArray(r.elementKinds) ? r.elementKinds.map(String) : [],
    highlights: Array.isArray(r.highlights) ? r.highlights.map(String) : [],
    modelName: typeof r.modelName === 'string' ? r.modelName : '',
  };
}

const usableThumb = (t: string | null | undefined) => (t && t.length <= MAX_THUMBNAIL_CHARS ? t : null);

const META_FIELDS = ['name', 'description', 'category', 'tags', 'favorite', 'archived', 'lastOpenedAt', 'templateId', 'moduleId'] as const;

export class CloudContentStore implements ContentRepository {
  readonly contentKind = 'cloud' as const;
  private metas = new Map<string, SimulationMetadata>();
  private listed = false;
  /** Revision, die dieses Fenster zuletzt geladen bzw. gespeichert hat (Basis der Konfliktprüfung) */
  private loadedRevision = new Map<string, number>();
  /** Revision laut letzter Liste (Rückfall, falls das Dokument nie geladen wurde) */
  private listedRevision = new Map<string, number>();
  private thumbs = new Map<string, string | null>();
  /** Schreibvorgänge je Simulation nacheinander (Auto-Save und Favorit dürfen sich nicht überholen) */
  private locks = new Map<string, Promise<unknown>>();

  private disposed = false;

  constructor(
    private backend: CloudBackend,
    private local: Repositories,
    readonly identity: CloudIdentity,
  ) {}

  /** Abmelden/Kontowechsel: dieser Speicher darf nichts mehr schreiben */
  dispose() {
    this.disposed = true;
  }

  /**
   * Schutz beim Kontowechsel (z. B. zweiter Tab meldet ein anderes Konto an): Schreiben nur, solange die
   * Sitzung noch zu diesem Konto gehört – sonst landeten Inhalte im falschen Konto.
   */
  async assertActive() {
    const uid = this.disposed ? null : await this.backend.currentUserId().catch(() => null);
    if (this.disposed || uid !== this.identity.cloudUserId) {
      this.disposed = true;
      throw new CloudError('Sie wurden abgemeldet oder mit einem anderen Konto angemeldet. Ihre Änderungen sind auf diesem Gerät gesichert; bitte melden Sie sich erneut an.', undefined, 'session');
    }
  }

  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return run;
  }

  toMeta(r: CloudSimulationRow): SimulationMetadata {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.ownerUserId === this.identity.cloudUserId ? this.identity.workspaceUserId : `sb_${r.ownerUserId}`,
      organizationId: this.identity.organizationId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ...(r.lastOpenedAt ? { lastOpenedAt: r.lastOpenedAt } : {}),
      tags: [...r.tags],
      category: asCategory(r.category),
      favorite: r.favorite,
      archived: r.archived,
      ...(r.templateId ? { templateId: r.templateId } : {}),
      ...(r.moduleId ? { moduleId: r.moduleId } : {}),
      summary: asSummary(r.summary),
      hasThumbnail: r.hasThumbnail,
      schemaVersion: r.schemaVersion,
    };
  }

  private remember(r: CloudSimulationRow) {
    const m = this.toMeta(r);
    this.metas.set(r.id, m);
    this.listedRevision.set(r.id, r.docRevision);
    return m;
  }

  /** Zwischenspeicher verwerfen (z. B. beim Zurückkehren in den Tab – Änderungen anderer Geräte) */
  invalidate() {
    this.listed = false;
  }

  /* ------------------------------------ Simulationen ------------------------------------ */

  async listSimMeta(): Promise<SimulationMetadata[]> {
    await this.assertActive();
    const rows = await this.backend.listSimulations();
    const next = new Map<string, SimulationMetadata>();
    for (const r of rows) {
      next.set(r.id, this.toMeta(r));
      this.listedRevision.set(r.id, r.docRevision);
      // Vorschaubild ist veraltet, wenn sich das Dokument seit dem Laden geändert hat
      const loaded = this.loadedRevision.get(r.id);
      if (loaded != null && loaded !== r.docRevision) this.thumbs.delete(r.id);
    }
    this.metas = next;
    this.listed = true;
    return [...next.values()];
  }

  async getSimMeta(id: string): Promise<SimulationMetadata | null> {
    if (!this.listed || !this.metas.has(id)) await this.listSimMeta();
    return this.metas.get(id) ?? null;
  }

  async getSim(id: string): Promise<SimulationRecord | null> {
    await this.assertActive();
    const row = await this.backend.getSimulation(id);
    if (!row) {
      this.metas.delete(id);
      return null;
    }
    const doc = migrateDocument(row.doc);
    if (!doc) return null;
    const meta = this.remember(row);
    this.loadedRevision.set(id, row.docRevision);
    // Der Name der Simulation (Spalte) ist maßgeblich – Umbenennen ändert das Dokument nicht
    return { meta, doc: { ...doc, name: row.name } };
  }

  async createSim(meta: SimulationMetadata, doc: SceneDocument, thumbnail?: string | null): Promise<SimulationMetadata> {
    await this.assertActive();
    const thumb = usableThumb(thumbnail);
    const row = await this.backend.insertSimulation({
      id: meta.id,
      name: meta.name,
      description: meta.description,
      category: meta.category,
      tags: meta.tags,
      favorite: meta.favorite,
      archived: meta.archived,
      templateId: meta.templateId ?? null,
      moduleId: meta.moduleId ?? null,
      summary: meta.summary,
      schemaVersion: meta.schemaVersion,
      doc,
      thumbnail: thumb,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastOpenedAt: meta.lastOpenedAt ?? null,
    });
    this.loadedRevision.set(row.id, row.docRevision);
    if (thumb) this.thumbs.set(row.id, thumb);
    return this.remember(row);
  }

  commitSim(id: string, doc: SceneDocument, patch: (m: SimulationMetadata) => SimulationMetadata, thumbnail?: string | null, opts?: CommitOptions): Promise<SimulationMetadata | null> {
    return this.serial(id, async () => {
      await this.assertActive();
      const cur = await this.getSimMeta(id);
      if (!cur) throw new ContentConflictError('Diese Simulation wurde inzwischen an anderer Stelle gelöscht.', true);
      const next = patch(cur);
      const thumb = usableThumb(thumbnail);
      const body: CloudSimulationPatch = { doc, name: next.name, summary: next.summary, schemaVersion: SCHEMA_VERSION };
      if (thumb) body.thumbnail = thumb;
      const expected = opts?.force ? null : (this.loadedRevision.get(id) ?? this.listedRevision.get(id) ?? null);
      const row = await this.backend.updateSimulation(id, body, expected);
      if (!row) {
        // Konflikt oder gelöscht? Aktuellen Stand prüfen.
        await this.listSimMeta();
        if (!this.metas.has(id)) throw new ContentConflictError('Diese Simulation wurde inzwischen an anderer Stelle gelöscht.', true);
        throw new ContentConflictError();
      }
      this.loadedRevision.set(id, row.docRevision);
      if (thumb) this.thumbs.set(id, thumb);
      return this.remember(row);
    });
  }

  patchSimMeta(id: string, fn: (m: SimulationMetadata) => SimulationMetadata): Promise<SimulationMetadata | null> {
    return this.serial(id, async () => {
      await this.assertActive();
      const cur = await this.getSimMeta(id);
      if (!cur) return null;
      const next = fn(cur);
      const body: Record<string, unknown> = {};
      for (const k of META_FIELDS) {
        if (JSON.stringify(next[k] ?? null) !== JSON.stringify(cur[k] ?? null)) body[k] = next[k] ?? null;
      }
      if (!Object.keys(body).length) return cur;
      const row = await this.backend.updateSimulation(id, body as CloudSimulationPatch);
      if (!row) {
        this.metas.delete(id);
        return null;
      }
      return this.remember(row);
    });
  }

  /** Name liegt als Spalte vor; das Dokument wird beim nächsten Speichern angeglichen. */
  async renameSimDoc(): Promise<void> {}

  async deleteSim(id: string): Promise<void> {
    await this.assertActive();
    await this.backend.deleteSimulation(id);
    this.metas.delete(id);
    this.thumbs.delete(id);
    this.loadedRevision.delete(id);
    this.listedRevision.delete(id);
    await this.local.clearDraft(id).catch(() => undefined);
    // lokale Sicherungskopie aus der Übernahme (bis zu 30 Tage) mit entfernen – gelöscht heißt auch auf diesem Gerät gelöscht
    try {
      const copy = (await this.local.listSimMeta()).find((m) => m.id === id && m.ownerId === this.identity.workspaceUserId);
      if (copy) await this.local.deleteSim(id);
    } catch {
      /* lokale Aufräumarbeit ist optional */
    }
  }

  private thumbRequests = new Map<string, Promise<string | null>>();

  async getThumb(id: string): Promise<string | null> {
    if (this.thumbs.has(id)) return this.thumbs.get(id) ?? null;
    const meta = this.metas.get(id);
    if (meta && !meta.hasThumbnail) return null;
    // gleichzeitige Anfragen für dasselbe Bild (Kachel + Liste) nur einmal senden
    let req = this.thumbRequests.get(id);
    if (!req) {
      req = this.backend.getSimulationThumbnail(id).finally(() => this.thumbRequests.delete(id));
      this.thumbRequests.set(id, req);
    }
    const t = await req;
    this.thumbs.set(id, t);
    return t;
  }

  /* -------------------------------------- Vorlagen -------------------------------------- */

  private toTemplate(r: CloudTemplateRow): Template | null {
    const doc = migrateDocument(r.doc);
    if (!doc) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: asCategory(r.category),
      tags: [...r.tags],
      visibility: r.visibility === 'institution' ? 'organization' : 'private',
      createdBy: r.ownerUserId === this.identity.cloudUserId ? this.identity.workspaceUserId : `sb_${r.ownerUserId}`,
      organizationId: this.identity.organizationId,
      createdAt: r.createdAt,
      doc,
    };
  }

  async listCustomTemplates(): Promise<Template[]> {
    return (await this.backend.listTemplates()).map((r) => this.toTemplate(r)).filter((t): t is Template => !!t);
  }

  async saveTemplate(t: Template): Promise<void> {
    if (!t.doc) return;
    await this.assertActive();
    await this.backend.saveTemplate({
      id: t.id,
      visibility: t.visibility === 'organization' ? 'institution' : 'private',
      name: t.name,
      description: t.description,
      category: t.category,
      tags: t.tags,
      doc: t.doc,
      createdAt: t.createdAt,
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.assertActive();
    return this.backend.deleteTemplate(id);
  }

  clearDraft(id: string): Promise<void> {
    return this.local.clearDraft(id);
  }
}
