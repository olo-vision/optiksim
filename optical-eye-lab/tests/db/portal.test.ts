/// <reference types="node" />
/**
 * „Abonnement verwalten“ Ende-zu-Ende: Frontend-Aufruf → Edge Function → Stripe Customer Portal.
 * Reale Ursachen früherer Fehler werden nachgestellt: Kundenportal im Stripe-Testmodus nicht gespeichert,
 * Kunde im anderen Stripe-Modus (Test/Live), Konto ohne Stripe-Kunden, Stripe nicht erreichbar.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';
import { FakeStripe, pgBillingDb } from './stripeHarness';
import { handlePortal, PORTAL_CONFIG_MARKER, type Deps } from '../../supabase/functions/_shared/handlers';

let db: PGlite;
let h: ReturnType<typeof helpers>;
let uid = '';
let inst = '';

const env: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_x', SITE_URL: 'https://olo-lab.de' };
const post = () => new Request('https://fn.test', { method: 'POST', headers: { Origin: 'https://olo-lab.de' }, body: '{}' });
const run = async (stripe: FakeStripe, logs: string[] = []) => {
  const deps: Deps = { env: (k) => env[k], authUser: async () => ({ id: uid, email: 'kunde@web.de' }), db: pgBillingDb(db, h), stripe, log: (m) => logs.push(m) };
  const res = await handlePortal(post(), deps);
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  uid = await h.register('kunde@web.de', { first_name: 'Karla', institution_type: 'private' });
  inst = await h.institutionOf(uid);
}, 60000);

describe('Kundenportal', () => {
  it('ohne Stripe-Kunden (noch nie gebucht): verständliche Meldung, kein technischer Fehler, kein Stripe-Aufruf', async () => {
    const stripe = new FakeStripe();
    const r = await run(stripe);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'no_customer' });
    expect(r.body.error).toContain('nach Ihrer ersten Buchung');
    expect(stripe.calls).toHaveLength(0);
  });

  it('zahlender Kunde, Portal im Dashboard gespeichert → Portal-URL', async () => {
    await db.query('insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, $2)', [inst, 'cus_karla']);
    const stripe = new FakeStripe();
    stripe.addCustomer('cus_karla');
    const r = await run(stripe);
    expect(r).toEqual({ status: 200, body: { url: 'https://billing.stripe.test/p/cus_karla' } });
    expect(stripe.calls.find((c) => c.path === 'billing_portal/sessions')?.params).toMatchObject({ customer: 'cus_karla', return_url: 'https://olo-lab.de/account', locale: 'de' });
  });

  it('Ursache „Kundenportal im Stripe-Testmodus nicht gespeichert“: eigene Konfiguration wird angelegt und wiederverwendet', async () => {
    const stripe = new FakeStripe();
    stripe.portalDefaultConfigured = false;
    stripe.addCustomer('cus_karla');
    const logs: string[] = [];
    const r1 = await run(stripe, logs);
    expect(r1.status).toBe(200);
    const created = stripe.calls.filter((c) => c.method === 'POST' && c.path === 'billing_portal/configurations');
    expect(created).toHaveLength(1);
    expect(created[0].params).toMatchObject({
      'metadata[olo]': PORTAL_CONFIG_MARKER,
      'features[subscription_cancel][mode]': 'at_period_end',
      'features[subscription_update][enabled]': 'false',
      'features[invoice_history][enabled]': 'true',
      'business_profile[privacy_policy_url]': 'https://olo-lab.de/legal/privacy',
    });
    expect(logs.some((l) => l.includes('keine Standard-Konfiguration'))).toBe(true);
    // zweiter Aufruf: vorhandene Konfiguration, keine neue
    const r2 = await run(stripe);
    expect(r2.status).toBe(200);
    expect(stripe.calls.filter((c) => c.method === 'POST' && c.path === 'billing_portal/configurations')).toHaveLength(1);
  });

  it('feste Konfiguration per Secret STRIPE_PORTAL_CONFIGURATION_ID', async () => {
    const stripe = new FakeStripe();
    stripe.portalDefaultConfigured = false;
    stripe.addCustomer('cus_karla');
    env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_fest';
    const r = await run(stripe);
    delete env.STRIPE_PORTAL_CONFIGURATION_ID;
    expect(r.status).toBe(200);
    expect(stripe.calls.find((c) => c.path === 'billing_portal/sessions')?.params.configuration).toBe('bpc_fest');
  });

  it('Ursache „Kunde im anderen Stripe-Modus bzw. gelöscht“: klare Meldung statt 502, Hinweis im Log', async () => {
    const stripe = new FakeStripe();
    stripe.strictCustomers = true; // cus_karla existiert in diesem Modus nicht
    const logs: string[] = [];
    const r = await run(stripe, logs);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'customer_missing' });
    expect(logs.join(' ')).toMatch(/Test\/Live/);
  });

  it('Stripe nicht erreichbar: 502 mit verständlicher Meldung', async () => {
    const stripe = new FakeStripe();
    stripe.request = async () => {
      throw new Error('network');
    };
    const r = await run(stripe);
    expect(r.status).toBe(502);
    expect(r.body.error).toContain('Bitte versuchen Sie es in einigen Minuten erneut');
  });
});
