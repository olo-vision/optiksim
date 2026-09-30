/**
 * Übernahme lokal gespeicherter Inhalte in das Kundenkonto (0.10.0).
 *
 * Bis Version 0.9 lagen Simulationen und Vorlagen im LocalStorage des Browsers – je Konto unter dem
 * Arbeitsbereichs-Benutzer „sb_<uuid>“. Die Übernahme ist sicher wiederholbar:
 *  - Nur Inhalte DIESES Kontos (ownerId = sb_<eigene uuid>) werden automatisch übernommen – nie Inhalte
 *    anderer Konten, die im selben Browser gearbeitet haben.
 *  - Gleiche ID bereits in der Cloud → nichts überschreiben. Ist der lokale Stand neuer und anders,
 *    entsteht zusätzlich eine Kopie „(von diesem Gerät)“ – so geht nichts verloren und es entstehen
 *    keine Doppelungen bei identischem Inhalt.
 *  - ID gehört einem fremden Konto (nicht sichtbar) → neue ID.
 *  - Ohne aktive Lizenz wird nicht geschrieben; die lokalen Daten bleiben unverändert und die
 *    Übernahme wird später wiederholt.
 *  - Übernommene Einträge werden je Konto markiert; die lokalen Kopien bleiben 30 Tage als Rückfallebene
 *    erhalten und werden danach entfernt.
 *  - Inhalte aus Versionen vor den Benutzerkonten (Besitzer „legacy“) werden nur nach ausdrücklicher
 *    Bestätigung übernommen – und dann für dieses Gerät als vergeben markiert (kein zweites Konto).
 */
import { createId } from '@/core/ids';
import type { CloudBackend } from '@/cloud/backend';
import { CloudError } from '@/cloud/types';
import type { SimulationMetadata } from '@/platform/models';
import type { Repositories } from '@/platform/repositories';
import { KEY_PREFIX } from '@/platform/storage';
import { LEGACY_OWNER } from '@/platform/library';
import type { CloudContentStore } from './cloudContent';

export const LOCAL_COPY_RETENTION_DAYS = 30;
const DAY = 86_400_000;

export const MIGRATION_KEYS = {
  account: (cloudUserId: string) => `${KEY_PREFIX}cloud-migrated:${cloudUserId}`,
  /** Geräteweit: Altbestand wurde einem Konto zugeordnet */
  legacyClaim: `${KEY_PREFIX}cloud-legacy-claim`,
} as const;

interface AccountMarker {
  /** übernommene lokale IDs → Zeitpunkt */
  sims: Record<string, string>;
  templates: Record<string, string>;
}

interface LegacyClaim {
  cloudUserId: string;
  at: string;
  ids: string[];
}

export interface LocalImportReport {
  /** neu in das Konto übernommen */
  imported: number;
  /** zusätzlich als Kopie übernommen (lokal neuer als die Cloud) */
  copies: number;
  /** bereits in der Cloud (unverändert gelassen) */
  alreadyInCloud: number;
  templates: number;
  /** noch nicht übernommen, weil keine aktive Lizenz besteht */
  waitingForLicense: number;
  failed: number;
  /** Simulationen aus früheren Versionen, die auf Bestätigung warten */
  legacyPending: number;
  purgedLocalCopies: number;
}

const emptyReport = (): LocalImportReport => ({ imported: 0, copies: 0, alreadyInCloud: 0, templates: 0, waitingForLicense: 0, failed: 0, legacyPending: 0, purgedLocalCopies: 0 });

const isNoLicense = (e: unknown) => e instanceof CloudError && e.code === 'OLL01';
const isExists = (e: unknown) => e instanceof CloudError && e.code === 'exists';

export class LocalContentMigration {
  constructor(
    private local: Repositories,
    private store: CloudContentStore,
    private backend: CloudBackend,
    private now: () => number = () => Date.now(),
  ) {}

  private get cloudUserId() {
    return this.store.identity.cloudUserId;
  }
  private get ownerId() {
    return this.store.identity.workspaceUserId;
  }

  private async marker(): Promise<AccountMarker> {
    const m = await this.local.storage.get<AccountMarker>(MIGRATION_KEYS.account(this.cloudUserId));
    return { sims: { ...(m?.sims ?? {}) }, templates: { ...(m?.templates ?? {}) } };
  }
  private saveMarker(m: AccountMarker) {
    return this.local.storage.set(MIGRATION_KEYS.account(this.cloudUserId), m);
  }

  /** Altbestand (Besitzer „legacy“), der diesem Gerät noch keinem Konto zugeordnet wurde */
  async pendingLegacy(): Promise<SimulationMetadata[]> {
    const claim = await this.local.storage.get<LegacyClaim>(MIGRATION_KEYS.legacyClaim);
    if (claim) return [];
    return (await this.local.listSimMeta()).filter((m) => m.ownerId === LEGACY_OWNER);
  }

