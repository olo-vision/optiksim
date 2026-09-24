/**
 * Authentifizierung – Abstraktion + lokale Demo-Implementierung.
 *
 * `AuthProvider` ist die Schnittstelle, gegen die die Oberfläche programmiert ist.
 * Heute existiert nur `LocalAuthProvider` (Produkt-Demo, KEINE echte Kontosicherheit):
 * Konten und Sitzung liegen im LocalStorage dieses Browsers.
 * Später vorgesehen (nicht implementiert): SupabaseAuthProvider, ClerkAuthProvider,
 * EnterpriseSSOProvider – sie implementieren dieselbe Schnittstelle.
 */
import { createId } from '@/core/ids';
import type { Organization, OrganizationType, Role, Session, User } from './models';
import type { Repositories } from './repositories';
import { isValidEmail, makeCredential, MIN_PASSWORD_LENGTH, normalizeEmail, verifyCredential } from './demoCredentials';
import { DEFAULT_BRANDING } from './branding';

export interface AuthCapabilities {
  /** Echte, serverseitig geprüfte Anmeldung */
  secure: boolean;
  emailVerification: boolean;
  passwordReset: boolean;
  sso: boolean;
}

export interface SignUpInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  organizationName?: string;
  organizationType?: OrganizationType;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly field?: 'email' | 'password' | 'firstName' | 'lastName' | 'organizationName',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthProvider {
  readonly kind: string;
  readonly label: string;
  readonly capabilities: AuthCapabilities;
  /** Aktuelle Sitzung → Benutzer (oder null) */
  restore(): Promise<User | null>;
  signIn(email: string, password: string): Promise<User>;
  signUp(input: SignUpInput): Promise<User>;
  /** Gastzugang ohne Konto („Demo starten“) */
  signInAsGuest(): Promise<User>;
  signOut(): Promise<void>;
  /** Auf diesem Gerät bekannte Konten (für „Benutzer wechseln“) */
  knownAccounts(): Promise<User[]>;
  /** Passwort ändern (lokal) */
  changePassword(userId: string, current: string, next: string): Promise<void>;
}

export const GUEST_USER_ID = 'user_guest';
const AVATAR_COLORS = ['#4cc2ff', '#45d6a0', '#ffb547', '#c38bff', '#ff8a80', '#5ad1c9', '#f2a1d0', '#9fb4ff'];

export const pickAvatarColor = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

export function makeUser(p: Pick<User, 'firstName' | 'lastName' | 'email' | 'role'> & Partial<User>): User {
  const firstName = p.firstName.trim();
  const lastName = p.lastName.trim();
  return {
    id: p.id ?? createId('user'),
    displayName: p.displayName?.trim() || [firstName, lastName].filter(Boolean).join(' ') || p.email,
    avatarColor: p.avatarColor ?? pickAvatarColor(p.email + firstName),
    language: 'de',
    active: true,
    createdAt: new Date().toISOString(),
    ...p,
    firstName,
    lastName,
    email: normalizeEmail(p.email),
  };
}

export class LocalAuthProvider implements AuthProvider {
  readonly kind = 'local';
  readonly label = 'Lokale Demo-Anmeldung';
  readonly capabilities: AuthCapabilities = { secure: false, emailVerification: false, passwordReset: false, sso: false };

  constructor(private repos: Repositories) {}

  private async startSession(user: User): Promise<User> {
    const now = new Date().toISOString();
    const updated = { ...user, lastLoginAt: now };
    await this.repos.saveUser(updated);
    const session: Session = { userId: user.id, provider: this.kind, issuedAt: now };
    await this.repos.saveSession(session);
    await this.repos.pushRecentUser(user.id);
    return updated;
  }

  async restore() {
    const s = await this.repos.getSession();
    if (!s) return null;
    const u = await this.repos.getUser(s.userId);
    if (!u || !u.active) {
      await this.repos.clearSession();
      return null;
    }
    return u;
  }

