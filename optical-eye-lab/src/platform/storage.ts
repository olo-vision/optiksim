/**
 * Speicher-Abstraktion (Phase 3).
 *
 * Alle Plattformdaten laufen über einen `StorageProvider`. Heute: `LocalStorageProvider`
 * (Browser, nur lokal). Die Schnittstelle ist asynchron, damit später z. B. ein
 * IndexedDB-, Datei- oder Cloud-Provider ohne Änderungen an den Repositories ergänzt werden kann.
 */

export interface StorageProvider {
  readonly kind: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  /** Belegter Speicher in Byte (Schätzung, nur Daten dieser App) */
  usage(): Promise<number>;
}

export class StorageQuotaError extends Error {
  constructor(message = 'Der lokale Speicher des Browsers ist voll.') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export const KEY_PREFIX = 'oel:v3:';

export const KEYS = {
  meta: `${KEY_PREFIX}meta`,
  users: `${KEY_PREFIX}users`,
  credentials: `${KEY_PREFIX}credentials`,
  session: `${KEY_PREFIX}session`,
  orgs: `${KEY_PREFIX}orgs`,
  prefs: (userId: string) => `${KEY_PREFIX}prefs:${userId}`,
  simIndex: `${KEY_PREFIX}sims:index`,
  sim: (id: string) => `${KEY_PREFIX}sim:${id}`,
  thumb: (id: string) => `${KEY_PREFIX}thumb:${id}`,
  draft: (id: string) => `${KEY_PREFIX}draft:${id}`,
  templates: `${KEY_PREFIX}templates`,
  recentUsers: `${KEY_PREFIX}recent-users`,
} as const;

function parse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Browser-LocalStorage. Fällt auf Arbeitsspeicher zurück, wenn LocalStorage gesperrt ist. */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local-storage';
  private fallback: MemoryStorageProvider | null = null;
  private readonly ls: Storage | null;

  constructor() {
    let ls: Storage | null = null;
    try {
      ls = window.localStorage;
      const probe = `${KEY_PREFIX}__probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
    } catch {
      ls = null;
      this.fallback = new MemoryStorageProvider();
    }
    this.ls = ls;
  }

  /** true, wenn Daten nicht dauerhaft gespeichert werden können (z. B. privater Modus mit Sperre) */
  get volatile() {
    return this.fallback !== null;
  }

  async get<T>(key: string) {
    if (this.fallback) return this.fallback.get<T>(key);
    return parse<T>(this.ls!.getItem(key));
  }

  async set<T>(key: string, value: T) {
    if (this.fallback) return this.fallback.set(key, value);
    try {
      this.ls!.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) throw new StorageQuotaError();
      throw e;
    }
  }

  async remove(key: string) {
    if (this.fallback) return this.fallback.remove(key);
    this.ls!.removeItem(key);
  }

  async keys(prefix = KEY_PREFIX) {
    if (this.fallback) return this.fallback.keys(prefix);
    const out: string[] = [];
    for (let i = 0; i < this.ls!.length; i++) {
      const k = this.ls!.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  async usage() {
    if (this.fallback) return this.fallback.usage();
    let bytes = 0;
    for (const k of await this.keys('')) {
      if (!k.startsWith(KEY_PREFIX) && !k.startsWith('optical-eye-lab.')) continue;
      bytes += (k.length + (this.ls!.getItem(k)?.length ?? 0)) * 2;
    }
    return bytes;
  }

  /** Direktzugriff auf Altdaten (Phase 1/2) für die Migration */
  readRaw(key: string): string | null {
    if (this.fallback) return null;
    return this.ls!.getItem(key);
  }
}

/** Flüchtiger Speicher – für Tests und als Rückfallebene. */
export class MemoryStorageProvider implements StorageProvider {
  readonly kind = 'memory';
  private map = new Map<string, string>();
  /** optionales Limit in Zeichen, um Speicher-voll-Fälle zu testen */
  constructor(private limit = Infinity) {}

  async get<T>(key: string) {
    return parse<T>(this.map.get(key) ?? null);
  }
  async set<T>(key: string, value: T) {
    const s = JSON.stringify(value);
    let total = s.length;
    for (const [k, v] of this.map) if (k !== key) total += v.length;
    if (total > this.limit) throw new StorageQuotaError();
    this.map.set(key, s);
  }
  async remove(key: string) {
    this.map.delete(key);
  }
  async keys(prefix = KEY_PREFIX) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
  async usage() {
    let n = 0;
    for (const [k, v] of this.map) n += (k.length + v.length) * 2;
    return n;
  }
  /** Tests: Rohdaten setzen (z. B. Altbestand simulieren) */
  setRaw(key: string, raw: string) {
    this.map.set(key, raw);
  }
  readRaw(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}

/** Zugriff auf Rohdaten (Altbestand) – beide Provider unterstützen das. */
export type RawReadable = { readRaw(key: string): string | null };
export const hasRawAccess = (s: StorageProvider): s is StorageProvider & RawReadable => typeof (s as Partial<RawReadable>).readRaw === 'function';
