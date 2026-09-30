/**
 * Simulationsbibliothek & Vorlagen – Geschäftslogik.
 * Die Physik bleibt unberührt: gespeichert wird das SceneDocument, Metadaten werden abgeleitet.
 */
import type { SceneDocument } from '@/model/types';
import { SCHEMA_VERSION } from '@/model/types';
import { applyConstraints } from '@/model/derived/contactSeat';
import { createId } from '@/core/ids';
import { ContentConflictError, type CommitOptions, type ContentRepository } from './content';
import type { SimulationCategory, SimulationMetadata, SimulationRecord, Template, TemplateVisibility, User } from './models';
import { can, GUEST_SIMULATION_LIMIT } from './permissions';
import { guessCategory, summarizeDocument } from './summary';
import { BUILTIN_TEMPLATES, documentFromTemplate } from './templates';
import type { ImportedSimulation } from './fileFormat';

export class LibraryError extends Error {}

export type LibraryScope = 'all' | 'mine' | 'favorites' | 'recent' | 'archived';
export type LibrarySort = 'updated' | 'created' | 'opened' | 'name';

export interface LibraryQuery {
  text?: string;
  category?: SimulationCategory | 'all';
  scope?: LibraryScope;
  sort?: LibrarySort;
  tag?: string;
}

export const LEGACY_OWNER = 'legacy';

/** Sichtbarkeit: eigene, übernommene Altszenen; Admins sehen alle. */
export function isVisibleTo(user: User, m: SimulationMetadata): boolean {
  if (m.ownerId === user.id || m.ownerId === LEGACY_OWNER) return true;
  return can(user, 'simulations.viewAll');
}

export function canModify(user: User, m: SimulationMetadata): boolean {
  return m.ownerId === user.id || m.ownerId === LEGACY_OWNER || can(user, 'simulations.viewAll');
}

