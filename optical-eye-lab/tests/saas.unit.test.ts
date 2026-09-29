/**
 * Phase 6 – SaaS-Schicht (Unit): Tarife, Lizenzprüfung, Registrierungsdaten, Konfiguration,
 * Fehlermeldungen, Supabase-Anbindung (mit Test-Client), Mock-Backend, Stripe-Statusabbildung.
 */
import { describe, expect, it, vi } from 'vitest';
import { PLANS, licenseLabel, planInfo } from '@/cloud/plans';
import { accessState, hasActiveLicense, isSuperAdmin } from '@/cloud/access';
import { registrationMetadata, validateRegistration } from '@/cloud/validation';
import { configProblem } from '@/cloud/config';
import { translateError } from '@/cloud/errors';
import { SupabaseBackend } from '@/cloud/supabaseBackend';
import { MockBackend } from '@/cloud/mockBackend';
import { CloudError, type CloudAccount, type RegistrationInput } from '@/cloud/types';
import { licenseStatusFromStripe } from '../supabase/functions/_shared/licenseStatus';

const reg = (p: Partial<RegistrationInput> = {}): RegistrationInput => ({
  firstName: 'Anna',
  lastName: 'Auge',
  email: 'anna@optik.de',
  password: 'Geheim123',
  passwordConfirm: 'Geheim123',
  institutionType: 'business',
  institutionName: 'Optik Auge GmbH',
  addressLine1: 'Hauptstr. 1',
  postalCode: '10115',
  city: 'Berlin',
  country: 'DE',
  ...p,
});

const account = (status: string | null, extra: Partial<CloudAccount['license']> = {}): CloudAccount => ({
  userId: 'u1',
  email: 'a@b.de',
  profile: { id: 'p', userId: 'u1', institutionId: 'i', firstName: 'A', lastName: 'B', email: 'a@b.de', role: 'institution_admin', createdAt: '' },
  institution: { id: 'i', type: 'business', name: 'X', contactName: null, addressLine1: null, addressLine2: null, postalCode: null, city: null, country: 'DE' },
  license: status ? { id: 'l', institutionId: 'i', plan: 'business', status: status as never, validFrom: null, validUntil: null, maxLocations: 1, ...extra } : null,
});

describe('Tarife', () => {
  it('genau drei Tarife mit den festgelegten Preisen', () => {
    expect(PLANS.map((p) => [p.id, p.priceCents, p.priceLabel])).toEqual([
      ['private', 1990, '19,90 €'],
      ['business', 3990, '39,90 €'],
      ['education', 9990, '99,90 €'],
    ]);
    expect(planInfo('business')!.locationNote).toBe('Lizenz gilt für einen Betriebsstandort.');
    expect(planInfo('education')!.locationNote).toBe('Lizenz gilt für einen Bildungsstandort.');
  });
  it('Lizenzbezeichnungen laut Vorgabe', () => {
    expect(licenseLabel('business')).toBe('Business-Lizenz – 1 Betriebsstandort');
    expect(licenseLabel('education')).toBe('Education-Lizenz – 1 Bildungsstandort');
    expect(licenseLabel('private')).toBe('Private-Lizenz');
  });
});

describe('Lizenzprüfung (Zugang zum Simulator)', () => {
  it('nur status = active schaltet frei', () => {
    expect(accessState(null)).toBe('signed-out');
    expect(accessState({ ...account('active'), profile: null })).toBe('no-profile');
    expect(accessState({ ...account('active'), institution: null })).toBe('no-institution');
    expect(accessState(account(null))).toBe('no-license');
    for (const s of ['pending', 'past_due', 'suspended', 'expired', 'cancelled']) expect(hasActiveLicense(account(s)), s).toBe(false);
    expect(hasActiveLicense(account('active'))).toBe(true);
  });
  it('Gültigkeitszeitraum wird beachtet', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(accessState(account('active', { validUntil: '2026-09-30T00:00:00Z' }), now)).toBe('expired');
    expect(accessState(account('active', { validFrom: '2026-11-01T00:00:00Z' }), now)).toBe('not-yet-valid');
    expect(accessState(account('active', { validUntil: '2027-01-01T00:00:00Z' }), now)).toBe('active');
  });
  it('Super-Admin nur über die Rolle aus der Datenbank', () => {
    expect(isSuperAdmin(account('active'))).toBe(false);
    const a = account('active');
    a.profile!.role = 'super_admin';
    expect(isSuperAdmin(a)).toBe(true);
  });
});

