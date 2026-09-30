/**
 * Anmelde- und Lizenzzustand der SaaS-Schicht (Phase 6) + Brücke zum bestehenden Arbeitsbereich.
 *
 * - Die Anmeldung (Supabase Auth) und die Lizenz (Tabelle licenses, RLS) liegen hier.
 * - Der bestehende Arbeitsbereich (Bibliothek, Einstellungen, Simulator – src/platform, LocalStorage)
 *   bleibt unverändert. Nach der Anmeldung wird ein lokaler Arbeitsbereichs-Benutzer „sb_<uuid>“ aktiviert,
 *   sodass jedes Supabase-Konto in diesem Browser seine eigenen Simulationen hat.
 * - Ob der Simulator genutzt werden darf, entscheidet ausschließlich accessState() (Lizenz aktiv bzw.
 *   Frist nach fehlgeschlagener Zahlung). Den Lizenzstatus setzt nur der Server (Stripe-Webhook/Admin).
 */
import { create } from 'zustand';
import { AUTH_MODE, CLOUD_ENABLED, configProblem, SUPABASE_KEY, SUPABASE_URL } from '@/cloud/config';
import type { CloudBackend } from '@/cloud/backend';
import { SupabaseBackend } from '@/cloud/supabaseBackend';
import { MockBackend } from '@/cloud/mockBackend';
import { translateError } from '@/cloud/errors';
import { accessState, canUseSimulator, type AccessState } from '@/cloud/access';
import { serverDate, syncServerTime } from '@/cloud/serverClock';
import type { AppRole, CloudAccount, CloudUser, InstitutionType, RegistrationInput } from '@/cloud/types';
import type { Organization, OrganizationType, Role, User } from '@/platform/models';
import { makeUser } from '@/platform/auth';
import { DEFAULT_BRANDING } from '@/platform/branding';
import { platform } from './platformInstance';
import { flushPendingPrefs, setPrefsRemote, useSession } from './session';
import { CloudContentStore } from './cloudContent';
import { LocalContentMigration, type LocalImportReport } from './cloudMigration';
import { useAppStore } from '@/state/store';

let backend: CloudBackend | null = null;
export function cloudBackend(): CloudBackend {
  if (backend) return backend;
  if (AUTH_MODE === 'mock') {
    const mock = new MockBackend();
    backend = mock;
    if (typeof window !== 'undefined') (window as unknown as { __oloMock?: unknown }).__oloMock = mock.hooks();
  } else backend = new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
  return backend;
}
/** Nur für Tests: Backend ersetzen */
export function setCloudBackend(b: CloudBackend | null) {
  backend = b;
}

/* --------------------------- Brücke zum Arbeitsbereich --------------------------- */

let contentStore: CloudContentStore | null = null;
/** Aktueller Cloud-Inhaltsspeicher (null = nicht angemeldet) */
export const cloudContentStore = () => contentStore;

/** Arbeitsbereich beim Abmelden/Kontowechsel vollständig lösen: keine Zwischenspeicher des alten Kontos */
async function detachWorkspace() {
  if (useSession.getState().user) await useSession.getState().signOut();
  platform.useContent(null);
  contentStore = null;
  setPrefsRemote(null);
  useCloud.setState({ localImport: null });
}

let migrationRun: Promise<void> | null = null;
/** Lokal gespeicherte Inhalte dieses Kontos übernehmen (im Hintergrund, wiederholbar) */
function runLocalImport() {
  const store = contentStore;
  if (!store || migrationRun) return migrationRun;
  migrationRun = (async () => {
    try {
      const report = await new LocalContentMigration(platform.repos, store, cloudBackend()).run();
      if (contentStore !== store) return;
      useCloud.setState({ localImport: report });
      const n = report.imported + report.copies;
      if (n || report.templates) {
        await useSession.getState().refreshLibrary();
        const parts = [n ? `${n} ${n === 1 ? 'Simulation' : 'Simulationen'}` : '', report.templates ? `${report.templates} ${report.templates === 1 ? 'Vorlage' : 'Vorlagen'}` : ''].filter(Boolean).join(' und ');
        useAppStore.getState().notify(`${parts} aus diesem Browser in Ihr Konto übernommen.`, 'success');
      }
    } catch {
      /* z. B. keine Verbindung – beim nächsten Laden erneut */
    } finally {
      migrationRun = null;
    }
  })();
  return migrationRun;
}

/**
 * Rolle im Arbeitsbereich. Super-Admins erhalten bewusst KEINE lokale Administratorrolle: Die Verwaltung
 * liegt im Admin-Center (/admin, serverseitig geprüft); lokal würde „alle Simulationen sehen“ sonst Inhalte
 * anderer Konten auf demselben Gerät zeigen.
 */
const ROLE_MAP: Record<AppRole, Role> = { super_admin: 'trainer', institution_admin: 'trainer', user: 'member' };
const ORG_TYPE_MAP: Record<InstitutionType, OrganizationType> = { private: 'other', business: 'business', education: 'school' };

export const workspaceUserId = (cloudUserId: string) => `sb_${cloudUserId}`;