export function querySimulations(list: SimulationMetadata[], q: LibraryQuery, userId?: string): SimulationMetadata[] {
  const text = q.text?.trim().toLowerCase() ?? '';
  const scope = q.scope ?? 'all';
  let out = list.filter((m) => {
    if (scope === 'archived' ? !m.archived : m.archived) return false;
    if (scope === 'favorites' && !m.favorite) return false;
    if (scope === 'mine' && m.ownerId !== userId) return false;
    if (scope === 'recent' && !m.lastOpenedAt) return false;
    if (q.category && q.category !== 'all' && m.category !== q.category) return false;
    if (q.tag && !m.tags.includes(q.tag)) return false;
    if (text) {
      const hay = [m.name, m.description, m.summary.eyeRx, ...m.tags, ...m.summary.elementKinds, ...m.summary.highlights].join(' ').toLowerCase();
      if (!text.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const sort = scope === 'recent' ? 'opened' : (q.sort ?? 'updated');
  const by: Record<LibrarySort, (a: SimulationMetadata, b: SimulationMetadata) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    opened: (a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''),
    name: (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
  };
  out = [...out].sort(by[sort]);
  return out;
}

export function uniqueName(base: string, existing: string[]): string {
  const set = new Set(existing.map((n) => n.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  const stem = base.replace(/\s*\(Kopie(?: \d+)?\)$/, '');
  for (let i = 1; i < 1000; i++) {
    const n = i === 1 ? `${stem} (Kopie)` : `${stem} (Kopie ${i})`;
    if (!set.has(n.toLowerCase())) return n;
  }
  return `${stem} (${Date.now()})`;
}

export interface CreateInput {
  name: string;
  description?: string;
  category?: SimulationCategory;
  tags?: string[];
  templateId?: string;
  moduleId?: string;
  doc: SceneDocument;
}

export class LibraryService {
  constructor(private repos: ContentRepository) {}

  /** Speicherort der Inhalte ('local' = Browser, 'cloud' = Konto) */
  get storageKind() {
    return this.repos.contentKind;
  }

  async list(user: User): Promise<SimulationMetadata[]> {
    return (await this.repos.listSimMeta()).filter((m) => isVisibleTo(user, m));
  }

  async get(user: User, id: string): Promise<SimulationRecord | null> {
    const rec = await this.repos.getSim(id);
    if (!rec || !isVisibleTo(user, rec.meta)) return null;
    return rec;
  }

  private async assertCanCreate(user: User, count = 1) {
    if (!can(user, 'simulations.create')) throw new LibraryError('Ihre Rolle darf keine Simulationen anlegen.');
    if (user.role === 'guest') {
      const own = (await this.repos.listSimMeta()).filter((m) => m.ownerId === user.id).length;
      if (own + count > GUEST_SIMULATION_LIMIT)
        throw new LibraryError(`Im Gastzugang sind höchstens ${GUEST_SIMULATION_LIMIT} Simulationen möglich. Legen Sie ein Konto an, um unbegrenzt zu speichern.`);
    }
  }

  private async assertModify(user: User, id: string): Promise<SimulationMetadata> {
    const m = await this.repos.getSimMeta(id);
    if (!m) throw new LibraryError('Die Simulation existiert nicht mehr.');
    if (!canModify(user, m)) throw new LibraryError('Sie dürfen diese Simulation nicht ändern.');
    return m;
  }

  async create(user: User, input: CreateInput, thumbnail?: string | null): Promise<SimulationRecord> {
    await this.assertCanCreate(user);
    const now = new Date().toISOString();
    const name = input.name.trim() || 'Neue Simulation';
    const doc = applyConstraints({ ...input.doc, id: createId('scene'), name, createdAt: now, updatedAt: now });
    const meta: SimulationMetadata = {
      id: createId('sim'),
      name,
      description: input.description?.trim() ?? '',
      ownerId: user.id,
      organizationId: user.organizationId,
      createdAt: now,
      updatedAt: now,
      tags: input.tags ?? [],
      category: input.category ?? guessCategory(doc),
      favorite: false,
      archived: false,
      templateId: input.templateId,
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      summary: summarizeDocument(doc),
      hasThumbnail: false,
      schemaVersion: SCHEMA_VERSION,
    };
    const saved = await this.repos.createSim(meta, doc, thumbnail);
    return { meta: saved, doc };
  }

  async createFromTemplate(user: User, templateId: string, name?: string, description?: string): Promise<SimulationRecord> {
    const t = await this.getTemplate(user, templateId);
    if (!t) throw new LibraryError('Die Vorlage wurde nicht gefunden.');
    const doc = documentFromTemplate(t, name);
    return this.create(user, { name: name?.trim() || t.name, description: description ?? t.description, category: t.category, tags: [...t.tags], templateId: t.id, doc });
  }

  /**
   * Speichert das Dokument einer bestehenden Simulation (Name des Dokuments = Name der Simulation).
   * Cloud: wirft ContentConflictError, wenn inzwischen ein anderes Gerät gespeichert hat (außer force).
   */
  async save(user: User, id: string, docIn: SceneDocument, thumbnail?: string | null, opts?: CommitOptions): Promise<SimulationMetadata> {
    // Inzwischen gelöscht (anderes Gerät/Fenster)? → als Konflikt melden, damit der Stand als Kopie gesichert werden kann
    if (!(await this.repos.getSimMeta(id))) throw new ContentConflictError('Diese Simulation wurde inzwischen an anderer Stelle gelöscht.', true);
    const m = await this.assertModify(user, id);
    const now = new Date().toISOString();
    const doc = { ...docIn, name: docIn.name.trim() || m.name, updatedAt: now };
    const next = await this.repos.commitSim(id, doc, (cur) => ({ ...cur, name: doc.name, updatedAt: now, summary: summarizeDocument(doc), schemaVersion: SCHEMA_VERSION }), thumbnail, opts);
    if (!next) throw new LibraryError('Die Simulation existiert nicht mehr.');
    await this.repos.clearDraft(id);
    return next;
  }

  saveAs(user: User, doc: SceneDocument, name: string, from?: SimulationMetadata, thumbnail?: string | null): Promise<SimulationRecord> {
    return this.create(user, { name, description: from?.description, category: from?.category, tags: from ? [...from.tags] : [], templateId: from?.templateId, doc }, thumbnail);
  }

  async updateDetails(user: User, id: string, patch: Partial<Pick<SimulationMetadata, 'name' | 'description' | 'category' | 'tags' | 'favorite' | 'archived'>>) {
    await this.assertModify(user, id);
    const clean = { ...patch };
    if (clean.name !== undefined) {
      clean.name = clean.name.trim();
      if (!clean.name) throw new LibraryError('Der Name darf nicht leer sein.');
    }
    const next = await this.repos.patchSimMeta(id, (m) => ({ ...m, ...clean, updatedAt: patch.favorite !== undefined && Object.keys(patch).length === 1 ? m.updatedAt : new Date().toISOString() }));
    // Name auch im Dokument führen (Simulator-Anzeige)
    if (clean.name !== undefined) await this.repos.renameSimDoc(id, clean.name);
    return next;
  }

  rename(user: User, id: string, name: string) {
    return this.updateDetails(user, id, { name });
  }

  async duplicate(user: User, id: string): Promise<SimulationRecord> {
    const rec = await this.get(user, id);
    if (!rec) throw new LibraryError('Die Simulation existiert nicht mehr.');
    const names = (await this.list(user)).map((m) => m.name);
    const thumb = await this.repos.getThumb(id).catch(() => null);
    return this.create(
      user,
      {
        name: uniqueName(rec.meta.name, names),
        description: rec.meta.description,
        category: rec.meta.category,
        tags: [...rec.meta.tags],
        templateId: rec.meta.templateId,
        doc: structuredClone(rec.doc),
      },
      thumb,
    );
  }

  async remove(user: User, id: string) {
    await this.assertModify(user, id);
    await this.repos.deleteSim(id);
  }

  /** „Zuletzt geöffnet“ – rein informativ; Fehler (z. B. ohne aktive Lizenz) werden ignoriert. */
  async markOpened(id: string) {
    await this.repos.patchSimMeta(id, (m) => ({ ...m, lastOpenedAt: new Date().toISOString() })).catch(() => null);
  }

  thumbnail(id: string) {
    return this.repos.getThumb(id);
  }

  /* ----------------------------- Vorlagen ----------------------------- */

  async listTemplates(user: User): Promise<Template[]> {
    const custom = (await this.repos.listCustomTemplates()).filter(
      (t) => t.createdBy === user.id || (t.visibility === 'organization' && !!user.organizationId && t.organizationId === user.organizationId) || can(user, 'simulations.viewAll'),
    );
    return [...BUILTIN_TEMPLATES, ...custom];
  }

  async getTemplate(user: User, id: string) {
    return (await this.listTemplates(user)).find((t) => t.id === id) ?? null;
  }

  async saveAsTemplate(user: User, doc: SceneDocument, input: { name: string; description?: string; category: SimulationCategory; tags?: string[]; visibility: Exclude<TemplateVisibility, 'builtin'> }): Promise<Template> {
    if (!can(user, 'templates.create')) throw new LibraryError('Ihre Rolle darf keine Vorlagen anlegen.');
    if (input.visibility === 'organization' && !can(user, 'templates.publishOrganization')) throw new LibraryError('Ihre Rolle darf keine Vorlagen für die Organisation veröffentlichen.');
    const name = input.name.trim();
    if (!name) throw new LibraryError('Bitte geben Sie einen Namen für die Vorlage ein.');
    const t: Template = {
      id: createId('tpl'),
      name,
      description: input.description?.trim() ?? '',
      category: input.category,
      tags: input.tags ?? [],
      visibility: input.visibility,
      createdBy: user.id,
      organizationId: user.organizationId,
      createdAt: new Date().toISOString(),
      doc: structuredClone({ ...doc, name }),
    };
    await this.repos.saveTemplate(t);
    return t;
  }

  async deleteTemplate(user: User, id: string) {
    const t = (await this.repos.listCustomTemplates()).find((x) => x.id === id);
    if (!t) throw new LibraryError('Eingebaute Vorlagen können nicht gelöscht werden.');
    if (t.createdBy !== user.id && user.role !== 'admin') throw new LibraryError('Sie dürfen diese Vorlage nicht löschen.');
    await this.repos.deleteTemplate(id);
  }

  /* -------------------------- Import / Export -------------------------- */

  async importItems(user: User, items: ImportedSimulation[]): Promise<SimulationRecord[]> {
    await this.assertCanCreate(user, items.length);
    const names = (await this.list(user)).map((m) => m.name);
    const out: SimulationRecord[] = [];
    for (const it of items) {
      const name = uniqueName(it.meta.name?.trim() || it.doc.name || 'Importierte Simulation', names);
      names.push(name);
      out.push(
        await this.create(user, {
          name,
          description: it.meta.description ?? '',
          category: it.meta.category ?? guessCategory(it.doc),
          tags: [...new Set([...(it.meta.tags ?? []), 'Importiert'])],
          doc: it.doc,
        }),
      );
    }
    return out;
  }

  async records(user: User, ids?: string[]): Promise<SimulationRecord[]> {
    const metas = (await this.list(user)).filter((m) => !ids || ids.includes(m.id));
    const out: SimulationRecord[] = [];
    for (const m of metas) {
      const r = await this.repos.getSim(m.id);
      if (r) out.push(r);
    }
    return out;
  }
}
