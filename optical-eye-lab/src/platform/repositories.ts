/**
 * Repositories: typisierter Datenzugriff über den StorageProvider.
 * Keine Geschäftslogik – die liegt in auth.ts, library.ts, admin.ts.
 */
import type { SceneDocument } from '@/model/types';
import { KEYS, type StorageProvider } from './storage';
import type { Organization, Session, SimulationMetadata, SimulationRecord, Template, User } from './models';
import type { DemoCredential } from './demoCredentials';
import { normalizePrefs, type UserPreferences } from './preferences';
import { migrateDocument } from '@/state/persistence';

export interface PlatformMeta {
  schemaVersion: 3;
  installedAt: string;
  /** Aus welcher Datenversion migriert wurde (2 = Phase 1/2-Speicherstände gefunden) */
  migratedFrom?: number;
  migratedAt?: string;
  migratedCount?: number;
  demoSeeded: boolean;
  /** Demo-Daten wurden bewusst entfernt → nicht erneut anlegen */
  demoRemoved?: boolean;
  /** Organisation dieser lokalen Installation (erste echte Organisation) */
  primaryOrgId?: string;
}

export interface DraftRecord {
  simId: string;
  savedAt: string;
  doc: SceneDocument;
}

const arr = <T,>(v: T[] | null) => (Array.isArray(v) ? v : []);

export class Repositories {
  constructor(readonly storage: StorageProvider) {}

  /**
   * Schreibvorgänge nach dem Muster „lesen → ändern → schreiben“ werden serialisiert,
   * damit sich parallele Aktionen (z. B. Auto-Save und Favorit setzen) nicht überschreiben.
   */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async upsert<T extends { id: string }>(key: string, item: T) {
    const list = arr(await this.storage.get<T[]>(key));
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
    await this.storage.set(key, list);
  }
  private async removeFrom<T>(key: string, keep: (x: T) => boolean) {
    await this.storage.set(key, arr(await this.storage.get<T[]>(key)).filter(keep));
  }

  /* ------------------------------ Meta ------------------------------ */
  getMeta = () => this.storage.get<PlatformMeta>(KEYS.meta);
  saveMeta = (m: PlatformMeta) => this.storage.set(KEYS.meta, m);

  /* ----------------------------- Benutzer ---------------------------- */
  async listUsers(): Promise<User[]> {
    return arr(await this.storage.get<User[]>(KEYS.users));
  }
  async getUser(id: string) {
    return (await this.listUsers()).find((u) => u.id === id) ?? null;
  }
  saveUser(u: User) {
    return this.serial(async () => {
      await this.upsert(KEYS.users, u);
      return u;
    });
  }
  deleteUser(id: string) {
    return this.serial(async () => {
      await this.removeFrom<User>(KEYS.users, (u) => u.id !== id);
      await this.removeFrom<DemoCredential>(KEYS.credentials, (c) => c.userId !== id);
      await this.storage.remove(KEYS.prefs(id));
    });
  }

  /* ------------------------ Demo-Anmeldedaten ------------------------ */
  async listCredentials(): Promise<DemoCredential[]> {
    return arr(await this.storage.get<DemoCredential[]>(KEYS.credentials));
  }
  saveCredential(c: DemoCredential) {
    return this.serial(async () => {
      const list = (await this.listCredentials()).filter((x) => x.userId !== c.userId);
      list.push(c);
      await this.storage.set(KEYS.credentials, list);
    });
  }

  /* ----------------------------- Sitzung ----------------------------- */
  getSession = () => this.storage.get<Session>(KEYS.session);
  saveSession = (s: Session) => this.storage.set(KEYS.session, s);
  clearSession = () => this.storage.remove(KEYS.session);
  async getRecentUserIds(): Promise<string[]> {
    return arr(await this.storage.get<string[]>(KEYS.recentUsers));
  }
  pushRecentUser(id: string) {
    return this.serial(async () => {
      const list = [id, ...(await this.getRecentUserIds()).filter((x) => x !== id)].slice(0, 8);
      await this.storage.set(KEYS.recentUsers, list);
    });
  }
  removeRecentUser(id: string) {
    return this.serial(() => this.removeFrom<string>(KEYS.recentUsers, (x) => x !== id));
  }

