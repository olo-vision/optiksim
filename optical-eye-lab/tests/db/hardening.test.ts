/// <reference types="node" />
/**
 * Produktions-Härtung (Audit 0.10.x) gegen echtes PostgreSQL + echte Edge-Handler:
 * geschlossene Konten, Live-Konfiguration (keine Test-IDs), Rechtstexte-Pflicht im Live-Betrieb,
 * fehlender Stripe-Kunde (Test/Live), offene Checkout-Sessions, Webhook-Modus/Parallelität,
 * „gekündigt“ über cancel_at, Inhaltsgrenzen, Drosselung, Nachversand von Bestätigungen.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';
import { handleCheckout, handleWebhook, type Deps } from '../../supabase/functions/_shared/handlers';
import { FakeMailer, FakeStripe, pgBillingDb, pgOpsDb, pgAccountDb } from './stripeHarness';
import { signStripePayload } from '../../supabase/functions/_shared/stripeSignature';
import { liveConfigProblems, priceIdFor, stripeMode, PRICE_ENV } from '../../supabase/functions/_shared/stripeConfig';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const WHSEC = 'whsec_hardening';
let db: PGlite;
let h: ReturnType<typeof helpers>;
let stripe = new FakeStripe();
const mailer = new FakeMailer();
let currentUser: { id: string; email: string } | null = null;
let env: Record<string, string> = {};
const TEST_ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC, SITE_URL: 'https://olo-lab.de' };
const LIVE_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: WHSEC,
  SITE_URL: 'https://olo-lab.de',
  STRIPE_TAX_RATE_ID: 'txr_live1',
  ...Object.fromEntries(Object.values(PRICE_ENV).map((k, i) => [k, `price_Live${i}`])),
};
const logs: string[] = [];
const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => currentUser, db: pgBillingDb(db, h), ops: pgOpsDb(db, h), accountDb: pgAccountDb(db, h), mailer, stripe, log: (m) => logs.push(m) });
const post = (body: unknown) => new Request('https://fn.test/x', { method: 'POST', headers: { Origin: 'https://olo-lab.de', Authorization: 'Bearer t' }, body: JSON.stringify(body) });
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};
let evt = 0;
async function webhook(type: string, object: Obj, extra: Obj = {}) {
  const payload = JSON.stringify({ id: `evt_h${++evt}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object }, ...extra });
  const res = await handleWebhook(new Request('https://fn.test/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, WHSEC) }, body: payload }), deps());
  return { status: res.status, body: (await res.json()) as Obj, id: JSON.parse(payload).id as string };
}

let pia = ''; // privat
let paul = ''; // privat, schließt sein Konto
let piaInst = '';
let paulInst = '';

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  pia = await h.register('pia@web.de', { first_name: 'Pia', institution_type: 'private' });
  paul = await h.register('paul@web.de', { first_name: 'Paul', institution_type: 'private' });
  piaInst = await h.institutionOf(pia);
  paulInst = await h.institutionOf(paul);
}, 60000);

describe('Geschlossenes Konto: serverseitig vollständig gesperrt', () => {
  it('Lizenzprüfung, Demo und Kauf sind gesperrt; nach Wiederöffnen wieder möglich', async () => {
    await h.asUser(paul, () => db.query('select public.close_my_account()'));
    expect(await code(() => h.asUser(paul, () => db.query(`select public.start_demo('{}')`)))).toBe('OLA03');
    await db.query(`update public.licenses set status = 'active', source = 'manual', valid_until = null where institution_id = $1`, [paulInst]);
    expect((await h.asUser(paul, () => h.rows<Obj>('select public.has_active_license() as ok')))[0].ok).toBe(false);
    expect((await h.asUser(paul, () => h.rows<Obj>('select has_access from public.my_billing_status()')))[0].has_access).toBe(false);
    await db.query(`update public.licenses set status = 'pending', source = 'stripe' where institution_id = $1`, [paulInst]);
    env = { ...TEST_ENV };
    currentUser = { id: paul, email: 'paul@web.de' };
    const r = await handleCheckout(post({ plan: 'private' }), deps());
    expect(r.status).toBe(409);
    expect(((await r.json()) as Obj).code).toBe('account_closed');
    expect(stripe.calls.some((c) => c.path === 'checkout/sessions' && c.method === 'POST')).toBe(false);
    await h.asUser(paul, () => db.query('select public.reopen_my_account()'));
    expect((await handleCheckout(post({ plan: 'private' }), deps())).status).toBe(200);
  });

  it('Demo überschreibt keine Sonderlizenz (z. B. Sperre durch den Admin)', async () => {
    await db.query(`update public.licenses set status = 'suspended', source = 'manual' where institution_id = $1`, [piaInst]);
    expect(await code(() => h.asUser(pia, () => db.query(`select public.start_demo('{}')`)))).toBe('OLD02');
    await db.query(`update public.licenses set status = 'pending', source = 'stripe' where institution_id = $1`, [piaInst]);
  });
});

describe('Live-Betrieb: keine Test-IDs, vollständige Konfiguration', () => {
  it('Modus aus dem Schlüssel; live ohne Price-Secrets → keine Price ID (nie Test-IDs)', () => {
    expect(stripeMode((k) => ({ STRIPE_SECRET_KEY: 'sk_live_1' })[k])).toBe('live');
    expect(stripeMode((k) => ({ STRIPE_SECRET_KEY: 'rk_test_1' })[k])).toBe('test');
    expect(priceIdFor('private', 'monthly', (k) => ({ STRIPE_SECRET_KEY: 'sk_live_1' })[k])).toBeNull();
    expect(priceIdFor('private', 'monthly', (k) => ({ STRIPE_SECRET_KEY: 'sk_test_1' })[k])).toMatch(/^price_/);
    expect(liveConfigProblems((k) => LIVE_ENV[k])).toEqual([]);
    const missing = liveConfigProblems((k) => ({ ...LIVE_ENV, STRIPE_PRICE_BUSINESS_YEARLY: '', STRIPE_TAX_RATE_ID: '', SITE_URL: 'http://localhost:5173' })[k]);
    expect(missing.join(' ')).toMatch(/STRIPE_PRICE_BUSINESS_YEARLY fehlt.*STRIPE_TAX_RATE_ID fehlt.*https/);
  });

  it('unvollständige Live-Konfiguration → 503 ohne Stripe-Aufruf', async () => {
    env = { ...LIVE_ENV, STRIPE_TAX_RATE_ID: '' };
    currentUser = { id: pia, email: 'pia@web.de' };
    const before = stripe.calls.length;
    const r = await handleCheckout(post({ plan: 'private' }), deps());
    expect(r.status).toBe(503);
    expect(((await r.json()) as Obj).code).toBe('stripe_not_configured');
    expect(stripe.calls.length).toBe(before);
  });

  it('Live ohne veröffentlichte Pflicht-Rechtstexte → kein Verkauf', async () => {
    env = { ...LIVE_ENV };
    const r = await handleCheckout(post({ plan: 'private' }), deps());
    expect(r.status).toBe(503);
    expect(((await r.json()) as Obj).code).toBe('legal_not_published');
    const missing = (await h.asService(() => h.rows<Obj>(`select public.legal_required_types_missing('checkout', 'private') as m`)))[0].m;
    expect(missing).toEqual(expect.arrayContaining(['terms', 'privacy', 'withdrawal']));
  });
});

describe('Stripe-Kunde und Checkout-Sessions', () => {
  it('gespeicherter Kunde fehlt bei Stripe (Test/Live) → neuer Kunde, Zuordnung ersetzt', async () => {
    env = { ...TEST_ENV };
    stripe = new FakeStripe();
    (stripe as unknown as { n: number }).n = 1000; // keine Kollision mit IDs des ersten Fakes
    stripe.strictCustomers = true;
    await db.query(`insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, 'cus_TESTALT') on conflict (institution_id) do update set stripe_customer_id = 'cus_TESTALT'`, [piaInst]);
    currentUser = { id: pia, email: 'pia@web.de' };
    const r = await handleCheckout(post({ plan: 'private' }), deps());
    expect(r.status, logs.join(' | ')).toBe(200);
    const cus = (await h.rows<Obj>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [piaInst]))[0].c;
    expect(cus).not.toBe('cus_TESTALT');
    expect(cus).toMatch(/^cus_\d+$/);
  });

  it('ältere offene Checkout-Session wird beim neuen Checkout geschlossen (kein Doppelabo über zwei Tabs)', async () => {
    const first = stripe.sessions.find((s) => s.status === 'open')!;
    first.created = Math.floor(Date.now() / 1000) - 3600;
    const r = await handleCheckout(post({ plan: 'private', interval: 'yearly' }), deps());
    expect(r.status).toBe(200);
    expect(first.status).toBe('expired');
    expect(stripe.sessions.filter((s) => s.status === 'open')).toHaveLength(1);
  });
});

describe('Webhook', () => {
  it('Ereignis aus dem anderen Stripe-Modus wird ignoriert', async () => {
    env = { ...TEST_ENV };
    const r = await webhook('customer.subscription.updated', { id: 'sub_x' }, { livemode: true });
    expect(r).toMatchObject({ status: 200, body: { ignored: 'anderer Stripe-Modus' } });
  });
  it('parallel laufende Verarbeitung → 409 (Stripe stellt erneut zu), erledigte → 200 duplicate', async () => {
    await h.asService(() => db.query(`select public.stripe_event_claim('evt_busy', 'invoice.paid', null)`));
    const busy = await h.asService(() => h.rows<Obj>(`select public.stripe_event_claim('evt_busy', 'invoice.paid', null) as r`));
    expect(busy[0].r).toBe('busy');
    await h.asService(() => db.query(`select public.stripe_event_finish('evt_busy', 'processed')`));
    expect((await h.asService(() => h.rows<Obj>(`select public.stripe_event_claim('evt_busy', 'invoice.paid', null) as r`)))[0].r).toBe('done');
  });
  it('unbekanntes Abo (anderer Modus/gelöscht) → ignoriert statt 3 Tage Wiederholung', async () => {
    const r = await webhook('customer.subscription.updated', { id: 'sub_unbekannt' });
    expect(r).toMatchObject({ status: 200, body: { ignored: 'nicht gefunden' } });
  });
});

describe('„Gekündigt“ auch über cancel_at', () => {
  it('Konto schließen/löschen möglich, Jahreslizenz-Erinnerung erkannt', async () => {
    await db.query(
      `insert into public.subscriptions (institution_id, stripe_subscription_id, status, plan, billing_interval, current_period_end, cancel_at_period_end, cancel_at)
       values ($1, 'sub_cancelat', 'active', 'private', 'yearly', now() + interval '10 days', false, now() + interval '10 days')`,
      [paulInst],
    );
    const o = (await h.asUser(paul, () => h.rows<Obj>('select public.my_account_overview() as o')))[0].o;
    expect(o).toMatchObject({ live_subscription: true, cancel_at_period_end: true, can_close: true, can_delete: true });
    const cands = await h.asService(() => h.rows<Obj>('select stripe_subscription_id from public.renewal_reminder_candidates(14)'));
    expect(cands.map((c) => c.stripe_subscription_id)).toContain('sub_cancelat');
    await db.query(`update public.subscriptions set cancel_at = null where stripe_subscription_id = 'sub_cancelat'`);
    expect(await code(() => h.asUser(paul, () => db.query('select public.close_my_account()')))).toBe('OLA01');
    await db.query(`delete from public.subscriptions where stripe_subscription_id = 'sub_cancelat'`);
  });
});

describe('Grenzen für Inhalte', () => {
  it('summary/tags begrenzt; Obergrenze je Konto', async () => {
    await db.query(`update public.licenses set status = 'active', source = 'manual', valid_until = null where institution_id = $1`, [piaInst]);
    const ins = (id: string, summary = '{}', tags = '{}') =>
      h.asUser(pia, () => db.query(`insert into public.user_simulations (id, name, doc, summary, tags, institution_id) values ($1, $1, '{"eye":{},"elements":[]}', $2::jsonb, $3::text[], public.my_institution_id())`, [id, summary, tags]));
    expect(await code(() => ins('sim_big_summary', JSON.stringify({ x: 'a'.repeat(30000) })))).toBe('23514');
    expect(await code(() => ins('sim_big_tags', '{}', `{${'b'.repeat(3000)}}`))).toBe('23514');
    await ins('sim_ok');
    // Obergrenze: künstlich nahe an das Limit (5000) bringen
    await db.query(`insert into public.user_simulations (id, owner_user_id, institution_id, name, doc) select 'sim_q' || g, $1, $2, 'q', '{}'::jsonb from generate_series(1, 4999) g`, [pia, piaInst]);
    expect(await code(() => ins('sim_zuviel'))).toBe('OLL02');
  });
});

describe('Öffentliche Endpunkte: Drosselung, Nachversand', () => {
  it('throttle_hit zählt je Zeitfenster', async () => {
    const hit = async () => (await h.asService(() => h.rows<Obj>(`select public.throttle_hit('test:ip:1', 3, 3600) as ok`)))[0].ok;
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
    expect(await h.asUser(pia, () => h.fails(`select public.throttle_hit('x', 1, 60)`))).toBe(true);
  });
  it('unbestätigte Erklärungen werden zum Nachversand geliefert (nicht gedrosselte, älter als 5 Minuten)', async () => {
    const rec = (await h.asService(() => h.rows<Obj>(`select public.consumer_declaration_record('cancellation', 'ordinary', 'Pia', 'pia@web.de', null, null) as r`)))[0].r;
    // Zeit vorspulen (Inhalt ist per Trigger unveränderlich – nur im Test umgehen)
    await db.exec(`set session_replication_role = replica`);
    await db.query(`update public.consumer_declarations set received_at = now() - interval '10 minutes' where id = $1`, [rec.id]);
    await db.exec(`set session_replication_role = origin`);
    const pending = await h.asService(() => h.rows<Obj>('select id, recipient from public.declaration_confirmations_pending(7)'));
    expect(pending, JSON.stringify(pending)).toEqual([{ id: rec.id, recipient: 'pia@web.de' }]);
    await h.asService(() => db.query('select public.declaration_mark_confirmed($1)', [rec.id]));
    expect(await h.asService(() => h.rows('select id from public.declaration_confirmations_pending(7)'))).toEqual([]);
  });
});

/* ------------------------------ Kündigungsbutton: Missbrauchsschutz ------------------------------ */
import { handleConsumerRequest } from '../../supabase/functions/_shared/legalOps';

