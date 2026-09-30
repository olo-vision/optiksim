/**
 * Sitzungszustand der Anwendung: angemeldeter Benutzer, Organisation, Bibliothek, Vorlagen.
 * Einstellungen liegen (als einzige Quelle) in `useAppStore.prefs` und werden hier je Benutzer
 * geladen bzw. gespeichert.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { platform } from './platformInstance';
import { configureStoreHooks, useAppStore } from '@/state/store';
import type { Organization, SimulationMetadata, Template, User } from '@/platform/models';
import type { SignUpInput } from '@/platform/auth';
import type { MigrationReport } from '@/platform/migration';
import { applyAccent } from '@/platform/branding';
import { DEFAULT_USER_PREFS, type UserPreferences } from '@/platform/preferences';
import { StorageQuotaError } from '@/platform/storage';
import { CLOUD_ENABLED } from '@/cloud/config';
import { CloudError } from '@/cloud/types';
import { translateError } from '@/cloud/errors';
import { mergePrefs, syncedPrefs, type PrefsRemote } from './cloudPrefs';

interface SessionState {
  status: 'booting' | 'ready' | 'error';
  bootError: string | null;
  user: User | null;
  org: Organization | null;
  sims: SimulationMetadata[];
  templates: Template[];
  libraryLoaded: boolean;
  /** Bibliothek konnte nicht geladen werden (z. B. keine Verbindung) */
  libraryError: string | null;
  /** Ergebnis der einmaligen Datenübernahme aus Phase 1/2 (nur beim ersten Start) */
  migration: MigrationReport | null;
  /** Speicher nicht dauerhaft (LocalStorage gesperrt) */
  volatile: boolean;

  boot: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: SignUpInput) => Promise<User>;
  signInAsGuest: () => Promise<User>;
  /** Arbeitsbereich für einen extern (Supabase) angemeldeten Benutzer aktivieren – ohne lokale Anmeldung */
  activateExternal: (user: User) => Promise<User>;
  signOut: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  /** eine gespeicherte Simulation in der Liste aktualisieren/ergänzen (ohne Serveranfrage) */
  upsertSimMeta: (meta: SimulationMetadata) => void;
  refreshUser: () => Promise<void>;
  dismissMigration: () => void;
}

let prefsTimer: number | undefined;
/** Noch nicht geschriebene Einstellungen (entprellt) – werden beim Verlassen der Seite sofort gesichert. */
let pendingPrefs: { userId: string; prefs: UserPreferences } | null = null;

/** Cloud-Modus: Einstellungen zusätzlich im Konto speichern (kontobezogener Anteil) */
let prefsRemote: PrefsRemote | null = null;
let remoteTimer: number | undefined;
let pendingRemote: UserPreferences | null = null;
let lastRemoteKey = '';

/** Vom Cloud-Modus vor der Aktivierung des Arbeitsbereichs gesetzt (null = nur lokal) */
export function setPrefsRemote(r: PrefsRemote | null, opts: { discard?: boolean } = {}) {
  // beim Kontowechsel NICHT mehr senden (die Sitzung gehört evtl. schon einem anderen Konto)
  if (opts.discard) {
    window.clearTimeout(remoteTimer);
    pendingRemote = null;
  } else void flushRemotePrefs();
  prefsRemote = r;
}

function flushRemotePrefs(): Promise<void> {
  window.clearTimeout(remoteTimer);
  const p = pendingRemote;
  pendingRemote = null;
  // Fehler (z. B. offline) nicht melden: das Gerät behält den Stand, der nächste Speichervorgang holt ihn nach
  if (p && prefsRemote) return prefsRemote.save(syncedPrefs(p)).catch(() => undefined);
  return Promise.resolve();
}

/** Ausstehende Einstellungen sofort speichern (vor dem Abmelden) */
export function flushPendingPrefs(): Promise<void> {
  window.clearTimeout(prefsTimer);
  const p = pendingPrefs;
  pendingPrefs = null;
  const local = p ? platform.savePrefs(p.userId, p.prefs).catch(() => undefined) : Promise.resolve();
  return Promise.all([local, flushRemotePrefs()]).then(() => undefined);
}

function flushPrefs() {
  window.clearTimeout(prefsTimer);
  const p = pendingPrefs;
  pendingPrefs = null;
  // LocalStorageProvider schreibt synchron im ersten Schritt – auch in „pagehide“ zuverlässig
  if (p) platform.savePrefs(p.userId, p.prefs).catch((e) => useAppStore.getState().notify(errorMessage(e), 'warning'));
  void flushRemotePrefs();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPrefs);
  window.addEventListener('beforeunload', flushPrefs);
}

