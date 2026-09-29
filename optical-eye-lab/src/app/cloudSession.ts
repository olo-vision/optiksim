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
import { useSession } from './session';

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

const ROLE_MAP: Record<AppRole, Role> = { super_admin: 'admin', institution_admin: 'trainer', user: 'member' };
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
      if (useSession.getState().user) await useSession.getState().signOut();
      return;
    }
    // Benutzer, Konto und Arbeitsbereich erst gemeinsam veröffentlichen – sonst leiten Seiten, die auf
    // „angemeldet“ reagieren, mit noch unbekanntem Lizenzstatus weiter.
    const account = await cloudBackend().loadAccount(user);
    // Serverzeit übernehmen: alle Zeitprüfungen im Browser rechnen ab jetzt mit der Serverzeit
    syncServerTime(account.billing?.serverNow);
    await activateWorkspace(account);
    set({ user, account, access: accessState(account, serverDate()), error: null });
  }

  return {
    enabled: CLOUD_ENABLED,
    status: CLOUD_ENABLED ? 'loading' : 'ready',
    error: null,
    user: null,
    account: null,
    recovery: false,
    access: 'signed-out',

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
      try {
        await cloudBackend().signOut();
      } finally {
        set({ user: null, account: null, access: 'signed-out', recovery: false });
        if (useSession.getState().user) await useSession.getState().signOut();
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
      if (!u) throw translateError(new Error('Bitte melde dich an.'));
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
    if (document.visibilityState === 'visible' && useCloud.getState().user) serverCheck();
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