  /** Eigene lokale Inhalte übernehmen (automatisch nach der Anmeldung). */
  async run(): Promise<LocalImportReport> {
    const report = emptyReport();
    const marker = await this.marker();
    const all = await this.local.listSimMeta();
    const own = all.filter((m) => m.ownerId === this.ownerId && !marker.sims[m.id]);
    const ownTemplates = (await this.local.listCustomTemplates()).filter((t) => t.createdBy === this.ownerId && !marker.templates[t.id]);
    report.legacyPending = (await this.pendingLegacy()).length;

    if (own.length) {
      const cloud = new Map((await this.store.listSimMeta()).map((m) => [m.id, m]));
      for (const meta of own) {
        try {
          const outcome = await this.importSim(meta, cloud.get(meta.id) ?? null, false);
          if (outcome === 'imported') report.imported++;
          else if (outcome === 'copy') report.copies++;
          else if (outcome === 'present') report.alreadyInCloud++;
          if (outcome !== 'missing') marker.sims[meta.id] = new Date(this.now()).toISOString();
          await this.saveMarker(marker);
        } catch (e) {
          if (isNoLicense(e)) {
            report.waitingForLicense = own.length - report.imported - report.copies - report.alreadyInCloud - report.failed;
            break;
          }
          report.failed++;
        }
      }
    }

    if (ownTemplates.length && !report.waitingForLicense) {
      const cloudIds = new Set((await this.store.listCustomTemplates()).map((t) => t.id));
      for (const t of ownTemplates) {
        try {
          if (!cloudIds.has(t.id)) {
            await this.store.saveTemplate(t);
            report.templates++;
          }
          marker.templates[t.id] = new Date(this.now()).toISOString();
          await this.saveMarker(marker);
        } catch (e) {
          if (isNoLicense(e)) {
            report.waitingForLicense += ownTemplates.length;
            break;
          }
          report.failed++;
        }
      }
    }

    report.purgedLocalCopies = await this.purgeOldLocalCopies(marker);
    return report;
  }

  /**
   * Eine lokale Simulation übernehmen.
   * @returns imported | copy (lokal neuer → zusätzliche Kopie) | present (Cloud aktuell) | missing (lokal unlesbar)
   */
  private async importSim(meta: SimulationMetadata, inCloud: SimulationMetadata | null, newId: boolean): Promise<'imported' | 'copy' | 'present' | 'missing'> {
    const rec = await this.local.getSim(meta.id);
    if (!rec) return 'missing';
    const thumb = meta.hasThumbnail ? await this.local.getThumb(meta.id) : null;
    const base: SimulationMetadata = { ...rec.meta, ownerId: this.ownerId, lastOpenedAt: undefined };

    if (inCloud && !newId) {
      if (rec.meta.updatedAt <= inCloud.updatedAt) return 'present';
      const cloudRec = await this.store.getSim(meta.id);
      if (cloudRec && JSON.stringify({ ...cloudRec.doc, name: '', updatedAt: '' }) === JSON.stringify({ ...rec.doc, name: '', updatedAt: '' })) return 'present';
      await this.insert({ ...base, id: createId('sim'), name: `${rec.meta.name} (von diesem Gerät)` }, rec.doc, thumb);
      return 'copy';
    }
    const id = newId ? createId('sim') : meta.id;
    try {
      await this.insert({ ...base, id }, rec.doc, thumb);
    } catch (e) {
      // ID in einem anderen Konto vergeben (für uns unsichtbar) → mit neuer ID übernehmen
      if (isExists(e) && !newId) {
        await this.insert({ ...base, id: createId('sim') }, rec.doc, thumb);
        return 'imported';
      }
      throw e;
    }
    return 'imported';
  }

  private insert(meta: SimulationMetadata, doc: Parameters<CloudContentStore['createSim']>[1], thumb: string | null) {
    return this.backend
      .insertSimulation({
        id: meta.id,
        name: meta.name.slice(0, 200),
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
        thumbnail: thumb && thumb.length <= 580_000 ? thumb : null,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastOpenedAt: null,
        origin: 'local-migration',
      })
      .then(() => this.store.invalidate());
  }

  /** Nach Bestätigung: Altbestand dieses Geräts in das Konto übernehmen (neue IDs). */
  async importLegacy(): Promise<{ imported: number; failed: number }> {
    const pending = await this.pendingLegacy();
    let imported = 0;
    let failed = 0;
    const done: string[] = [];
    for (const m of pending) {
      try {
        const r = await this.importSim(m, null, true);
        if (r === 'imported') {
          imported++;
          done.push(m.id);
        }
      } catch (e) {
        if (isNoLicense(e)) throw e;
        failed++;
      }
    }
    if (!failed) await this.local.storage.set<LegacyClaim>(MIGRATION_KEYS.legacyClaim, { cloudUserId: this.cloudUserId, at: new Date(this.now()).toISOString(), ids: done });
    return { imported, failed };
  }

  /** Lokale Kopien übernommener Simulationen nach Ablauf der Frist entfernen. */
  private async purgeOldLocalCopies(marker: AccountMarker): Promise<number> {
    const limit = this.now() - LOCAL_COPY_RETENTION_DAYS * DAY;
    const local = new Map((await this.local.listSimMeta()).map((m) => [m.id, m]));
    let n = 0;
    for (const [id, at] of Object.entries(marker.sims)) {
      const m = local.get(id);
      if (!m || m.ownerId !== this.ownerId || Date.parse(at) > limit) continue;
      // Entwurf der Absturzsicherung behalten (gleiche ID wie in der Cloud)
      const draft = await this.local.getDraft(id);
      await this.local.deleteSim(id);
      if (draft) await this.local.saveDraft(draft);
      n++;
    }
    return n;
  }
}
