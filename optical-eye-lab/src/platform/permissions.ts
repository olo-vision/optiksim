/**
 * Rollen & Berechtigungen.
 * Die Rollen sind technisch neutral (admin/trainer/member/guest); ihre Bezeichnung
 * richtet sich nach dem Organisationstyp (Schule: Lehrkraft/Schüler, Betrieb: Ausbilder/Mitarbeiter …).
 */
import type { OrganizationType, Role, User } from './models';

export type Permission =
  | 'users.manage'
  | 'organization.manage'
  | 'simulations.create'
  | 'simulations.viewAll'
  | 'simulations.export'
  | 'templates.create'
  | 'templates.publishOrganization'
  | 'data.manage'
  | 'settings.global';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'users.manage',
    'organization.manage',
    'simulations.create',
    'simulations.viewAll',
    'simulations.export',
    'templates.create',
    'templates.publishOrganization',
    'data.manage',
    'settings.global',
  ],
  trainer: ['simulations.create', 'simulations.export', 'templates.create', 'templates.publishOrganization'],
  member: ['simulations.create', 'simulations.export'],
  guest: ['simulations.create'],
};

/** Gäste dürfen nur eine begrenzte Zahl Simulationen anlegen (Demo). */
export const GUEST_SIMULATION_LIMIT = 5;

export function can(user: Pick<User, 'role' | 'active'> | null | undefined, permission: Permission): boolean {
  if (!user || !user.active) return false;
  return MATRIX[user.role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

const TERMS: Partial<Record<OrganizationType, Partial<Record<Role, string>>>> = {
  school: { trainer: 'Lehrkraft', member: 'Schüler/in' },
  'master-school': { trainer: 'Dozent/in', member: 'Meisterschüler/in' },
  university: { trainer: 'Dozent/in', member: 'Studierende/r' },
  business: { trainer: 'Ausbilder/in', member: 'Mitarbeiter/in' },
  'training-center': { trainer: 'Trainer/in', member: 'Teilnehmer/in' },
  industry: { trainer: 'Trainer/in', member: 'Mitarbeiter/in' },
  research: { trainer: 'Projektleitung', member: 'Mitarbeiter/in' },
};

const DEFAULT_TERMS: Record<Role, string> = {
  admin: 'Administrator/in',
  trainer: 'Trainer/in',
  member: 'Nutzer/in',
  guest: 'Gast (Demo)',
};

export function roleLabel(role: Role, orgType?: OrganizationType): string {
  return (orgType && TERMS[orgType]?.[role]) || DEFAULT_TERMS[role];
}
