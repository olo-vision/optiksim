/**
 * Benutzer- und Organisationsverwaltung (lokal).
 */
import type { Organization, Role, User } from './models';
import type { Repositories } from './repositories';
import { can } from './permissions';
import { AuthError, makeUser } from './auth';
import { isValidEmail, makeCredential, MIN_PASSWORD_LENGTH, normalizeEmail } from './demoCredentials';
import { isValidHex } from './branding';

export type ProfilePatch = Partial<Pick<User, 'firstName' | 'lastName' | 'displayName' | 'jobTitle' | 'trainingStatus' | 'department' | 'avatarDataUrl' | 'avatarColor' | 'language'>>;

export interface NewUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  password: string;
  jobTitle?: string;
  department?: string;
}

export class AccountService {
  constructor(private repos: Repositories) {}

  private assertAdmin(actor: User, perm: 'users.manage' | 'organization.manage' = 'users.manage') {
    if (!can(actor, perm)) throw new AuthError('Für diese Aktion sind Administrationsrechte nötig.');
  }

  private async activeAdmins(except?: string) {
    return (await this.repos.listUsers()).filter((u) => u.role === 'admin' && u.active && u.id !== except);
  }

  /** Eigenes Profil bearbeiten (jede Rolle) */
  async updateProfile(user: User, patch: ProfilePatch): Promise<User> {
    const cur = await this.repos.getUser(user.id);
    if (!cur) throw new AuthError('Konto nicht gefunden.');
    const next: User = { ...cur, ...patch };
    next.firstName = next.firstName.trim();
    next.lastName = next.lastName.trim();
    if (!next.firstName) throw new AuthError('Der Vorname darf nicht leer sein.', 'firstName');
    const namesChanged = patch.firstName !== undefined || patch.lastName !== undefined;
    next.displayName = patch.displayName?.trim() || (namesChanged || !cur.displayName ? [next.firstName, next.lastName].filter(Boolean).join(' ') : cur.displayName);
    if (next.avatarDataUrl && next.avatarDataUrl.length > 400_000) throw new AuthError('Das Profilbild ist zu groß (max. ca. 300 KB).');
    return this.repos.saveUser(next);
  }

  async listUsers(actor: User): Promise<User[]> {
    this.assertAdmin(actor);
    return this.repos.listUsers();
  }

  async createUser(actor: User, input: NewUserInput): Promise<User> {
    this.assertAdmin(actor);
    const email = normalizeEmail(input.email);
    if (!input.firstName.trim()) throw new AuthError('Bitte Vornamen eingeben.', 'firstName');
    if (!isValidEmail(email)) throw new AuthError('Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
    if (input.password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Das Start-Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`, 'password');
    if ((await this.repos.listUsers()).some((u) => u.email === email)) throw new AuthError('Diese E-Mail-Adresse ist bereits vergeben.', 'email');
    const u = makeUser({
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      role: input.role,
      organizationId: actor.organizationId,
      jobTitle: input.jobTitle?.trim() || undefined,
      department: input.department?.trim() || undefined,
    });
    await this.repos.saveUser(u);
    await this.repos.saveCredential(await makeCredential(u.id, email, input.password));
    return u;
  }

  async updateUser(actor: User, id: string, patch: Partial<Pick<User, 'firstName' | 'lastName' | 'displayName' | 'role' | 'jobTitle' | 'department' | 'organizationId'>>): Promise<User> {
    this.assertAdmin(actor);
    const cur = await this.repos.getUser(id);
    if (!cur) throw new AuthError('Konto nicht gefunden.');
    if (patch.role && patch.role !== 'admin' && cur.role === 'admin' && !(await this.activeAdmins(id)).length)
      throw new AuthError('Es muss mindestens eine aktive Administratorin / ein aktiver Administrator bleiben.');
    const next = { ...cur, ...patch };
    next.displayName = patch.displayName?.trim() || (patch.firstName !== undefined || patch.lastName !== undefined ? [next.firstName, next.lastName].filter(Boolean).join(' ') : cur.displayName);
    return this.repos.saveUser(next);
  }

  async setActive(actor: User, id: string, active: boolean): Promise<User> {
    this.assertAdmin(actor);
    if (id === actor.id && !active) throw new AuthError('Du kannst dein eigenes Konto nicht deaktivieren.');
    const cur = await this.repos.getUser(id);
    if (!cur) throw new AuthError('Konto nicht gefunden.');
    if (!active && cur.role === 'admin' && !(await this.activeAdmins(id)).length)
      throw new AuthError('Es muss mindestens eine aktive Administratorin / ein aktiver Administrator bleiben.');
    return this.repos.saveUser({ ...cur, active });
  }

  async resetPassword(actor: User, id: string, password: string) {
    this.assertAdmin(actor);
    const u = await this.repos.getUser(id);
    if (!u) throw new AuthError('Konto nicht gefunden.');
    if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`, 'password');
    await this.repos.saveCredential(await makeCredential(u.id, u.email, password));
  }

  async updateOrganization(actor: User, id: string, patch: Partial<Omit<Organization, 'id' | 'createdAt'>>): Promise<Organization> {
    this.assertAdmin(actor, 'organization.manage');
    const cur = await this.repos.getOrg(id);
    if (!cur) throw new AuthError('Organisation nicht gefunden.');
    const next: Organization = { ...cur, ...patch, branding: { ...cur.branding, ...(patch.branding ?? {}) } };
    if (!next.name.trim()) throw new AuthError('Der Name der Organisation darf nicht leer sein.');
    if (!isValidHex(next.branding.accentColor)) throw new AuthError('Die Akzentfarbe muss als Hex-Wert angegeben werden (z. B. #4cc2ff).');
    if (next.branding.logoDataUrl && next.branding.logoDataUrl.length > 400_000) throw new AuthError('Das Logo ist zu groß (max. ca. 300 KB).');
    if (next.defaultRole === 'admin') next.defaultRole = 'member';
    return this.repos.saveOrg(next);
  }
}