describe('Kündigungsbutton (öffentlich)', () => {
  const send = (body: Obj, ip = '203.0.113.7') =>
    handleConsumerRequest(new Request('https://fn.test/consumer-request', { method: 'POST', headers: { Origin: 'https://olo-lab.de', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) }), deps());

  it('je IP höchstens 10 Erklärungen pro Stunde, danach 429 mit Hinweis auf E-Mail', async () => {
    env = { ...TEST_ENV };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await send({ kind: 'withdrawal', name: `Test ${i}`, email: `spam${i}@example.org` }, '198.51.100.9')).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    // andere IP ist nicht betroffen
    expect((await send({ kind: 'withdrawal', name: 'Echt', email: 'echt@example.org' }, '198.51.100.10')).status).toBe(200);
  });

  it('Steuerzeichen werden entfernt (keine Header-/Betreffmanipulation)', async () => {
    const before = mailer.sent.length;
    await send({ kind: 'withdrawal', name: 'Eva\r\nBcc: opfer@example.org', email: 'eva@example.org' }, '198.51.100.11');
    const m = mailer.sent.slice(before).find((x) => x.subject.includes('Eva'))!;
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain('Eva  Bcc: opfer@example.org');
  });

  it('automatische Kündigung bei Stripe nur für den Inhaber des Kundenkontos', async () => {
    const mia = await h.register('mia@web.de', { first_name: 'Mia', institution_type: 'private' });
    const miaInst = await h.institutionOf(mia);
    await db.query(`update public.profiles set role = 'user' where user_id = $1`, [mia]);
    await db.query(`insert into public.subscriptions (institution_id, stripe_subscription_id, status, plan, current_period_end) values ($1, 'sub_mia', 'active', 'private', now() + interval '20 days')`, [miaInst]);
    const before = stripe.calls.length;
    const r = await send({ kind: 'cancellation', cancellationType: 'ordinary', name: 'Mia', email: 'mia@web.de' }, '198.51.100.12');
    expect(r.status).toBe(200);
    expect(stripe.calls.slice(before).some((c) => c.path === 'subscriptions/sub_mia' && c.method === 'POST')).toBe(false);
    const d = (await h.rows<Obj>(`select status, result from public.consumer_declarations where email = 'mia@web.de'`))[0];
    expect(d).toMatchObject({ status: 'needs_review', result: { not_account_holder: true } });
  });
});