/** Lokalen Arbeitsbereichs-Benutzer und -Organisation zum Supabase-Konto anlegen/aktualisieren und aktivieren. */
async function activateWorkspace(account: CloudAccount) {
  const p = account.profile;
  const inst = account.institution;
  if (!p || !inst) return;
  const orgId = `sb_org_${inst.id}`;
  const existingOrg = await platform.repos.getOrg(orgId);
  const org: Organization = existingOrg
    ? { ...existingOrg, name: inst.name, type: ORG_TYPE_MAP[inst.type] }
    : {
        id: orgId,
        name: inst.name,
        type: ORG_TYPE_MAP[inst.type],
        defaultRole: 'member',
        featuredTemplateIds: ['tpl-emmetropia', 'tpl-myopia', 'tpl-spectacle', 'tpl-soft-cl'],
        branding: { ...DEFAULT_BRANDING, companyName: inst.name },
        createdAt: new Date().toISOString(),
      };
  await platform.repos.saveOrg(org);
  const id = workspaceUserId(account.userId);
  const existing = await platform.repos.getUser(id);
  const user: User = existing
    ? { ...existing, firstName: p.firstName, lastName: p.lastName, displayName: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, email: p.email, role: ROLE_MAP[p.role], organizationId: org.id, active: true }
    : makeUser({ id, firstName: p.firstName, lastName: p.lastName, email: p.email, role: ROLE_MAP[p.role], organizationId: org.id });
  await platform.repos.saveUser(user);
  // Inhalte und Einstellungen dieses Kontos liegen in Supabase (0.10.0)
  if (contentStore?.identity.cloudUserId !== account.userId) {
    contentStore = new CloudContentStore(cloudBackend(), platform.repos, { cloudUserId: account.userId, workspaceUserId: id, organizationId: org.id });
    platform.useContent(contentStore);
    setPrefsRemote({ load: () => cloudBackend().getPreferences(), save: (prefs) => cloudBackend().savePreferences(prefs) });
  }
  const cur = useSession.getState().user;
  if (cur?.id === user.id) {
    useSession.setState({ user, org });
    return;
  }
  await useSession.getState().activateExternal(user);
}

/* ------------------------------------ Store ------------------------------------ */

interface CloudState {
  enabled: boolean;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  user: CloudUser | null;
  account: CloudAccount | null;
  /** Benutzer kam über den Link „Passwort zurücksetzen“ */
  recovery: boolean;
  access: AccessState;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegistrationInput) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateName: (firstName: string, lastName: string) => Promise<void>;
  /** Phase 8: Zugriff neu bewerten (Zeitablauf, z. B. Demo-Ende) – ohne Serveranfrage */
  tick: () => void;
  /** Phase 8: kostenlose Demo starten (serverseitig geprüft) und Konto neu laden */
  startDemo: (consentDocumentIds: string[]) => Promise<void>;
  /** 0.10.0: Ergebnis der Übernahme lokaler Inhalte (u. a. wartender Altbestand) */
  localImport: LocalImportReport | null;
  /** Altbestand dieses Geräts (frühere Version) nach Bestätigung in das Konto übernehmen */
  importLegacy: () => Promise<number>;
}

let initRun: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '');