/** Fehlermeldung für die Oberfläche */
export function errorMessage(e: unknown): string {
  if (e instanceof StorageQuotaError) return 'Der lokale Speicher des Browsers ist voll. Bitte löschen Sie nicht mehr benötigte Simulationen oder exportieren Sie sie als Datei.';
  if (e instanceof CloudError) return e.message;
  // eigene (deutsche) Fehlermeldungen der Anwendung
  if (e instanceof Error && e.message && (e.constructor === Error || /Error$/.test(e.constructor.name)) && !['TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'DOMException', 'AbortError'].includes(e.name) && !/^Auth|Postgrest|Functions/.test(e.name)) return e.message;
  // technische Fehler (Netzwerk, Supabase, JavaScript) → verständliche deutsche Meldung
  return translateError(e).message;
}

async function activate(user: User) {
  const [org, devicePrefs] = await Promise.all([platform.repos.getOrg(user.organizationId), platform.loadPrefs(user.id)]);
  let prefs = devicePrefs;
  const remote = prefsRemote;
  lastRemoteKey = '';
  if (remote) {
    try {
      const account = await remote.load();
      if (account) prefs = mergePrefs(devicePrefs, account);
      // Erstes Gerät nach der Umstellung: bisherige Einstellungen in das Konto übernehmen
      else void remote.save(syncedPrefs(devicePrefs)).catch(() => undefined);
    } catch {
      /* keine Verbindung: Einstellungen dieses Geräts verwenden */
    }
  }
  useAppStore.getState().applyUserPrefs(prefs);
  lastRemoteKey = JSON.stringify(syncedPrefs(prefs));
  configureStoreHooks({
    persistPrefs: (p: UserPreferences) => {
      pendingPrefs = { userId: user.id, prefs: p };
      window.clearTimeout(prefsTimer);
      prefsTimer = window.setTimeout(flushPrefs, 250);
      if (prefsRemote) {
        // nur senden, wenn sich der kontobezogene Anteil geändert hat (Panelbreite o. ä. bleibt lokal)
        const key = JSON.stringify(syncedPrefs(p));
        if (key === lastRemoteKey) return;
        lastRemoteKey = key;
        pendingRemote = p;
        window.clearTimeout(remoteTimer);
        remoteTimer = window.setTimeout(flushRemotePrefs, 1000);
      }
    },
  });
  applyAccent(org?.branding.accentColor);
  useSession.setState({ user, org, sims: [], templates: [], libraryLoaded: false, libraryError: null });
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
  libraryError: null,
  migration: null,
  volatile: false,

  boot: async () => {
    try {
      // SaaS-Modus: keine lokalen Demo-Konten/-Simulationen anlegen (Inhalte liegen im Kundenkonto)
      const res = await platform.init({ seedDemo: !CLOUD_ENABLED });
      const volatile = (platform.storage as { volatile?: boolean }).volatile === true;
      set({ migration: res.migration, volatile });
      // SaaS-Modus: Die Anmeldung stammt aus Supabase (cloudSession) – keine lokale Sitzung wiederherstellen
      if (!CLOUD_ENABLED) {
        const user = await platform.auth.restore();
        if (user) await activate(user);
      }
      set({ status: 'ready' });
    } catch (e) {
      set({ status: 'error', bootError: errorMessage(e) });
    }
  },

  signIn: async (email, password) => activate(await platform.auth.signIn(email, password)),
  signUp: async (input) => activate(await platform.auth.signUp(input)),
  signInAsGuest: async () => activate(await platform.auth.signInAsGuest()),
  activateExternal: async (user) => activate(user),

  signOut: async () => {
    flushPrefs();
    if (!CLOUD_ENABLED) await platform.auth.signOut();
    configureStoreHooks({ persistPrefs: undefined, save: undefined, writeDraft: undefined });
    useAppStore.getState().applyUserPrefs(DEFAULT_USER_PREFS);
    useAppStore.setState({ simId: null, shell: null });
    applyAccent(undefined);
    set({ user: null, org: null, sims: [], templates: [], libraryLoaded: false, libraryError: null });
  },

  refreshLibrary: async () => {
    const user = get().user;
    if (!user) return;
    try {
      const [sims, templates] = await Promise.all([platform.library.list(user), platform.library.listTemplates(user)]);
      // Inzwischen abgemeldet/gewechselt? Dann das Ergebnis verwerfen.
      if (get().user?.id !== user.id) return;
      set({ sims, templates, libraryLoaded: true, libraryError: null });
    } catch (e) {
      if (get().user?.id !== user.id) return;
      set({ libraryLoaded: true, libraryError: errorMessage(e) });
    }
  },

  upsertSimMeta: (meta) =>
    set((st) => ({ sims: st.sims.some((m) => m.id === meta.id) ? st.sims.map((m) => (m.id === meta.id ? meta : m)) : [meta, ...st.sims] })),

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

/** Seiten mit Simulationsliste: beim Öffnen aktuellen Stand laden (Änderungen anderer Geräte, zuletzt geöffnet) */
export function useLibraryRefreshOnMount() {
  useEffect(() => {
    void useSession.getState().refreshLibrary();
  }, []);
}