  async signIn(emailRaw: string, password: string) {
    const email = normalizeEmail(emailRaw);
    if (!email) throw new AuthError('Bitte E-Mail-Adresse eingeben.', 'email');
    const users = await this.repos.listUsers();
    const user = users.find((u) => u.email === email);
    const cred = (await this.repos.listCredentials()).find((c) => c.email === email);
    if (!user || !cred || !(await verifyCredential(cred, password))) throw new AuthError('E-Mail oder Passwort ist nicht korrekt.', 'password');
    if (!user.active) throw new AuthError('Dieses Konto wurde deaktiviert. Bitte wende dich an die Administration.');
    return this.startSession(user);
  }

  async signUp(input: SignUpInput) {
    const email = normalizeEmail(input.email);
    if (!input.firstName.trim()) throw new AuthError('Bitte Vornamen eingeben.', 'firstName');
    if (!isValidEmail(email)) throw new AuthError('Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
    if (input.password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`, 'password');
    const users = await this.repos.listUsers();
    if (users.some((u) => u.email === email)) throw new AuthError('Für diese E-Mail-Adresse existiert auf diesem Gerät bereits ein Konto.', 'email');

    const meta = await this.repos.getMeta();
    const realUsers = users.filter((u) => !u.isDemo && u.role !== 'guest');
    let org: Organization | null = await this.repos.getOrg(meta?.primaryOrgId);
    let role: Role;
    if (!realUsers.length || !org) {
      // Erstes echtes Konto: legt die Organisation dieser Installation an und wird Administrator/in.
      const orgName = input.organizationName?.trim() || 'Meine Organisation';
      org = {
        id: createId('org'),
        name: orgName,
        type: input.organizationType ?? 'other',
        defaultRole: 'member',
        featuredTemplateIds: ['tpl-emmetropia', 'tpl-myopia', 'tpl-spectacle', 'tpl-soft-cl'],
        branding: { ...DEFAULT_BRANDING, companyName: orgName },
        createdAt: new Date().toISOString(),
      };
      await this.repos.saveOrg(org);
      if (meta) await this.repos.saveMeta({ ...meta, primaryOrgId: org.id });
      role = 'admin';
    } else {
      role = org.defaultRole === 'admin' ? 'member' : org.defaultRole;
    }
    const user = makeUser({ firstName: input.firstName, lastName: input.lastName, email, role, organizationId: org.id });
    await this.repos.saveUser(user);
    await this.repos.saveCredential(await makeCredential(user.id, email, input.password));
    return this.startSession(user);
  }

  async signInAsGuest() {
    let guest = await this.repos.getUser(GUEST_USER_ID);
    if (!guest) {
      const meta = await this.repos.getMeta();
      guest = makeUser({
        id: GUEST_USER_ID,
        firstName: 'Gast',
        lastName: '',
        displayName: 'Gast',
        email: 'gast@local',
        role: 'guest',
        organizationId: meta?.primaryOrgId,
        avatarColor: '#8a96a6',
      });
      await this.repos.saveUser(guest);
    }
    if (!guest.active) throw new AuthError('Der Gastzugang wurde von der Administration deaktiviert.');
    return this.startSession(guest);
  }

  async signOut() {
    await this.repos.clearSession();
  }

  async knownAccounts() {
    const ids = await this.repos.getRecentUserIds();
    const users = await this.repos.listUsers();
    const byId = new Map(users.map((u) => [u.id, u]));
    const recent = ids.map((id) => byId.get(id)).filter((u): u is User => !!u && u.active && u.role !== 'guest');
    return recent;
  }

  async changePassword(userId: string, current: string, next: string) {
    const cred = (await this.repos.listCredentials()).find((c) => c.userId === userId);
    if (!cred) throw new AuthError('Für dieses Konto ist kein Passwort hinterlegt.');
    if (!(await verifyCredential(cred, current))) throw new AuthError('Das aktuelle Passwort ist nicht korrekt.', 'password');
    if (next.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`, 'password');
    await this.repos.saveCredential(await makeCredential(userId, cred.email, next));
  }
}