  /* -------------------------- Organisationen ------------------------- */
  async listOrgs(): Promise<Organization[]> {
    return arr(await this.storage.get<Organization[]>(KEYS.orgs));
  }
  async getOrg(id: string | undefined) {
    if (!id) return null;
    return (await this.listOrgs()).find((o) => o.id === id) ?? null;
  }
  saveOrg(o: Organization) {
    return this.serial(async () => {
      await this.upsert(KEYS.orgs, o);
      return o;
    });
  }
  deleteOrg(id: string) {
    return this.serial(() => this.removeFrom<Organization>(KEYS.orgs, (o) => o.id !== id));
  }

  /* --------------------------- Einstellungen -------------------------- */
  async getPrefs(userId: string): Promise<UserPreferences> {
    return normalizePrefs(await this.storage.get(KEYS.prefs(userId)));
  }
  savePrefs = (userId: string, p: UserPreferences) => this.storage.set(KEYS.prefs(userId), p);

  /* --------------------------- Simulationen -------------------------- */
  async listSimMeta(): Promise<SimulationMetadata[]> {
    return arr(await this.storage.get<SimulationMetadata[]>(KEYS.simIndex));
  }
  async getSimMeta(id: string) {
    return (await this.listSimMeta()).find((m) => m.id === id) ?? null;
  }
  async getSim(id: string): Promise<SimulationRecord | null> {
    const meta = await this.getSimMeta(id);
    if (!meta) return null;
    const doc = migrateDocument(await this.storage.get(KEYS.sim(id)));
    if (!doc) return null;
    return { meta, doc };
  }
  /** Dokument zuerst schreiben, dann den Index – so zeigt der Index nie auf fehlende Daten. */
  saveSim(meta: SimulationMetadata, doc: SceneDocument) {
    return this.serial(async () => {
      await this.storage.set(KEYS.sim(meta.id), doc);
      await this.upsert(KEYS.simIndex, meta);
    });
  }
  saveSimDoc(id: string, doc: SceneDocument) {
    return this.serial(() => this.storage.set(KEYS.sim(id), doc));
  }
  saveSimMeta(meta: SimulationMetadata) {
    return this.serial(() => this.upsert(KEYS.simIndex, meta));
  }
  /** Metadaten atomar ändern (liest den aktuellen Stand innerhalb der Sperre). */
  patchSimMeta(id: string, patch: (m: SimulationMetadata) => SimulationMetadata) {
    return this.serial(async () => {
      const list = await this.listSimMeta();
      const cur = list.find((m) => m.id === id);
      if (!cur) return null;
      const next = patch(cur);
      await this.upsert(KEYS.simIndex, next);
      return next;
    });
  }
  deleteSim(id: string) {
    return this.serial(async () => {
      await this.removeFrom<SimulationMetadata>(KEYS.simIndex, (m) => m.id !== id);
      await this.storage.remove(KEYS.sim(id));
      await this.storage.remove(KEYS.thumb(id));
      await this.storage.remove(KEYS.draft(id));
    });
  }

  getThumb = (id: string) => this.storage.get<string>(KEYS.thumb(id));
  saveThumb = (id: string, dataUrl: string) => this.storage.set(KEYS.thumb(id), dataUrl);
  removeThumb = (id: string) => this.storage.remove(KEYS.thumb(id));

  getDraft = (id: string) => this.storage.get<DraftRecord>(KEYS.draft(id));
  saveDraft = (d: DraftRecord) => this.storage.set(KEYS.draft(d.simId), d);
  clearDraft = (id: string) => this.storage.remove(KEYS.draft(id));

  /* ----------------------------- Vorlagen ---------------------------- */
  async listCustomTemplates(): Promise<Template[]> {
    return arr(await this.storage.get<Template[]>(KEYS.templates));
  }
  saveTemplate(t: Template) {
    return this.serial(() => this.upsert(KEYS.templates, t));
  }
  deleteTemplate(id: string) {
    return this.serial(() => this.removeFrom<Template>(KEYS.templates, (t) => t.id !== id));
  }
}