describe('Registrierungsdaten', () => {
  it('Pflichtfelder und Passwortregeln', () => {
    expect(() => validateRegistration(reg())).not.toThrow();
    const field = (p: Partial<RegistrationInput>) => {
      try {
        validateRegistration(reg(p));
        return null;
      } catch (e) {
        return (e as CloudError).field;
      }
    };
    expect(field({ firstName: ' ' })).toBe('firstName');
    expect(field({ email: 'kein-mail' })).toBe('email');
    expect(field({ password: 'kurz1', passwordConfirm: 'kurz1' })).toBe('password');
    expect(field({ password: 'nurbuchstaben', passwordConfirm: 'nurbuchstaben' })).toBe('password');
    expect(field({ passwordConfirm: 'Anders123' })).toBe('passwordConfirm');
    expect(field({ institutionName: '' })).toBe('institutionName');
    expect(field({ institutionType: 'education', institutionName: '' })).toBe('institutionName');
    expect(field({ institutionType: 'private', institutionName: '' })).toBeNull();
    // Phase 8: B2B braucht die Rechnungsanschrift; Privatkunden nicht
    expect(field({ addressLine1: '' })).toBe('addressLine1');
    expect(field({ postalCode: ' ' })).toBe('postalCode');
    expect(field({ city: '' })).toBe('city');
    expect(field({ country: '' })).toBe('country');
    expect(field({ vatId: 'kein!' })).toBe('vatId');
    expect(field({ vatId: 'DE 123 456 789' })).toBeNull();
    expect(field({ institutionType: 'private', addressLine1: '', postalCode: '', city: '', country: '' })).toBeNull();
  });
  it('Metadaten enthalten nur Stammdaten – nie Rolle oder Lizenzstatus', () => {
    const m = registrationMetadata(reg({ contactName: 'Anna Auge', city: 'Berlin', postalCode: '10115' }));
    expect(m).toEqual({ first_name: 'Anna', last_name: 'Auge', institution_type: 'business', institution_name: 'Optik Auge GmbH', contact_name: 'Anna Auge', address_line_1: 'Hauptstr. 1', postal_code: '10115', city: 'Berlin', country: 'DE' });
    expect(Object.keys(m).some((k) => /role|status|plan|license/.test(k))).toBe(false);
    // Privat: keine Firmendaten
    expect(registrationMetadata(reg({ institutionType: 'private', city: 'Berlin' }))).toEqual({ first_name: 'Anna', last_name: 'Auge', institution_type: 'private' });
    // Phase 8: USt-IdNr./Position und die IDs der zugestimmten Rechtstext-Versionen (dedupliziert)
    const b2b = registrationMetadata(reg({ vatId: ' DE123456789 ', contactPosition: 'Inhaberin', consentDocumentIds: ['a', 'b', 'a'] }));
    expect(b2b.vat_id).toBe('DE123456789');
    expect(b2b.contact_position).toBe('Inhaberin');
    expect(b2b.legal_consents).toEqual(['a', 'b']);
    expect(registrationMetadata(reg({ institutionType: 'private', vatId: 'DE1' }))).not.toHaveProperty('vat_id');
  });
});

describe('Konfiguration', () => {
  it('lehnt geheime Schlüssel im Frontend ab', () => {
    expect(configProblem('https://x.supabase.co', 'sb_publishable_abc', 'supabase')).toBeNull();
    expect(configProblem('', '', 'supabase')).toMatch(/nicht gesetzt/);
    expect(configProblem('https://x.supabase.co', 'sb_secret_abc', 'supabase')).toMatch(/geheimer/);
    const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
    expect(configProblem('https://x.supabase.co', jwt('service_role'), 'supabase')).toMatch(/service_role/);
    expect(configProblem('https://x.supabase.co', jwt('anon'), 'supabase')).toBeNull();
    expect(configProblem('', '', 'local')).toBeNull();
  });
});

