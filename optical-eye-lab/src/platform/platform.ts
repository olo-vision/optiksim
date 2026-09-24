/**
 * Plattform-Kern: bündelt Speicher, Repositories und Dienste.
 * Die Oberfläche greift ausschließlich über diese Dienste auf Daten zu –
 * ein späterer Cloud-Provider ersetzt nur Storage/Auth, nicht die Oberfläche.
 */
import { LocalAuthProvider, type AuthProvider } from './auth';
import { AccountService } from './accounts';
import { LibraryService } from './library';
import { Repositories } from './repositories';
import { KEYS, LocalStorageProvider, type StorageProvider } from './storage';
import { LEGACY_DEFAULT_PREFS_KEY, migrateLegacyData, type MigrationReport } from './migration';
import { seedDemoData } from './seed';
import { normalizePrefs, prefsFromLegacy, type UserPreferences } from './preferences';
import type { Preferences } from '@/state/persistence';

export interface Platform {
  storage: StorageProvider;
  repos: Repositories;
  auth: AuthProvider;
  library: LibraryService;
  accounts: AccountService;
  init(options?: { seedDemo?: boolean }): Promise<InitResult>;
  loadPrefs(userId: string): Promise<UserPreferences>;
  savePrefs(userId: string, p: UserPreferences): Promise<void>;
}

export interface InitResult {
  firstRun: boolean;
  migration: MigrationReport | null;
}

export function createPlatform(storage: StorageProvider = new LocalStorageProvider()): Platform {
  const repos = new Repositories(storage);
  let initRun: Promise<InitResult> | null = null;

  async function runInit(seedDemo: boolean): Promise<InitResult> {
    const meta = await repos.getMeta();
    if (meta) return { firstRun: false, migration: null };
    const now = new Date().toISOString();
    await repos.saveMeta({ schemaVersion: 3, installedAt: now, demoSeeded: false });
    const migration = await migrateLegacyData(repos);
    const anyMigrated = migration.migratedScenes > 0 || migration.recoveredAutosave || migration.prefsTaken;
    if (seedDemo) await seedDemoData(repos);
    const m = (await repos.getMeta())!;
    await repos.saveMeta({
      ...m,
      demoSeeded: seedDemo,
      ...(anyMigrated ? { migratedFrom: 2, migratedAt: now, migratedCount: migration.migratedScenes + (migration.recoveredAutosave ? 1 : 0) } : {}),
    });
    return { firstRun: true, migration: anyMigrated ? migration : null };
  }
  const platform: Platform = {
    storage,
    repos,
    auth: new LocalAuthProvider(repos),
    library: new LibraryService(repos),
    accounts: new AccountService(repos),

    init(options) {
      // Einmalig je Instanz (React StrictMode ruft Effekte doppelt auf)
      initRun ??= runInit(options?.seedDemo ?? true).finally(() => {
        initRun = null;
      });
      return initRun;
    },

    async loadPrefs(userId) {
      const raw = await storage.get(KEYS.prefs(userId));
      if (raw) return normalizePrefs(raw);
      return prefsFromLegacy(await storage.get<Partial<Preferences>>(LEGACY_DEFAULT_PREFS_KEY));
    },

    savePrefs: (userId, p) => repos.savePrefs(userId, p),
  };
  return platform;
}
