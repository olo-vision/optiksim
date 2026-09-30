/// <reference types="node" />
/**
 * Phase 7.1 – Rechte des Server-Schlüssels (service_role) nach der Supabase-Umstellung der
 * Standardrechte (neue Tabellen werden nicht mehr automatisch freigegeben).
 *
 * Läuft unter BEIDEN Varianten:
 *   aktuell  – keine automatischen Tabellenrechte (neue Projekte ab 30.05.2026, alle ab 30.10.2026)
 *   früher   – automatische Rechte für alle API-Rollen (ältere Projekte bis 30.10.2026)
 *
 * Geprüft wird: Checkout, Customer Portal und Webhook funktionieren mit dem Admin-Zugriff; normale
 * Frontend-Benutzer (authenticated/anon) erhalten dadurch KEINE zusätzlichen Rechte.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';
import { FakeStripe, pgBillingDb } from './stripeHarness';
import { handleCheckout, handlePortal, handleWebhook, type Deps } from '../../supabase/functions/_shared/handlers';
import { signStripePayload } from '../../supabase/functions/_shared/stripeSignature';
import { DEFAULT_PRICE_IDS } from '../../supabase/functions/_shared/stripeConfig';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WHSEC = 'whsec_grants';
const TABLES = ['profiles', 'institutions', 'licenses', 'subscriptions', 'audit_logs', 'plan_catalog', 'billing_customers', 'stripe_events', 'demo_grants', 'legal_documents', 'legal_consents', 'consumer_declarations', 'system_mails', 'user_simulations', 'user_templates', 'user_preferences', 'deleted_accounts'];

describe.each([
  ['aktuelle Supabase-Standardrechte', false],
  ['frühere Supabase-Standardrechte', true],
])('%s', (_label, legacyDefaults) => {
  let db: PGlite;
  let h: ReturnType<typeof helpers>;
  let alice = '';
  let bob = '';
  let aliceInst = '';
  let bobInst = '';
  const stripe = new FakeStripe();
  let currentUser: { id: string; email: string } | null = null;
  const env: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC, SITE_URL: 'http://localhost:5173' };
  const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => currentUser, db: pgBillingDb(db, h), stripe });
  const post = (body: unknown) => new Request('https://fn.test/x', { method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: 'Bearer t' }, body: JSON.stringify(body) });

  /** Tabellenrechte einer Rolle als sortierte Liste "tabelle:RECHT" */
  const tablePrivileges = async (role: string) =>
    (
      await h.rows<{ p: string }>(
        `select table_name || ':' || privilege_type as p from information_schema.role_table_grants
          where grantee = $1 and table_schema = 'public' and table_name = any($2) order by 1`,
        [role, TABLES],
      )
    ).map((r) => r.p);

  beforeAll(async () => {
    db = await createDb({ legacyDefaults });
    h = helpers(db);
    alice = await h.register('alice@optik.de', { first_name: 'Alice', institution_type: 'business', institution_name: 'Optik Auge GmbH' });
    bob = await h.register('bob@schule.de', { first_name: 'Bob', institution_type: 'education', institution_name: 'Berufsschule' });
    aliceInst = await h.institutionOf(alice);
    bobInst = await h.institutionOf(bob);
  }, 60000);

  it('eingeloggter Benutzer erzeugt Checkout für SEINE Institution (Admin-Zugriff ohne „permission denied“)', async () => {
    currentUser = { id: alice, email: 'alice@optik.de' };
    const res = await handleCheckout(post({ plan: 'business' }), deps());
    expect(res.status).toBe(200);
    const session = stripe.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(session.params.client_reference_id).toBe(aliceInst);
    expect(session.params['subscription_data[metadata][institution_id]']).toBe(aliceInst);
    expect(session.params['line_items[0][price]']).toBe(DEFAULT_PRICE_IDS.business);
    expect((await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [aliceInst]))[0].c).toBe(session.params.customer);
  });

  it('fremde Institution ist nicht erreichbar – Body-Angaben werden ignoriert', async () => {
    stripe.calls.length = 0;
    currentUser = { id: bob, email: 'bob@schule.de' };
    const res = await handleCheckout(post({ plan: 'education', institution_id: aliceInst, customer: 'cus_1', client_reference_id: aliceInst }), deps());
    expect(res.status).toBe(200);
    const session = stripe.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(session.params.client_reference_id).toBe(bobInst);
    expect(session.params.customer).not.toBe('cus_1');
    // Bob kann nicht den Tarif von Alices Institution (Business) buchen
    expect((await handleCheckout(post({ plan: 'business' }), deps())).status).toBe(422);
  });

  it('Customer Portal über Admin-Zugriff – nur der eigene Kunde', async () => {
    currentUser = { id: alice, email: 'alice@optik.de' };
    const own = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [aliceInst]))[0].c;
    const other = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [bobInst]))[0].c;
    const res = await handlePortal(post({ customer: other }), deps());
    expect(res.status).toBe(200);
    expect(((await res.json()) as Obj).url).toBe(`https://billing.stripe.test/p/${own}`);
  });

  it('Webhook führt seine Datenbank-Operationen aus (Idempotenz, Abo, Lizenz, Audit)', async () => {
    const customer = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [aliceInst]))[0].c;
    stripe.putSubscription('sub_g', customer, 'business', aliceInst);
    const payload = JSON.stringify({ id: 'evt_grants_1', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { mode: 'subscription', subscription: 'sub_g', customer } } });
    const res = await handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, WHSEC) }, body: payload }), deps());
    expect(res.status).toBe(200);
    expect((await h.licenseOf(alice)).status).toBe('active');
    expect((await h.rows<{ status: string }>(`select status from public.stripe_events where id = 'evt_grants_1'`))[0].status).toBe('processed');
  });

  it('Frontend-Benutzer können Profile/Lizenzen weiterhin nicht administrativ verändern', async () => {
    await h.asUser(bob, async () => {
      expect(await h.fails(`update public.profiles set role = 'super_admin' where user_id = auth.uid()`)).toBe(true);
      expect(await h.fails(`update public.licenses set status = 'active'`)).toBe(true);
      expect(await h.fails(`update public.licenses set source = 'manual'`)).toBe(true);
      expect(await h.fails(`insert into public.billing_customers values ($1, 'cus_evil')`, [bobInst])).toBe(true);
      expect(await h.fails(`select * from public.billing_customers`)).toBe(true);
      expect(await h.fails(`select public.apply_stripe_subscription('{}'::jsonb)`)).toBe(true);
      // nur die eigene Institution sichtbar
      expect(await h.rows('select * from public.profiles where user_id = $1', [alice])).toHaveLength(0);
    });
    expect((await h.licenseOf(bob)).status).toBe('pending');
    await h.asUser(null, async () => {
      expect(await h.fails('select * from public.profiles')).toBe(true);
      expect(await h.fails('select * from public.licenses')).toBe(true);
    });
  });

  it('Rechte von anon/authenticated sind genau die aus Phase 6/7 – nicht erweitert', async () => {
    if (legacyDefaults) return; // früher: automatische Rechte, von den Migrationen gezielt zurückgenommen (siehe rls.test)
    expect(await tablePrivileges('anon')).toEqual(['plan_catalog:SELECT']);
    expect(await tablePrivileges('authenticated')).toEqual([
      'audit_logs:SELECT',
      'institutions:SELECT',
      'legal_consents:SELECT',
      'licenses:SELECT',
      'plan_catalog:SELECT',
      'profiles:SELECT',
      'subscriptions:SELECT',
      // 0.10.0: eigene Inhalte (RLS: nur Besitzer; Schreiben nur mit aktiver Lizenz – Trigger)
      'user_preferences:INSERT',
      'user_preferences:SELECT',
      'user_preferences:UPDATE',
      'user_simulations:DELETE',
      'user_simulations:INSERT',
      'user_simulations:SELECT',
      'user_simulations:UPDATE',
      'user_templates:DELETE',
      'user_templates:INSERT',
      'user_templates:SELECT',
      'user_templates:UPDATE',
    ]);
  });

  it('service_role erhält nur die nötigen Tabellenrechte (Schreiben nur über geprüfte Funktionen)', async () => {
    if (legacyDefaults) return; // früher: service_role hatte automatisch alle Rechte
    expect(await tablePrivileges('service_role')).toEqual([
      'billing_customers:INSERT',
      'billing_customers:SELECT',
      'institutions:SELECT',
      'licenses:SELECT',
      'plan_catalog:SELECT',
      'profiles:SELECT',
      'subscriptions:SELECT',
    ]);
    await h.asService(async () => {
      expect(await h.fails(`update public.licenses set status = 'active'`)).toBe(true);
      expect(await h.fails(`delete from public.billing_customers`)).toBe(true);
    });
  });
});
