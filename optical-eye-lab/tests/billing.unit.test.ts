/**
 * Phase 7 – Abo-Logik im Frontend: Zugang während der Frist, Kündigung zum Periodenende, Hinweise,
 * gedrosselte Checkout-Bestätigung, Tarifregel und der Stripe-Nachbau des Mock-Backends.
 */
import { describe, expect, it } from 'vitest';
import { accessState, canUseSimulator, hasActiveLicense } from '@/cloud/access';
import { billingNotice, CONFIRM_BACKOFF_MS } from '@/cloud/billing';
import { planAllowedFor, PLANS } from '@/cloud/plans';
import { MockBackend } from '@/cloud/mockBackend';
import type { CloudAccount, CloudLicense, RegistrationInput } from '@/cloud/types';

const NOW = new Date('2026-10-10T12:00:00Z');
const acc = (license: Partial<CloudLicense> | null, billing: CloudAccount['billing'] = null): CloudAccount => ({
  userId: 'u',
  email: 'a@b.de',
  profile: { id: 'p', userId: 'u', institutionId: 'i', firstName: 'A', lastName: 'B', email: 'a@b.de', role: 'institution_admin', createdAt: '' },
  institution: { id: 'i', type: 'business', name: 'X', contactName: null, addressLine1: null, addressLine2: null, postalCode: null, city: null, country: 'DE' },
  license: license ? { id: 'l', institutionId: 'i', plan: 'business', status: 'active', validFrom: null, validUntil: null, maxLocations: 1, source: 'stripe', gracePeriodUntil: null, ...license } : null,
  billing,
});

describe('Zugang (Grace Period, Kündigung)', () => {
  it('past_due innerhalb der Frist: Zugriff bleibt ("grace")', () => {
    const a = acc({ status: 'past_due', gracePeriodUntil: '2026-10-15T12:00:00Z' });
    expect(accessState(a, NOW)).toBe('grace');
    expect(hasActiveLicense(a, NOW)).toBe(true);
  });
  it('past_due nach Fristende oder ohne Frist: kein Zugriff', () => {
    expect(hasActiveLicense(acc({ status: 'past_due', gracePeriodUntil: '2026-10-09T12:00:00Z' }), NOW)).toBe(false);
    expect(hasActiveLicense(acc({ status: 'past_due' }), NOW)).toBe(false);
    for (const status of ['suspended', 'cancelled', 'expired', 'pending'] as const) expect(hasActiveLicense(acc({ status }), NOW), status).toBe(false);
  });
  it('gekündigt zum Periodenende: aktiv bis valid_until, danach gesperrt', () => {
    const a = acc({ status: 'active', validUntil: '2026-10-31T00:00:00Z' });
    expect(accessState(a, NOW)).toBe('active');
    expect(accessState(a, new Date('2026-11-01T00:00:00Z'))).toBe('expired');
  });
  it('canUseSimulator nur für active und grace', () => {
    expect(['active', 'grace'].every((s) => canUseSimulator(s as never))).toBe(true);
    expect(['inactive', 'expired', 'signed-out', 'no-license'].some((s) => canUseSimulator(s as never))).toBe(false);
  });
});

describe('Hinweise', () => {
  it('fehlgeschlagene Zahlung: Frist mit Datum', () => {
    const n = billingNotice(acc({ status: 'past_due', gracePeriodUntil: '2026-10-15T12:00:00Z' }))!;
    expect(n.tone).toBe('warn');
    expect(n.text).toMatch(/Zahlung ist fehlgeschlagen.*Zahlungsmittel.*15\.10\.2026/);
  });
  it('Kündigung: "Gekündigt – Zugriff bis [Datum]"', () => {
    const n = billingNotice(acc({ status: 'active', validUntil: '2026-10-31T10:00:00Z' }, { subscriptionStatus: 'active', currentPeriodEnd: '2026-10-31T10:00:00Z', cancelAtPeriodEnd: true, cancelAt: '2026-10-31T10:00:00Z', hasCustomer: true, canManage: true }))!;
    expect(n.text).toBe('Gekündigt – Zugriff bis 31.10.2026');
  });
  it('Sonderlizenz und normales Abo: kein Hinweis', () => {
    expect(billingNotice(acc({ status: 'past_due', source: 'manual' }))).toBeNull();
    expect(billingNotice(acc({ status: 'active' }, { subscriptionStatus: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, hasCustomer: true, canManage: true }))).toBeNull();
  });
});

