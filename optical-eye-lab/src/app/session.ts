/**
 * Sitzungszustand der Anwendung: angemeldeter Benutzer, Organisation, Bibliothek, Vorlagen.
 * Einstellungen liegen (als einzige Quelle) in `useAppStore.prefs` und werden hier je Benutzer
 * geladen bzw. gespeichert.
 */
import { create } from 'zustand';
import { platform } from './platformInstance';
import { configureStoreHooks, useAppStore } from '@/state/store';
import type { Organization, SimulationMetadata, Template, User } from '@/platform/models';
import type { SignUpInput } from '@/platform/auth';
import type { MigrationReport } from '@/platform/migration';
import { applyAccent } from '@/platform/branding';
import { DEFAULT_USER_PREFS, type UserPreferences } from '@/platform/preferences';
import { StorageQuotaError } from '@/platform/storage';

interface SessionState {
  status: 'booting' | 'ready' | 'error';
  bootError: string | null;
  user: User | null;
  org: Organization | null;
  sims: SimulationMetadata[];
  templates: Template[];
  libraryLoaded: boolean;
  /** Ergebnis der einmaligen Datenübernahme aus Phase 1/2 (nur beim ersten Start) */
  migration: MigrationReport | null;
  /** Speicher nicht dauerhaft (LocalStorage gesperrt) */
  volatile: boolean;

  boot: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: SignUpInput) => Promise<User>;
  signInAsGuest: () => Promise<User>;
  signOut: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshUser: () => Promise<void>;
  dismissMigration: () => void;
}

let prefsTimer: number | undefined;
/** Noch nicht geschriebene Einstellungen (entprellt) – werden beim Verlassen der Seite sofort gesichert. */
let pendingPrefs: { userId: string; prefs: UserPreferences } | null = null;

function flushPrefs() {
  window.clearTimeout(prefsTimer);
  const p = pendingPrefs;
  pendingPrefs = null;
  // LocalStorageProvider schreibt synchron im ersten Schritt – auch in „pagehide“ zuverlässig
  if (p) platform.savePrefs(p.userId, p.prefs).catch((e) => useAppStore.getState().notify(errorMessage(e), 'warning'));
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPrefs);
  window.addEventListener('beforeunload', flushPrefs);
}

/** Fehlermeldung für die Oberfläche */
export function errorMessage(e: unknown): string {
  if (e instanceof StorageQuotaError) return 'Der lokale Speicher des Browsers ist voll. Lösche nicht mehr benötigte Simulationen oder exportiere sie als Datei.';
  if (e instanceof Error && e.message) return e.message;
  return 'Unbekannter Fehler.';
}

async function activate(user: User) {
  const [org, prefs] = await Promise.all([platform.repos.getOrg(user.organizationId), platform.loadPrefs(user.id)]);
  useAppStore.getState().applyUserPrefs(prefs);
  configureStoreHooks({
    persistPrefs: (p: UserPreferences) => {
      pendingPrefs = { userId: user.id, prefs: p };
      window.clearTimeout(prefsTimer);
      prefsTimer = window.setTimeout(flushPrefs, 250);
    },
  });
  applyAccent(org?.branding.accentColor);
  useSession.setState({ user, org, sims: [], templates: [], libraryLoaded: false });
  await useSession.getState().refreshLibrary();
  return user;
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'booting',
  bootError: null,
  user: null,
  org: null,
  sims: [],
  templates: [],
  libraryLoaded: false,
  migration: null,
  volatile: false,

  boot: async () => {
    try {
      const res = await platform.init();
      const volatile = (platform.storage as { volatile?: boolean }).volatile === true;
      set({ migration: res.migration, volatile });
      const user = await platform.auth.restore();
      if (user) await activate(user);
      set({ status: 'ready' });
    } catch (e) {
      set({ status: 'error', bootError: errorMessage(e) });
    }
  },

  signIn: async (email, password) => activate(await platform.auth.signIn(email, password)),
  signUp: async (input) => activate(await platform.auth.signUp(input)),
  signInAsGuest: async () => activate(await platform.auth.signInAsGuest()),

  signOut: async () => {
    flushPrefs();
    await platform.auth.signOut();
    configureStoreHooks({ persistPrefs: undefined, save: undefined, writeDraft: undefined });
    useAppStore.getState().applyUserPrefs(DEFAULT_USER_PREFS);
    useAppStore.setState({ simId: null, shell: null });
    applyAccent(undefined);
    set({ user: null, org: null, sims: [], templates: [], libraryLoaded: false });
  },

  refreshLibrary: async () => {
    const user = get().user;
    if (!user) return;
    const [sims, templates] = await Promise.all([platform.library.list(user), platform.library.listTemplates(user)]);
    set({ sims, templates, libraryLoaded: true });
  },

  refreshUser: async () => {
    const cur = get().user;
    if (!cur) return;
    const user = await platform.repos.getUser(cur.id);
    if (!user || !user.active) {
      await get().signOut();
      return;
    }
    const org = await platform.repos.getOrg(user.organizationId);
    applyAccent(org?.branding.accentColor);
    set({ user, org });
  },

  dismissMigration: () => set({ migration: null }),
}));

/** Kurzform für Aktionen, die einen angemeldeten Benutzer voraussetzen. */
export function currentUser(): User {
  const u = useSession.getState().user;
  if (!u) throw new Error('Nicht angemeldet.');
  return u;
}

/** Führt eine Aktion aus, meldet Fehler als Hinweis und aktualisiert danach die Bibliothek. */
export async function runAction<T>(fn: (user: User) => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> {
  const notify = useAppStore.getState().notify;
  try {
    const r = await fn(currentUser());
    await useSession.getState().refreshLibrary();
    if (success) notify(typeof success === 'function' ? success(r) : success, 'success');
    return r;
  } catch (e) {
    notify(errorMessage(e), 'warning');
    await useSession.getState().refreshLibrary().catch(() => undefined);
    return undefined;
  }
}

export { DEFAULT_USER_PREFS };