describe('Fehlermeldungen', () => {
  it('Supabase-Fehler werden verständlich übersetzt', () => {
    expect(translateError({ code: 'invalid_credentials', message: 'Invalid login credentials' }).message).toBe('E-Mail oder Passwort ist nicht korrekt.');
    expect(translateError({ code: 'user_already_exists' }).field).toBe('email');
    expect(translateError({ message: 'Email not confirmed' }).message).toMatch(/bestätige/);
    expect(translateError({ status: 429, message: 'x' }).message).toMatch(/Zu viele/);
    expect(translateError({ message: 'Database error saving new user' }).message).toMatch(/Migrationen/);
  });
});

/* ------------------------- Supabase-Anbindung mit Test-Client ------------------------- */

function fakeClient(opts: { signUp?: unknown; rows?: Record<string, unknown> } = {}) {
  const calls: Array<[string, unknown]> = [];
  const q = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'update']) b[m] = (...a: unknown[]) => (calls.push([`${table}.${m}`, a]), b);
    b.maybeSingle = async () => ({ data: opts.rows?.[table] ?? null, error: null });
    b.then = (res: (v: unknown) => void) => res({ error: null });
    return b;
  };
  const client = {
    auth: {
      signUp: vi.fn(async (a: unknown) => (calls.push(['signUp', a]), opts.signUp ?? { data: { user: { id: 'u1', email: 'anna@optik.de', identities: [{}] }, session: null }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'anna@optik.de' } }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => undefined } } })),
      resetPasswordForEmail: vi.fn(async (e: string, o: unknown) => (calls.push(['reset', [e, o]]), { error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
    from: (t: string) => q(t),
    rpc: vi.fn(async (name: string, args?: unknown) => (calls.push(['rpc', [name, args]]), { data: [], error: null })),
    functions: { invoke: vi.fn(async () => ({ data: { url: 'https://checkout' }, error: null })) },
  };
  return { client, calls };
}

describe('SupabaseBackend', () => {
  it('Registrierung: Metadaten, Bestätigungs-Link, E-Mail-Bestätigung erkannt', async () => {
    const { client, calls } = fakeClient();
    const b = new SupabaseBackend('https://x.supabase.co', 'k', client as never);
    const r = await b.signUp(reg(), 'http://localhost:5173/login?confirmed=1');
    expect(r.needsConfirmation).toBe(true);
    const arg = calls.find((c) => c[0] === 'signUp')![1] as { email: string; options: { data: Record<string, string>; emailRedirectTo: string } };
    expect(arg.email).toBe('anna@optik.de');
    expect(arg.options.data.institution_type).toBe('business');
    expect(arg.options.emailRedirectTo).toContain('/login?confirmed=1');
  });
  it('Registrierung mit existierender E-Mail (keine Identitäten) → Fehler', async () => {
    const { client } = fakeClient({ signUp: { data: { user: { id: 'u', identities: [] }, session: null }, error: null } });
    await expect(new SupabaseBackend('u', 'k', client as never).signUp(reg(), 'x')).rejects.toThrow(/existiert bereits/);
  });
  it('ungültige Eingaben erreichen Supabase nicht', async () => {
    const { client } = fakeClient();
    await expect(new SupabaseBackend('u', 'k', client as never).signUp(reg({ passwordConfirm: 'x' }), 'x')).rejects.toBeInstanceOf(CloudError);
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });
  it('Konto laden: Profil, Institution, Lizenz (über RLS)', async () => {
    const { client } = fakeClient({
      rows: {
        profiles: { id: 'p', user_id: 'u1', institution_id: 'i1', first_name: 'Anna', last_name: 'Auge', email: 'anna@optik.de', role: 'institution_admin', created_at: '2026-09-28' },
        institutions: { id: 'i1', type: 'business', name: 'Optik Auge GmbH', country: 'DE' },
        licenses: { id: 'l1', institution_id: 'i1', plan: 'business', status: 'pending', max_locations: 1 },
      },
    });
    const a = await new SupabaseBackend('u', 'k', client as never).loadAccount({ id: 'u1', email: 'anna@optik.de' });
    expect(a.profile?.role).toBe('institution_admin');
    expect(a.institution?.name).toBe('Optik Auge GmbH');
    expect(a.license?.status).toBe('pending');
    expect(accessState(a)).toBe('inactive');
  });
  it('Passwort-Reset mit Rücksprung auf /reset-password; Admin über geprüfte RPCs', async () => {
    const { client, calls } = fakeClient();
    const b = new SupabaseBackend('u', 'k', client as never);
    await b.requestPasswordReset('anna@optik.de', 'http://localhost:5173/reset-password');
    expect(calls.find((c) => c[0] === 'reset')![1]).toEqual(['anna@optik.de', { redirectTo: 'http://localhost:5173/reset-password' }]);
    await b.adminListAccounts();
    await b.adminSetLicenseStatus('l1', 'active');
    expect(calls.filter((c) => c[0] === 'rpc').map((c) => (c[1] as unknown[])[0])).toEqual(['admin_list_accounts', 'admin_set_license_status']);
  });
});

/* ---------------------------------- Mock-Backend ---------------------------------- */

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('MockBackend (Nachbau des Registrierungs-Triggers)', () => {
  it('Registrierung → institution_admin + Lizenz pending; Login/Logout; Admin nur für Super-Admin', async () => {
    const b = new MockBackend(memoryStorage());
    const r = await b.signUp(reg());
    expect(r.needsConfirmation).toBe(false);
    const acc = await b.loadAccount(r.user!);
    expect(acc.profile?.role).toBe('institution_admin');
    expect(acc.license).toMatchObject({ plan: 'business', status: 'pending', maxLocations: 1 });
    expect(hasActiveLicense(acc)).toBe(false);
    await b.signOut();
    expect(await b.getUser()).toBeNull();
    await expect(b.signIn('anna@optik.de', 'falsch')).rejects.toThrow(/nicht korrekt/);
    await b.signIn('anna@optik.de', 'Geheim123');
    expect((await b.getUser())?.email).toBe('anna@optik.de');
    await expect(b.adminListAccounts()).rejects.toThrow(/Super-Admins/);
    b.hooks().setRole('anna@optik.de', 'super_admin');
    expect(await b.adminListAccounts()).toHaveLength(1);
    await b.adminSetLicenseStatus(acc.license!.id, 'active');
    expect(hasActiveLicense(await b.loadAccount(r.user!))).toBe(true);
  });
});

describe('Stripe → Lizenzstatus (Webhook)', () => {
  it('Abbildung der Abo-Status', () => {
    expect(licenseStatusFromStripe('active')).toBe('active');
    expect(licenseStatusFromStripe('trialing')).toBe('active');
    expect(licenseStatusFromStripe('past_due')).toBe('past_due');
    expect(licenseStatusFromStripe('unpaid')).toBe('suspended');
    expect(licenseStatusFromStripe('canceled')).toBe('cancelled');
    // Phase 7: ein nie abgeschlossener Checkout ändert die Lizenz nicht (neue Konten bleiben 'pending',
    // bestehende behalten ihren Status) – gleiche Regel wie public.sync_license_for_institution()
    expect(licenseStatusFromStripe('incomplete_expired')).toBe('pending');
    expect(licenseStatusFromStripe('incomplete_expired', 'cancelled')).toBe('cancelled');
    expect(licenseStatusFromStripe('incomplete')).toBe('pending');
    expect(licenseStatusFromStripe('paused')).toBe('suspended');
    expect(licenseStatusFromStripe(undefined)).toBe('pending');
  });
});