describe('Checkout-Bestätigung', () => {
  it('gedrosselt: wachsende Abstände, begrenzte Anzahl, insgesamt ≤ 90 s', () => {
    expect(CONFIRM_BACKOFF_MS.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < CONFIRM_BACKOFF_MS.length; i++) expect(CONFIRM_BACKOFF_MS[i]).toBeGreaterThan(CONFIRM_BACKOFF_MS[i - 1]);
    expect(CONFIRM_BACKOFF_MS[0]).toBeGreaterThanOrEqual(1000);
    expect(CONFIRM_BACKOFF_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(90000);
  });
});

describe('Tarifregel', () => {
  it('genau ein passender Tarif je Kontotyp', () => {
    for (const t of ['private', 'business', 'education'] as const) expect(PLANS.filter((p) => planAllowedFor(t, p.id)).map((p) => p.id)).toEqual([t]);
  });
});

/* ------------------------------ Mock-Backend: Stripe-Nachbau ------------------------------ */

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const reg = (p: Partial<RegistrationInput> = {}): RegistrationInput => ({ firstName: 'Anna', lastName: 'Auge', email: 'anna@optik.de', password: 'Geheim123', passwordConfirm: 'Geheim123', institutionType: 'education', institutionName: 'Schule', addressLine1: 'Schulweg 2', postalCode: '10115', city: 'Berlin', country: 'DE', ...p });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MockBackend – Checkout, Webhook-Verzögerung, Portal', () => {
  it('Lizenz wird erst durch den (verzögerten) Webhook aktiv', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const { user } = await b.signUp(reg());
    hooks.setWebhookDelay(80);
    await expect(b.openCustomerPortal()).rejects.toThrow(/noch kein Abonnement/);
    await expect(b.startCheckout('private')).rejects.toThrow(/passt nicht/);
    const url = await b.startCheckout('education');
    expect(url).toContain('/license?checkout=success');
    expect((await b.loadAccount(user!)).license?.status).toBe('pending');
    await wait(120);
    const acc2 = await b.loadAccount(user!);
    expect(acc2.license).toMatchObject({ status: 'active', plan: 'education', source: 'stripe' });
    expect(acc2.billing).toMatchObject({ subscriptionStatus: 'active', hasCustomer: true, canManage: true });
    await expect(b.startCheckout('education')).rejects.toThrow(/bereits ein Abonnement/);
    expect(await b.openCustomerPortal()).toContain('mock_portal=cus_mock_');
  });

  it('Zahlungsausfall → Frist → gesperrt → bezahlt → aktiv; Kündigung; Ende', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const { user } = await b.signUp(reg());
    hooks.setWebhookDelay(0);
    await b.startCheckout('education');
    await wait(5);
    await b.loadAccount(user!);
    hooks.stripeEvent('anna@optik.de', 'payment_failed');
    let a = await b.loadAccount(user!);
    expect(a.license?.status).toBe('past_due');
    expect(accessState(a)).toBe('grace');
    hooks.stripeEvent('anna@optik.de', 'grace_expired');
    a = await b.loadAccount(user!);
    expect(a.license?.status).toBe('suspended');
    hooks.stripeEvent('anna@optik.de', 'paid');
    a = await b.loadAccount(user!);
    expect(a.license).toMatchObject({ status: 'active', gracePeriodUntil: null });
    hooks.stripeEvent('anna@optik.de', 'cancel_at_period_end');
    a = await b.loadAccount(user!);
    expect(accessState(a)).toBe('active');
    expect(billingNotice(a)?.text).toMatch(/^Gekündigt – Zugriff bis /);
    hooks.stripeEvent('anna@optik.de', 'ended');
    a = await b.loadAccount(user!);
    expect(a.license?.status).toBe('cancelled');
    expect(hasActiveLicense(a)).toBe(false);
  });

  it('Sonderlizenz (Admin) bleibt bei Stripe-Ereignissen erhalten; Rückgabe an Stripe', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const { user } = await b.signUp(reg());
    hooks.setWebhookDelay(0);
    await b.startCheckout('education');
    await wait(5);
    await b.loadAccount(user!);
    hooks.setRole('anna@optik.de', 'super_admin');
    const lic = (await b.loadAccount(user!)).license!;
    await b.adminSetLicenseStatus(lic.id, 'active');
    hooks.stripeEvent('anna@optik.de', 'ended');
    expect((await b.loadAccount(user!)).license).toMatchObject({ status: 'active', source: 'manual' });
    await b.adminSetLicenseSource(lic.id, 'stripe');
    expect((await b.loadAccount(user!)).license).toMatchObject({ status: 'cancelled', source: 'stripe' });
    const rows = await b.adminListAccounts();
    expect(rows[0]).toMatchObject({ licenseSource: 'stripe', subscriptionStatus: 'canceled' });
    expect(rows[0].stripeCustomerId).toMatch(/^cus_mock_/);
  });
});
