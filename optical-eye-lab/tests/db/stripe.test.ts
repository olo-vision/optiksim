/// <reference types="node" />
/**
 * Phase 7 – Stripe-Abos Ende-zu-Ende gegen echtes PostgreSQL (PGlite):
 * echte Edge-Function-Handler (supabase/functions/_shared/handlers.ts) + echte Migrationen +
 * nachgebildete Stripe-API. Die Datenbankzugriffe laufen – wie in Supabase – als service_role.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers, readMigration } from './pg';
import { handleCheckout, handlePortal, handleWebhook, type Deps } from '../../supabase/functions/_shared/handlers';
import { FakeStripe, pgBillingDb } from './stripeHarness';
import { signStripePayload } from '../../supabase/functions/_shared/stripeSignature';
import { DEFAULT_PRICE_IDS } from '../../supabase/functions/_shared/stripeConfig';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const WHSEC = 'whsec_test_integration';
const nowSec = () => Math.floor(Date.now() / 1000);

let db: PGlite;
let h: ReturnType<typeof helpers>;
let alice = ''; // Business
let bob = ''; // Education
let carol = ''; // Privat, später Super-Admin

const stripe = new FakeStripe();
let currentUser: { id: string; email: string } | null = null;
const env: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC, SITE_URL: 'http://localhost:5173' };
const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => currentUser, db: pgBillingDb(db, h), stripe });

const post = (body: unknown) => new Request('https://fn.test/x', { method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: 'Bearer t' }, body: JSON.stringify(body) });

let evt = 0;
async function webhook(type: string, object: Obj, opts: { id?: string; secret?: string } = {}) {
  const payload = JSON.stringify({ id: opts.id ?? `evt_${++evt}`, object: 'event', type, created: nowSec(), data: { object } });
  const sig = await signStripePayload(payload, opts.secret ?? WHSEC);
  const res = await handleWebhook(new Request('https://fn.test/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': sig }, body: payload }), deps());
  return { status: res.status, body: (await res.json()) as Obj, id: JSON.parse(payload).id as string };
}

const hasActive = (uid: string) => h.asUser(uid, async () => (await h.rows<{ ok: boolean }>('select public.has_active_license() as ok'))[0].ok);
const billing = (uid: string) => h.asUser(uid, async () => (await h.rows<Obj>('select * from public.my_billing_status()'))[0]);

let aliceInst = '';
let aliceCustomer = '';

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  alice = await h.register('alice@optik.de', { first_name: 'Alice', last_name: 'Auge', institution_type: 'business', institution_name: 'Optik Auge GmbH' });
  bob = await h.register('bob@schule.de', { first_name: 'Bob', last_name: 'Brille', institution_type: 'education', institution_name: 'Berufsschule Optik' });
  carol = await h.register('carol@privat.de', { first_name: 'Carol', last_name: 'Cornea', institution_type: 'private' });
  aliceInst = await h.institutionOf(alice);
}, 60000);

describe('Checkout (create-checkout-session) mit Datenbank', () => {
  it('legt genau einen Stripe Customer je Institution an und verwendet ihn wieder', async () => {
    currentUser = { id: alice, email: 'alice@optik.de' };
    const r1 = await handleCheckout(post({ plan: 'business' }), deps());
    expect(r1.status).toBe(200);
    const r2 = await handleCheckout(post({ plan: 'business' }), deps());
    expect(r2.status).toBe(200);
    expect(stripe.calls.filter((c) => c.path === 'customers')).toHaveLength(1);
    const sessions = stripe.calls.filter((c) => c.path === 'checkout/sessions');
    expect(sessions.map((c) => c.params.customer)).toEqual([sessions[0].params.customer, sessions[0].params.customer]);
    expect(sessions[0].params['line_items[0][price]']).toBe(DEFAULT_PRICE_IDS.business);
    aliceCustomer = sessions[0].params.customer;
    expect((await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [aliceInst]))[0].c).toBe(aliceCustomer);
  });

  it('Lizenz ist vor dem Webhook weiterhin pending (Success-URL allein schaltet nichts frei)', async () => {
    expect((await h.licenseOf(alice)).status).toBe('pending');
    expect(await hasActive(alice)).toBe(false);
  });
});

describe('Webhook (stripe-webhook) → Abo + Lizenz', () => {
  it('ungültige Signatur wird abgelehnt und ändert nichts', async () => {
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst);
    const bad = await webhook('checkout.session.completed', { id: 'cs_x', mode: 'subscription', subscription: 'sub_A', customer: aliceCustomer }, { secret: 'whsec_falsch' });
    expect(bad.status).toBe(400);
    const missing = await handleWebhook(new Request('https://fn.test', { method: 'POST', body: '{"id":"evt_x"}' }), deps());
    expect(missing.status).toBe(400);
    expect((await h.licenseOf(alice)).status).toBe('pending');
    expect(await h.rows('select * from public.stripe_events')).toHaveLength(0);
  });

  it('erfolgreicher Checkout aktiviert die Lizenz (Plan, Periode, Abo-Daten)', async () => {
    const r = await webhook('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', mode: 'subscription', subscription: 'sub_A', customer: aliceCustomer, payment_status: 'paid' });
    expect(r.status).toBe(200);
    expect(r.body.license_status).toBe('active');
    const lic = await h.licenseOf(alice);
    expect(lic).toMatchObject({ status: 'active', plan: 'business', source: 'stripe', grace_period_until: null, valid_until: null });
    const sub = (await h.rows<Obj>('select * from public.subscriptions where stripe_subscription_id = $1', ['sub_A']))[0];
    expect(sub).toMatchObject({ stripe_customer_id: aliceCustomer, stripe_price_id: DEFAULT_PRICE_IDS.business, status: 'active', cancel_at_period_end: false, plan: 'business' });
    expect(sub.current_period_start).toBeInstanceOf(Date);
    expect(sub.current_period_end.getTime()).toBeGreaterThan(Date.now());
    expect(await hasActive(alice)).toBe(true);
  });

  it('doppelt zugestelltes Ereignis wird nur einmal verarbeitet', async () => {
    const audit = async () => (await h.rows('select * from public.audit_logs where institution_id = $1', [aliceInst])).length;
    const first = await webhook('customer.subscription.updated', { id: 'sub_A', object: 'subscription' }, { id: 'evt_dup_1' });
    const before = await audit();
    const second = await webhook('customer.subscription.updated', { id: 'sub_A', object: 'subscription' }, { id: 'evt_dup_1' });
    expect(first.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(await audit()).toBe(before);
    expect(await h.rows('select * from public.subscriptions where institution_id = $1', [aliceInst])).toHaveLength(1);
    expect((await h.licenseOf(alice)).status).toBe('active');
  });

  it('abgebrochene Verarbeitung („processing“ > 2 min) und Fehler werden bei der nächsten Zustellung wiederholt', async () => {
    const begin = (id: string) => h.asService(async () => (await db.query<{ ok: boolean }>(`select public.stripe_event_begin($1, 'x', null) as ok`, [id])).rows[0].ok);
    expect(await begin('evt_stuck')).toBe(true);
    expect(await begin('evt_stuck')).toBe(false); // läuft gerade
    await db.query(`update public.stripe_events set started_at = now() - interval '5 minutes' where id = 'evt_stuck'`);
    expect(await begin('evt_stuck')).toBe(true); // hängengeblieben → erneut
    await h.asService(() => db.query(`select public.stripe_event_finish('evt_stuck', 'failed', 'boom')`));
    expect(await begin('evt_stuck')).toBe(true); // fehlgeschlagen → erneut
    await h.asService(() => db.query(`select public.stripe_event_finish('evt_stuck', 'processed')`));
    expect(await begin('evt_stuck')).toBe(false); // erledigt
    expect((await h.rows<{ attempts: number }>(`select attempts from public.stripe_events where id = 'evt_stuck'`))[0].attempts).toBe(3);
  });

  it('weiterer Checkout bei laufendem Abo wird abgelehnt (409)', async () => {
    currentUser = { id: alice, email: 'alice@optik.de' };
    const res = await handleCheckout(post({ plan: 'business' }), deps());
    expect(res.status).toBe(409);
  });

  it('invoice.payment_failed → past_due mit 7 Tagen Frist, Zugriff bleibt in der Frist', async () => {
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { status: 'past_due' });
    stripe.invoices.set('in_1', { id: 'in_1', status: 'open', parent: { subscription_details: { subscription: 'sub_A' } } });
    const r = await webhook('invoice.payment_failed', { id: 'in_1', object: 'invoice', parent: { subscription_details: { subscription: 'sub_A' } } });
    expect(r.status).toBe(200);
    const lic = await h.licenseOf(alice);
    expect(lic.status).toBe('past_due');
    const days = (lic.grace_period_until!.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect((await h.rows<{ status: string }>('select status from public.subscriptions where stripe_subscription_id = $1', ['sub_A']))[0].status).toBe('past_due');
    expect(await hasActive(alice)).toBe(true);
    const b = await billing(alice);
    expect(b).toMatchObject({ license_status: 'past_due', subscription_status: 'past_due', has_customer: true, can_manage: true });
    // weitere Fehlversuche verlängern die Frist nicht
    const grace = lic.grace_period_until!.getTime();
    await webhook('invoice.payment_failed', { id: 'in_1', object: 'invoice', parent: { subscription_details: { subscription: 'sub_A' } } });
    expect((await h.licenseOf(alice)).grace_period_until!.getTime()).toBe(grace);
  });

  it('payment_failed bei (noch) aktivem Abo, aber offener Rechnung → past_due', async () => {
    stripe.putSubscription('sub_B', 'cus_carolX', 'private', await h.institutionOf(carol), { status: 'active' });
    // Carol hat noch keinen Customer → Zuordnung über serverseitig gesetzte Abo-Metadaten
    stripe.invoices.set('in_c', { id: 'in_c', status: 'open', subscription: 'sub_B' });
    await webhook('invoice.payment_failed', { id: 'in_c', object: 'invoice', subscription: 'sub_B' }); // Legacy-Form
    expect((await h.licenseOf(carol)).status).toBe('past_due');
    // Rechnung inzwischen bezahlt → ein verspätetes payment_failed stuft NICHT herab
    stripe.invoices.set('in_c', { id: 'in_c', status: 'paid', subscription: 'sub_B' });
    await webhook('invoice.paid', { id: 'in_c', object: 'invoice', subscription: 'sub_B' });
    await webhook('invoice.payment_failed', { id: 'in_c', object: 'invoice', subscription: 'sub_B' });
    expect((await h.licenseOf(carol)).status).toBe('active');
  });

  it('Grace Period abgelaufen → suspended (expire_grace_periods), kein Zugriff', async () => {
    await db.query(`update public.licenses set grace_period_until = now() - interval '1 minute' where institution_id = $1`, [aliceInst]);
    // bis der Job läuft, sperrt bereits die Zugriffsprüfung
    expect(await hasActive(alice)).toBe(false);
    const n = await h.asService(async () => (await db.query<{ n: number }>('select public.expire_grace_periods() as n')).rows[0].n);
    expect(n).toBe(1);
    expect((await h.licenseOf(alice)).status).toBe('suspended');
    // zweiter Lauf: nichts mehr zu tun (idempotent)
    expect(await h.asService(async () => (await db.query<{ n: number }>('select public.expire_grace_periods() as n')).rows[0].n)).toBe(0);
  });

  it('spätere erfolgreiche Zahlung (invoice.paid) → wieder active, Frist gelöscht', async () => {
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { status: 'active' });
    stripe.invoices.set('in_1', { id: 'in_1', status: 'paid', parent: { subscription_details: { subscription: 'sub_A' } } });
    await webhook('invoice.paid', { id: 'in_1', object: 'invoice', parent: { subscription_details: { subscription: 'sub_A' } } });
    const lic = await h.licenseOf(alice);
    expect(lic).toMatchObject({ status: 'active', grace_period_until: null });
    expect(await hasActive(alice)).toBe(true);
  });

  it('Kündigung zum Periodenende: Lizenz bleibt aktiv bis zum Periodenende', async () => {
    const end = stripe.subs.get('sub_A')!.items.data[0].current_period_end as number;
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { cancel_at_period_end: true, cancel_at: end });
    await webhook('customer.subscription.updated', { id: 'sub_A', object: 'subscription' });
    const lic = await h.licenseOf(alice);
    expect(lic.status).toBe('active');
    expect(lic.valid_until!.getTime()).toBe(end * 1000);
    expect(await hasActive(alice)).toBe(true);
    const b = await billing(alice);
    expect(b.cancel_at_period_end).toBe(true);
    expect(new Date(b.current_period_end).getTime()).toBe(end * 1000);
  });

  it('Kündigung nur über cancel_at (neuere API-Versionen/Portal) wird ebenso erkannt', async () => {
    const end = stripe.subs.get('sub_A')!.items.data[0].current_period_end as number;
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { cancel_at_period_end: false, cancel_at: end });
    await webhook('customer.subscription.updated', { id: 'sub_A', object: 'subscription' });
    expect((await h.licenseOf(alice)).valid_until!.getTime()).toBe(end * 1000);
    expect((await billing(alice)).cancel_at_period_end).toBe(true);
    // Kündigung zurückgenommen → wieder unbefristet
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { cancel_at: null });
    await webhook('customer.subscription.updated', { id: 'sub_A', object: 'subscription' });
    expect((await h.licenseOf(alice)).valid_until).toBeNull();
    expect((await billing(alice)).cancel_at_period_end).toBe(false);
  });

  it('tatsächliches Abo-Ende (customer.subscription.deleted) → cancelled, kein Zugriff', async () => {
    stripe.putSubscription('sub_A', aliceCustomer, 'business', aliceInst, { status: 'canceled', ended_at: nowSec(), canceled_at: nowSec() });
    await webhook('customer.subscription.deleted', { id: 'sub_A', object: 'subscription' });
    const lic = await h.licenseOf(alice);
    expect(lic.status).toBe('cancelled');
    expect(await hasActive(alice)).toBe(false);
    // neues Abo nach Ende ist wieder möglich – mit demselben Customer
    currentUser = { id: alice, email: 'alice@optik.de' };
    const res = await handleCheckout(post({ plan: 'business' }), deps());
    expect(res.status).toBe(200);
    expect(stripe.calls.filter((c) => c.path === 'customers')).toHaveLength(1);
  });

  it('Reihenfolge egal: veraltetes Ereignis eines alten Abos überschreibt das neue nicht', async () => {
    stripe.putSubscription('sub_A2', aliceCustomer, 'business', aliceInst, { created: nowSec() });
    await webhook('customer.subscription.created', { id: 'sub_A2', object: 'subscription' });
    expect((await h.licenseOf(alice)).status).toBe('active');
    await webhook('customer.subscription.deleted', { id: 'sub_A', object: 'subscription' }); // spät zugestellt
    expect((await h.licenseOf(alice)).status).toBe('active');
  });
});

describe('Sonderlizenz (manuell) und Admin', () => {
  let bobLicense = '';
  const bobInstP = () => h.institutionOf(bob);

  it('manuelle Freischaltung wird von Stripe nicht zerstört', async () => {
    await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [carol]);
    bobLicense = (await h.licenseOf(bob)).id;
    await h.asUser(carol, () => db.query(`select public.admin_set_license_status($1, 'active')`, [bobLicense]));
    expect(await h.licenseOf(bob)).toMatchObject({ status: 'active', source: 'manual' });
    const inst = await bobInstP();
    stripe.putSubscription('sub_bob', 'cus_bob', 'education', inst, { status: 'canceled', ended_at: nowSec() });
    const r = await webhook('customer.subscription.deleted', { id: 'sub_bob', object: 'subscription' });
    expect(r.status).toBe(200);
    expect(await h.licenseOf(bob)).toMatchObject({ status: 'active', source: 'manual' });
    // Abo-Daten werden trotzdem protokolliert
    expect((await h.rows<{ status: string }>('select status from public.subscriptions where stripe_subscription_id = $1', ['sub_bob']))[0].status).toBe('canceled');
    // Checkout ist bei aktiver Sonderlizenz gesperrt
    currentUser = { id: bob, email: 'bob@schule.de' };
    expect((await handleCheckout(post({ plan: 'education' }), deps())).status).toBe(409);
  });

  it('Rückgabe an Stripe übernimmt den Stripe-Status', async () => {
    await h.asUser(carol, () => db.query(`select public.admin_set_license_source($1, 'stripe')`, [bobLicense]));
    expect(await h.licenseOf(bob)).toMatchObject({ status: 'cancelled', source: 'stripe' });
  });

  it('Admin-Übersicht zeigt Tarif, Status, Quelle, Abo- und Stripe-Daten', async () => {
    const list = await h.asUser(carol, () => h.rows<Obj>('select * from public.admin_list_accounts()'));
    const a = list.find((r) => r.email === 'alice@optik.de')!;
    expect(a).toMatchObject({ institution_type: 'business', license_plan: 'business', license_status: 'active', license_source: 'stripe', subscription_status: 'active', stripe_customer_id: aliceCustomer, stripe_subscription_id: 'sub_A2', cancel_at_period_end: false });
    expect(a.current_period_end).toBeInstanceOf(Date);
    // Nicht-Admins: verboten
    expect(await h.asUser(alice, () => h.fails('select * from public.admin_list_accounts()'))).toBe(true);
    expect(await h.asUser(alice, () => h.fails(`select public.admin_set_license_source($1, 'stripe')`, [bobLicense]))).toBe(true);
  });
});

describe('Sicherheit', () => {
  it('Kunde kann keine fremde Stripe Customer ID verwenden (Metadaten ≠ Customer-Zuordnung)', async () => {
    const bobInst = await h.institutionOf(bob);
    // Abo mit Alices Customer, aber Metadaten zeigen auf Bobs Institution → abgelehnt
    stripe.putSubscription('sub_evil', aliceCustomer, 'education', bobInst);
    const before = await h.licenseOf(bob);
    const r = await webhook('customer.subscription.created', { id: 'sub_evil', object: 'subscription' });
    expect(r.status).toBe(500);
    expect(await h.licenseOf(bob)).toEqual(before);
    expect(await h.rows('select * from public.subscriptions where stripe_subscription_id = $1', ['sub_evil'])).toHaveLength(0);
    // Portal: immer nur der eigene Customer, Body wird ignoriert
    currentUser = { id: bob, email: 'bob@schule.de' };
    const bobCustomer = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [bobInst]))[0].c;
    const res = await handlePortal(post({ customer: aliceCustomer }), deps());
    expect(res.status).toBe(200);
    expect(((await res.json()) as Obj).url).toBe(`https://billing.stripe.test/p/${bobCustomer}`);
  });

  it('Abo ohne Bezug zu einer Institution wird ignoriert (kein Endlos-Retry)', async () => {
    stripe.subs.set('sub_x', { id: 'sub_x', customer: 'cus_unbekannt', status: 'active', metadata: {}, items: { data: [] } });
    const r = await webhook('customer.subscription.created', { id: 'sub_x' });
    expect(r.status).toBe(200);
    expect(r.body.ignored).toBeTruthy();
  });

  it('Frontend (authenticated/anon) kann Abo- und Stripe-Daten weder lesen noch schreiben', async () => {
    await h.asUser(alice, async () => {
      expect(await h.fails('select * from public.billing_customers')).toBe(true);
      expect(await h.fails('select * from public.stripe_events')).toBe(true);
      expect(await h.fails(`select public.apply_stripe_subscription('{}'::jsonb)`)).toBe(true);
      expect(await h.fails('select public.expire_grace_periods()')).toBe(true);
      expect(await h.fails(`select public.sync_license_for_institution(gen_random_uuid(), 'x')`)).toBe(true);
      expect(await h.fails(`select public.stripe_event_begin('evt_1', 'x', null)`)).toBe(true);
      expect(await h.fails(`update public.licenses set status = 'active', source = 'manual'`)).toBe(true);
      expect(await h.fails(`update public.licenses set grace_period_until = now() + interval '1 year'`)).toBe(true);
      expect(await h.fails(`update public.subscriptions set status = 'active'`)).toBe(true);
      // eigene Übersicht ja – ohne Stripe-IDs
      const b = await h.rows<Obj>('select * from public.my_billing_status()');
      expect(b).toHaveLength(1);
      expect(Object.keys(b[0])).not.toContain('stripe_customer_id');
    });
    await h.asUser(null, async () => {
      expect(await h.fails('select * from public.my_billing_status()')).toBe(true);
      expect(await h.fails('select * from public.subscriptions')).toBe(true);
    });
  });

  it('Migration ist wiederholbar (idempotent)', async () => {
    // Wiederholt eingespielt wird jeweils die neueste Migration (ältere Dateien werden von neueren
    // Funktionsversionen abgelöst). Phase 7.1 und Phase 8 müssen gefahrlos erneut laufen.
    const before = await h.licenseOf(alice);
    await db.exec(readMigration('20260929090000_service_role_grants.sql'));
    await db.exec(readMigration('20260929120000_demo_billing_legal.sql'));
    await db.exec(readMigration('20260930090000_legal_operations.sql'));
    expect(await h.licenseOf(alice)).toEqual(before);
  });
});