export const useCloud = create<CloudState>()((set, get) => {
  /** Ladevorgänge nacheinander ausführen (Ereignis + Aktion können gleichzeitig auslösen). */
  let chain: Promise<void> = Promise.resolve();
  function load(user: CloudUser | null): Promise<void> {
    const next = chain.catch(() => undefined).then(() => doLoad(user));
    chain = next;
    return next;
  }
  /** Konto laden und Arbeitsbereich aktivieren. */
  async function doLoad(user: CloudUser | null) {
    if (!user) {
      set({ user: null, account: null, access: 'signed-out' });
      await detachWorkspace();
      return;
    }
    // Anderes Konto als bisher (z. B. Anmeldung in einem zweiten Tab) → alten Arbeitsbereich zuerst lösen
    if (contentStore && contentStore.identity.cloudUserId !== user.id) await detachWorkspace();
    // Benutzer, Konto und Arbeitsbereich erst gemeinsam veröffentlichen – sonst leiten Seiten, die auf
    // „angemeldet“ reagieren, mit noch unbekanntem Lizenzstatus weiter.
    const account = await cloudBackend().loadAccount(user);
    // Serverzeit übernehmen: alle Zeitprüfungen im Browser rechnen ab jetzt mit der Serverzeit
    syncServerTime(account.billing?.serverNow);
    await activateWorkspace(account);
    const access = accessState(account, serverDate());
    set({ user, account, access, error: null });
    // Übernahme lokaler Daten nur mit Schreibrecht (aktive Lizenz); sonst bleiben sie unverändert liegen
    if (canUseSimulator(access)) void runLocalImport();
  }

  return {
    enabled: CLOUD_ENABLED,
    status: CLOUD_ENABLED ? 'loading' : 'ready',
    error: null,
    user: null,
    account: null,
    recovery: false,
    access: 'signed-out',
    localImport: null,

    init: () => {
      if (!CLOUD_ENABLED) return Promise.resolve();
      initRun ??= (async () => {
        const problem = configProblem();
        if (problem) {
          set({ status: 'error', error: problem });
          return;
        }
        try {
          const b = cloudBackend();
          unsubscribe?.();
          unsubscribe = b.onAuthChange((event, user) => {
            if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
            if (event === 'SIGNED_OUT') void load(null);
            else if ((event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') && user && user.id !== get().user?.id) void load(user).catch((e) => set({ error: translateError(e).message }));
            // E-Mail-Änderung bestätigt: Konto neu laden (neue Adresse anzeigen)
            else if (event === 'USER_UPDATED' && user && user.email !== get().user?.email) void load(user).catch(() => undefined);
          });
          await load(await b.getUser());
          set({ status: 'ready' });
        } catch (e) {
          set({ status: 'ready', error: translateError(e).message });
        }
      })();
      return initRun;
    },

    refresh: async () => {
      const u = get().user;
      if (!u) return;
      await load(u);
    },

    signIn: async (email, password) => {
      try {
        const u = await cloudBackend().signIn(email, password);
        await load(u);
      } catch (e) {
        throw translateError(e);
      }
    },

    signUp: async (input) => {
      try {
        const r = await cloudBackend().signUp(input, `${origin()}/login?confirmed=1`);
        if (!r.needsConfirmation && r.user) await load(r.user);
        return { needsConfirmation: r.needsConfirmation };
      } catch (e) {
        throw translateError(e);
      }
    },

    signOut: async () => {
      // Offene Einstellungen noch mit der gültigen Sitzung speichern
      await flushPendingPrefs().catch(() => undefined);
      try {
        await cloudBackend().signOut();
      } finally {
        set({ user: null, account: null, access: 'signed-out', recovery: false });
        await detachWorkspace();
      }
    },

    importLegacy: async () => {
      const store = contentStore;
      if (!store) return 0;
      try {
        const r = await new LocalContentMigration(platform.repos, store, cloudBackend()).importLegacy();
        await useSession.getState().refreshLibrary();
        const cur = get().localImport;
        if (cur) set({ localImport: { ...cur, legacyPending: r.failed } });
        return r.imported;
      } catch (e) {
        throw translateError(e);
      }
    },

    requestPasswordReset: async (email) => {
      try {
        await cloudBackend().requestPasswordReset(email, `${origin()}/reset-password`);
      } catch (e) {
        throw translateError(e);
      }
    },

    updatePassword: async (password) => {
      try {
        await cloudBackend().updatePassword(password);
        set({ recovery: false });
      } catch (e) {
        throw translateError(e);
      }
    },

    tick: () => {
      const { account, access } = get();
      if (!account) return;
      const next = accessState(account, serverDate());
      if (next !== access) set({ access: next });
    },

    startDemo: async (consentDocumentIds) => {
      const u = get().user;
      if (!u) throw translateError(new Error('Bitte melden Sie sich an.'));
      try {
        const r = await cloudBackend().startDemo(consentDocumentIds);
        syncServerTime(r.serverNow);
        await load(u);
      } catch (e) {
        throw translateError(e);
      }
    },

    updateName: async (firstName, lastName) => {
      const u = get().user;
      if (!u) return;
      try {
        await cloudBackend().updateProfileName(u.id, firstName, lastName);
        await load(u);
      } catch (e) {
        throw translateError(e);
      }
    },
  };
});

/**
 * Zugriff laufend überwachen (einmal in der App eingebunden):
 *  - jede Sekunde während einer Demo (Anzeige + sofortige Sperre bei Ablauf), sonst alle 30 s lokal neu bewerten
 *  - während einer Demo zusätzlich jede Minute und beim Zurückkehren in den Tab den Server fragen
 *    (maßgeblich ist valid_until in der Datenbank – der Browser kann die Zeit nicht verlängern)
 */
export function startAccessWatch(): () => void {
  if (!CLOUD_ENABLED || typeof window === 'undefined') return () => undefined;
  let lastServerCheck = Date.now();
  const serverCheck = () => {
    lastServerCheck = Date.now();
    void useCloud.getState().refresh().catch(() => undefined);
  };
  const timer = window.setInterval(() => {
    const st = useCloud.getState();
    const demo = st.access === 'demo';
    st.tick();
    if (demo && Date.now() - lastServerCheck > 60_000) serverCheck();
  }, 1000);
  const onVisible = () => {
    if (document.visibilityState === 'visible' && useCloud.getState().user) {
      serverCheck();
      // Änderungen anderer Geräte übernehmen
      contentStore?.invalidate();
      void useSession.getState().refreshLibrary();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Darf der Simulator (Dashboard, Module, Simulationen) genutzt werden? Lokaler Modus: immer. */
export function useSimulatorAccess(): { allowed: boolean; state: AccessState | 'local' } {
  const enabled = useCloud((s) => s.enabled);
  const access = useCloud((s) => s.access);
  if (!enabled) return { allowed: true, state: 'local' };
  return { allowed: canUseSimulator(access), state: access };
}
