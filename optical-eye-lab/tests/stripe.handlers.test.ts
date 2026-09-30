/**
 * Phase 7 – Stripe: Preiszuordnung, Signatur, API-Versions-Felder und Edge-Function-Handler (mit Test-Doubles).
 * Ende-zu-Ende mit echter Datenbank: tests/db/stripe.test.ts
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_IDS, planAllowedFor, planForPriceId, priceIdForPlan, resolveSiteUrl, siteUrls, STRIPE_API_VERSION } from '../supabase/functions/_shared/stripeConfig';
import { signStripePayload, verifyStripeSignature } from '../supabase/functions/_shared/stripeSignature';
import { snapshotFromSubscription, subscriptionIdFromInvoice } from '../supabase/functions/_shared/stripeObjects';
import { handleCheckout, handlePortal, handleWebhook, HANDLED_EVENTS, type BillingAccount, type BillingDb, type Deps, type StripeApi } from '../supabase/functions/_shared/handlers';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OLD_DOC = '00000000-0000-4000-8000-000000000001';

describe('Price IDs (serverseitig)', () => {
  it('Private → korrekte Price ID', () => expect(priceIdForPlan('private')).toBe('price_1UKgZZDi0mx4WWPoSxzWozbG'));
  it('Business → korrekte Price ID', () => expect(priceIdForPlan('business')).toBe('price_1UKgaqDi0mx4WWPo9VeQhU6Y'));
  it('Education → korrekte Price ID', () => expect(priceIdForPlan('education')).toBe('price_1UKgdWDi0mx4WWPoJaiYfQqu'));
  it('unbekannter Tarif → keine Price ID', () => {
    for (const bad of ['premium', 'PRIVATE', '', null, undefined, 42, 'price_1UKgZZDi0mx4WWPoSxzWozbG', { plan: 'private' }]) expect(priceIdForPlan(bad)).toBeNull();
  });
  it('Rückrichtung Price → Tarif; fremde Preise → null; Override per Secret', () => {
    expect(planForPriceId(DEFAULT_PRICE_IDS.education)).toBe('education');
    expect(planForPriceId('price_fremd')).toBeNull();
    const env = (k: string) => (k === 'STRIPE_PRICE_BUSINESS' ? 'price_LiveBusiness123' : k === 'STRIPE_PRICE_PRIVATE' ? 'kaputt; drop' : undefined);
    expect(priceIdForPlan('business', env)).toBe('price_LiveBusiness123');
    expect(priceIdForPlan('private', env)).toBe(DEFAULT_PRICE_IDS.private); // ungültiger Override wird ignoriert
    expect(planForPriceId('price_LiveBusiness123', env)).toBe('business');
  });
  it('Tarifregel: nur der zum Kontotyp passende Tarif', () => {
    expect(planAllowedFor('business', 'business')).toBe(true);
    expect(planAllowedFor('education', 'private')).toBe(false);
    expect(planAllowedFor('private', 'education')).toBe(false);
    expect(planAllowedFor(null, 'private')).toBe(false);
  });
  it('Basis-URL nur aus der erlaubten Liste', () => {
    const env = (k: string) => (k === 'SITE_URL' ? 'https://app.olo-lab3d.de/, http://localhost:5173' : undefined);
    expect(siteUrls(env)).toEqual(['https://app.olo-lab3d.de', 'http://localhost:5173']);
    expect(resolveSiteUrl('http://localhost:5173', env)).toBe('http://localhost:5173');
    expect(resolveSiteUrl('https://evil.example', env)).toBe('https://app.olo-lab3d.de');
    expect(resolveSiteUrl(null, () => undefined)).toBe('http://localhost:5173');
  });
  it('feste, aktuelle Stripe-API-Version', () => expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/));
});

describe('Webhook-Signatur', () => {
  const secret = 'whsec_unit';
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  it('gültige Signatur wird akzeptiert', async () => {
    expect(await verifyStripeSignature(body, await signStripePayload(body, secret), secret)).toBe(true);
  });
  it('falsches Secret, veränderte Nutzlast, fehlender Header, alter Zeitstempel → abgelehnt', async () => {
    const header = await signStripePayload(body, secret);
    expect(await verifyStripeSignature(body, header, 'whsec_other')).toBe(false);
    expect(await verifyStripeSignature(body.replace('paid', 'failed'), header, secret)).toBe(false);
    expect(await verifyStripeSignature(body, null, secret)).toBe(false);
    expect(await verifyStripeSignature(body, header, '')).toBe(false);
    const old = await signStripePayload(body, secret, Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyStripeSignature(body, old, secret)).toBe(false);
    expect(await verifyStripeSignature(body, 't=abc,v1=zz', secret)).toBe(false);
  });
  it('mehrere v1-Signaturen (Secret-Rotation): eine gültige genügt', async () => {
    const good = await signStripePayload(body, secret);
    const t = good.split(',')[0];
    expect(await verifyStripeSignature(body, `${t},v1=${'0'.repeat(64)},${good.split(',')[1]}`, secret)).toBe(true);
  });
});

describe('Stripe-Objekte (API-Version Basil/Dahlia)', () => {
  const base = { id: 'sub_1', customer: 'cus_1', status: 'active', created: 1_700_000_000, cancel_at_period_end: false, metadata: { institution_id: 'i1', plan: 'private' } };
  it('Perioden aus items.data[] (aktuelle API-Versionen)', () => {
    const s = snapshotFromSubscription({ ...base, items: { data: [{ price: { id: DEFAULT_PRICE_IDS.business }, current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] } }, { eventId: 'evt_1', eventType: 'x' });
    expect(s).toMatchObject({ customer_id: 'cus_1', subscription_id: 'sub_1', price_id: DEFAULT_PRICE_IDS.business, current_period_end: new Date(1_702_592_000_000).toISOString() });
    // der abgerechnete Preis zählt, nicht die Metadaten
    expect(s.plan).toBe('business');
  });
  it('Rückfall auf alte Felder am Abo', () => {
    const s = snapshotFromSubscription({ ...base, customer: { id: 'cus_2' }, current_period_end: 1_702_592_000, items: { data: [{ price: { id: 'price_unbekannt' } }] } });
    expect(s.customer_id).toBe('cus_2');
    expect(s.current_period_end).toBe(new Date(1_702_592_000_000).toISOString());
    expect(s.plan).toBe('private');
  });
  it('Abo-ID einer Rechnung: parent.subscription_details (neu) und subscription (alt)', () => {
    expect(subscriptionIdFromInvoice({ parent: { subscription_details: { subscription: 'sub_new' } } })).toBe('sub_new');
    expect(subscriptionIdFromInvoice({ subscription: { id: 'sub_old' } })).toBe('sub_old');
    expect(subscriptionIdFromInvoice({ parent: null })).toBeNull();
  });
});

/* ------------------------------ Handler mit Test-Doubles ------------------------------ */

const ACCOUNTS: Record<string, BillingAccount> = {
  u_private: { userId: 'u_private', email: 'p@x.de', role: 'institution_admin', institutionId: 'inst_p', institutionType: 'private', institutionName: 'Privat – P', license: { status: 'pending', source: 'stripe' } },
  u_business: { userId: 'u_business', email: 'b@x.de', role: 'institution_admin', institutionId: 'inst_b', institutionType: 'business', institutionName: 'Optik B', license: { status: 'pending', source: 'stripe' } },
  u_education: { userId: 'u_education', email: 'e@x.de', role: 'institution_admin', institutionId: 'inst_e', institutionType: 'education', institutionName: 'Schule E', license: { status: 'pending', source: 'stripe' } },
  u_member: { userId: 'u_member', email: 'm@x.de', role: 'user', institutionId: 'inst_b', institutionType: 'business', institutionName: 'Optik B', license: null },
  u_manual: { userId: 'u_manual', email: 'x@x.de', role: 'institution_admin', institutionId: 'inst_m', institutionType: 'business', institutionName: 'Sonder', license: { status: 'active', source: 'manual' } },
};

function setup(opts: { user?: string | null; customers?: Record<string, string>; live?: string[]; stripeLive?: string[]; env?: Record<string, string>; consentOk?: boolean; recordFails?: boolean } = {}) {
  const calls: { method: string; path: string; params: Record<string, string>; key?: string }[] = [];
  const customers: Record<string, string> = { ...(opts.customers ?? {}) };
  const applied: Obj[] = [];
  const recorded: Obj[] = [];
  const events = new Set<string>();
  const db: BillingDb = {
    getAccount: async (id) => ACCOUNTS[id] ?? null,
    getCustomerId: async (inst) => customers[inst] ?? null,
    linkCustomer: async (inst, cus) => (customers[inst] ??= cus),
    getLiveSubscription: async (inst) => ((opts.live ?? []).includes(inst) ? { status: 'active' } : null),
    eventBegin: async (id) => (events.has(id) ? false : (events.add(id), true)),
    eventFinish: async () => undefined,
    applySubscription: async (s) => (applied.push(s), { license_status: 'active' }),
    checkCheckoutConsents: async (_u, ids) => (opts.consentOk === false ? { ok: false, outdated: ids.includes(OLD_DOC), missing: [{ id: 'd', type: 'terms', version: '1' }] } : { ok: true, outdated: false, missing: [] }),
    recordCheckoutConsents: async (u, ids, sid, plan, interval) => {
      if (opts.recordFails) throw Object.assign(new Error('outdated'), { code: 'OLC02' });
      recorded.push({ u, ids, sid, plan, interval });
      return ids.length;
    },
  };
  const stripe: StripeApi = {
    request: async (method, path, params = {}, key) => {
      calls.push({ method, path, params, key });
      if (path === 'customers') return { id: 'cus_new' };
      if (path === 'checkout/sessions') return { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' };
      if (path.endsWith('/expire')) return { id: 'cs_1', status: 'expired' };
      if (path === 'billing_portal/sessions') return { url: `https://portal.test/${params.customer}` };
      if (method === 'GET' && path.startsWith('customers/')) return { id: decodeURIComponent(path.slice(10)) };
      if (path.startsWith('subscriptions/')) return { id: path.split('/')[1], customer: 'cus_1', status: 'active', items: { data: [] } };
      if (path === 'subscriptions') return { data: (opts.stripeLive ?? []).includes(params.customer) ? [{ id: 'sub_live', status: 'active' }] : [{ id: 'sub_old', status: 'canceled' }] };
      throw new Error(path);
    },
  };
  const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_h', ...(opts.env ?? {}) };
  const deps: Deps = { env: (k) => (env as Record<string, string>)[k], authUser: async () => (opts.user ? { id: opts.user, email: '' } : null), db, stripe };
  return { deps, calls, customers, applied, recorded };
}

const req = (body: unknown, origin = 'http://localhost:5173') => new Request('https://fn.test', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) });

describe('create-checkout-session', () => {
  it('nicht eingeloggter Nutzer kann keinen Checkout erzeugen (401)', async () => {
    const t = setup({ user: null });
    const res = await handleCheckout(req({ plan: 'private' }), t.deps);
    expect(res.status).toBe(401);
    expect(t.calls).toHaveLength(0);
  });

  it.each([
    ['u_private', 'private', 'price_1UKgZZDi0mx4WWPoSxzWozbG'],
    ['u_business', 'business', 'price_1UKgaqDi0mx4WWPo9VeQhU6Y'],
    ['u_education', 'education', 'price_1UKgdWDi0mx4WWPoJaiYfQqu'],
  ])('%s bucht %s → Stripe erhält %s', async (user, plan, price) => {
    const t = setup({ user });
    const res = await handleCheckout(req({ plan }), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/cs_1' });
    const s = t.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(s.params).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: 'http://localhost:5173/license?checkout=success',
      cancel_url: 'http://localhost:5173/pricing?checkout=cancelled',
      'subscription_data[metadata][institution_id]': ACCOUNTS[user].institutionId,
      'subscription_data[metadata][plan]': plan,
      client_reference_id: ACCOUNTS[user].institutionId,
    });
    expect(s.key).toMatch(/^checkout-/);
  });

  it('unbekannter Tarif wird abgelehnt (400), keine Stripe-Anfrage', async () => {
    for (const plan of ['premium', undefined, 'price_1UKgZZDi0mx4WWPoSxzWozbG']) {
      const t = setup({ user: 'u_private' });
      const res = await handleCheckout(req({ plan }), t.deps);
      expect(res.status).toBe(400);
      expect(t.calls).toHaveLength(0);
    }
  });

  it('Price, Customer und Institution aus dem Request werden ignoriert', async () => {
    const t = setup({ user: 'u_business', customers: { inst_b: 'cus_own', inst_e: 'cus_foreign' } });
    const res = await handleCheckout(req({ plan: 'business', price: 'price_billig', priceId: 'price_billig', customer: 'cus_foreign', institution_id: 'inst_e', success_url: 'https://evil.example' }), t.deps);
    expect(res.status).toBe(200);
    const s = t.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(s.params.customer).toBe('cus_own');
    expect(s.params['line_items[0][price]']).toBe(DEFAULT_PRICE_IDS.business);
    expect(s.params.client_reference_id).toBe('inst_b');
    expect(s.params.success_url.startsWith('http://localhost:5173/')).toBe(true);
    expect(t.calls.some((c) => c.path === 'customers')).toBe(false);
  });

  it('neuer Kunde wird mit Idempotenz-Schlüssel je Institution angelegt und gespeichert', async () => {
    const t = setup({ user: 'u_education' });
    await handleCheckout(req({ plan: 'education' }), t.deps);
    const c = t.calls.find((x) => x.path === 'customers')!;
    expect(c.key).toBe('customer-inst_e');
    expect(c.params['metadata[institution_id]']).toBe('inst_e');
    expect(t.customers.inst_e).toBe('cus_new');
  });

  it('Tarif passend zum Kontotyp, sonst 422', async () => {
    const t = setup({ user: 'u_education' });
    const res = await handleCheckout(req({ plan: 'private' }), t.deps);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Obj).code).toBe('plan_mismatch');
    expect(t.calls).toHaveLength(0);
  });

  it('kein zweites Abo (409), keine Buchung über aktive Sonderlizenz (409), normale Mitglieder (403)', async () => {
    expect((await handleCheckout(req({ plan: 'business' }), setup({ user: 'u_business', live: ['inst_b'] }).deps)).status).toBe(409);
    expect((await handleCheckout(req({ plan: 'business' }), setup({ user: 'u_manual' }).deps)).status).toBe(409);
    expect((await handleCheckout(req({ plan: 'business' }), setup({ user: 'u_member' }).deps)).status).toBe(403);
  });

  it('Abo bei Stripe schon vorhanden, Webhook aber noch nicht da → 409 statt zweitem Abo', async () => {
    const t = setup({ user: 'u_business', customers: { inst_b: 'cus_own' }, stripeLive: ['cus_own'] });
    const res = await handleCheckout(req({ plan: 'business' }), t.deps);
    expect(res.status).toBe(409);
    expect(t.calls.some((c) => c.path === 'checkout/sessions')).toBe(false);
  });

  it('ohne STRIPE_SECRET_KEY: 503, fremde Origin → konfigurierte Basis-URL', async () => {
    expect((await handleCheckout(req({ plan: 'private' }), setup({ user: 'u_private', env: { STRIPE_SECRET_KEY: '' } }).deps)).status).toBe(503);
    const t = setup({ user: 'u_private', env: { SITE_URL: 'https://app.olo-lab3d.de' } });
    const res = await handleCheckout(req({ plan: 'private' }, 'https://evil.example'), t.deps);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.olo-lab3d.de');
    expect(t.calls.find((c) => c.path === 'checkout/sessions')!.params.success_url).toBe('https://app.olo-lab3d.de/license?checkout=success');
  });
});

describe('create-customer-portal', () => {
  it('nur für den eigenen Stripe Customer', async () => {
    const t = setup({ user: 'u_business', customers: { inst_b: 'cus_own', inst_e: 'cus_foreign' } });
    const res = await handlePortal(req({ customer: 'cus_foreign' }), t.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://portal.test/cus_own' });
    // zuerst den eigenen Kunden bei Stripe prüfen, dann die Portal-Sitzung für genau diesen Kunden
    expect(t.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET customers/cus_own', 'POST billing_portal/sessions']);
    expect(t.calls[1].params).toMatchObject({ customer: 'cus_own', return_url: 'http://localhost:5173/account' });
  });
  it('ohne eigenen Customer 404 (auch wenn andere existieren), ohne Anmeldung 401', async () => {
    const t = setup({ user: 'u_private', customers: { inst_b: 'cus_own' } });
    expect((await handlePortal(req({ customer: 'cus_own' }), t.deps)).status).toBe(404);
    expect(t.calls).toHaveLength(0);
    expect((await handlePortal(req({}), setup({ user: null }).deps)).status).toBe(401);
    expect((await handlePortal(req({}), setup({ user: 'u_member', customers: { inst_b: 'cus_own' } }).deps)).status).toBe(403);
  });
});

describe('stripe-webhook', () => {
  const send = async (t: ReturnType<typeof setup>, event: Obj, secret = 'whsec_h') => {
    const payload = JSON.stringify(event);
    return handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, secret) }, body: payload }), t.deps);
  };
  it('ungültige Signatur → 400, nichts verarbeitet', async () => {
    const t = setup();
    const res = await send(t, { id: 'evt_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }, 'whsec_falsch');
    expect(res.status).toBe(400);
    expect(t.calls).toHaveLength(0);
    expect(t.applied).toHaveLength(0);
  });
  it('ohne Webhook-Secret → 503', async () => {
    const t = setup({ env: { STRIPE_WEBHOOK_SECRET: '' } });
    expect((await send(t, { id: 'evt_1', type: 'invoice.paid', data: { object: {} } })).status).toBe(503);
  });
  it('doppeltes Ereignis → nur einmal angewendet', async () => {
    const t = setup();
    const e = { id: 'evt_2', type: 'customer.subscription.updated', created: 1, data: { object: { id: 'sub_1' } } };
    expect((await send(t, e)).status).toBe(200);
    const again = await send(t, e);
    expect(((await again.json()) as Obj).duplicate).toBe(true);
    expect(t.applied).toHaveLength(1);
  });
  it('nicht benötigte Ereignisse werden quittiert und ignoriert', async () => {
    const t = setup();
    const res = await send(t, { id: 'evt_3', type: 'charge.succeeded', data: { object: {} } });
    expect(res.status).toBe(200);
    expect(t.calls).toHaveLength(0);
  });
  it('Abo wird frisch von Stripe geladen (nicht aus der Ereignis-Nutzlast)', async () => {
    const t = setup();
    await send(t, { id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_9', status: 'active_gefälscht' } } });
    expect(t.calls[0]).toMatchObject({ method: 'GET', path: 'subscriptions/sub_9' });
    expect(t.applied[0]).toMatchObject({ subscription_id: 'sub_9', status: 'active', event_id: 'evt_4' });
  });
  it('mindestens die geforderten Ereignisse werden verarbeitet', () => {
    for (const e of ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']) {
      expect(HANDLED_EVENTS as readonly string[]).toContain(e);
    }
  });
});

/* ------------------------------ Supabase-Schlüssel der Edge Functions ------------------------------ */
import { bearerToken, jwtRole, parseKeySet, resolvePublishableKey, resolveServerKey, SERVER_CLIENT_OPTIONS } from '../supabase/functions/_shared/supabaseKeys';

describe('Supabase-Schlüssel (Admin-Client vs. Identität)', () => {
  const jwt = (role: string) => `h.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.s`;
  const envOf = (vars: Record<string, string>) => (k: string) => vars[k];

  it('neue Architektur: default-Secret aus SUPABASE_SECRET_KEYS', () => {
    expect(resolveServerKey(envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ internal: 'sb_secret_b', default: 'sb_secret_a' }) }))).toEqual({ source: 'secret_keys', name: 'default', key: 'sb_secret_a' });
    expect(resolveServerKey(envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ internal: 'sb_secret_b' }) }))).toMatchObject({ name: 'internal' });
    // neue Schlüssel haben Vorrang vor dem Legacy-Schlüssel
    expect(resolveServerKey(envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}', SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') })).source).toBe('secret_keys');
  });
  it('Legacy-Rückfall nur mit echtem service_role-Schlüssel', () => {
    expect(resolveServerKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') })).source).toBe('legacy_service_role');
    expect(() => resolveServerKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }))).toThrow(/kein service_role/);
    expect(() => resolveServerKey(envOf({}))).toThrow(/Kein Server-Schlüssel/);
  });
  it('Publishable/Anon-Key wird NIE als Admin-Schlüssel verwendet', () => {
    expect(() => resolveServerKey(envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_publishable_x"}' }))).toThrow(/kein Secret Key/);
    expect(() => resolveServerKey(envOf({ SUPABASE_SECRET_KEYS: 'kaputt' }))).toThrow(/Kein Server-Schlüssel/);
  });
  it('Identitäts-Client: Publishable Key, niemals ein geheimer', () => {
    expect(resolvePublishableKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_p"}' }))).toBe('sb_publishable_p');
    expect(resolvePublishableKey(envOf({ SUPABASE_ANON_KEY: jwt('anon') }))).toBe(jwt('anon'));
    expect(() => resolvePublishableKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_secret_s"}' }))).toThrow(/geheimer/);
    expect(() => resolvePublishableKey(envOf({ SUPABASE_ANON_KEY: jwt('service_role') }))).toThrow(/geheimer/);
  });
  it('Benutzer-Token: nur JWT aus "Authorization: Bearer", keine API-Schlüssel', () => {
    const r = (h?: string) => new Request('https://x', { headers: h ? { Authorization: h } : {} });
    expect(bearerToken(r('Bearer a.b.c'))).toBe('a.b.c');
    expect(bearerToken(r())).toBeNull();
    expect(bearerToken(r('Bearer sb_secret_x'))).toBeNull();
    expect(bearerToken(r('Bearer sb_publishable_x'))).toBeNull();
    expect(bearerToken(r('Basic abc'))).toBeNull();
  });
  it('Hilfen: Schlüsselsatz lesen, Rolle eines JWT, sichere Client-Optionen ohne Header', () => {
    expect(parseKeySet('{"default":"k"," x":""}')).toEqual({ default: 'k' });
    expect(parseKeySet('[1]')).toEqual({});
    expect(jwtRole(jwt('service_role'))).toBe('service_role');
    expect(jwtRole('sb_secret_x')).toBeNull();
    expect(SERVER_CLIENT_OPTIONS.global.headers).toEqual({});
    expect(SERVER_CLIENT_OPTIONS.auth.persistSession).toBe(false);
  });
});

describe('Unerwartete Fehler', () => {
  it('Datenbankfehler (z. B. fehlende Rechte) → 500 mit CORS, neutrale Meldung, nur Fehlertext im Log', async () => {
    const t = setup({ user: 'u_business' });
    const logs: string[] = [];
    t.deps.db.getAccount = async () => {
      throw Object.assign(new Error('permission denied for table profiles'), { code: '42501' });
    };
    t.deps.log = (m) => logs.push(m);
    const res = await handleCheckout(req({ plan: 'business' }), t.deps);
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(await res.json()).toEqual({ error: 'Interner Fehler. Bitte versuchen Sie es später erneut.', code: 'internal' });
    expect(logs).toEqual(['create-checkout-session: permission denied for table profiles']);
    expect((await handlePortal(req({}), t.deps)).status).toBe(500);
  });
});

/* ------------------------------ Phase 8: Monat/Jahr + Zustimmungen ------------------------------ */
import { PRICE_IDS, priceIdFor, priceInfo } from '../supabase/functions/_shared/stripeConfig';

describe('Preis-Mapping monatlich/jährlich (serverseitige Whitelist)', () => {
  it.each([
    ['private', 'monthly', 'price_1UKgZZDi0mx4WWPoSxzWozbG'],
    ['private', 'yearly', 'price_1UKwPqDi0mx4WWPo6wJiRryZ'],
    ['business', 'monthly', 'price_1UKgaqDi0mx4WWPo9VeQhU6Y'],
    ['business', 'yearly', 'price_1UKwPZDi0mx4WWPoWV5rgRuI'],
    ['education', 'monthly', 'price_1UKgdWDi0mx4WWPoJaiYfQqu'],
    ['education', 'yearly', 'price_1UKwP0Di0mx4WWPoJiOu2iDW'],
  ])('%s_%s → %s (und zurück)', (plan, interval, price) => {
    expect(priceIdFor(plan, interval)).toBe(price);
    expect(priceInfo(price)).toEqual({ plan, interval });
  });
  it('unbekannte Kombinationen → null; Price IDs aus dem Browser werden nie akzeptiert', () => {
    for (const [p, i] of [['private', 'weekly'], ['demo', 'monthly'], ['private', ''], ['price_1UKwPqDi0mx4WWPo6wJiRryZ', 'yearly'], [null, null]]) expect(priceIdFor(p, i)).toBeNull();
    expect(Object.keys(PRICE_IDS).sort()).toEqual(['business_monthly', 'business_yearly', 'education_monthly', 'education_yearly', 'private_monthly', 'private_yearly']);
  });
  it('Jahrespreise per Secret überschreibbar (Live-Modus)', () => {
    const env = (k: string) => (k === 'STRIPE_PRICE_EDUCATION_YEARLY' ? 'price_LiveEduYear' : undefined);
    expect(priceIdFor('education', 'yearly', env)).toBe('price_LiveEduYear');
    expect(priceInfo('price_LiveEduYear', env)).toEqual({ plan: 'education', interval: 'yearly' });
  });
});

describe('create-checkout-session – Phase 8', () => {
  const DOC = '11111111-2222-4333-8444-555555555555';
  it.each([
    ['u_private', 'private', 'yearly', 'price_1UKwPqDi0mx4WWPo6wJiRryZ'],
    ['u_business', 'business', 'yearly', 'price_1UKwPZDi0mx4WWPoWV5rgRuI'],
    ['u_education', 'education', 'monthly', 'price_1UKgdWDi0mx4WWPoJaiYfQqu'],
  ])('%s bucht %s %s → %s, Intervall in den Metadaten', async (user, plan, interval, price) => {
    const t = setup({ user });
    const res = await handleCheckout(req({ plan, interval, consents: [DOC] }), t.deps);
    expect(res.status).toBe(200);
    const s = t.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(s.params).toMatchObject({ 'line_items[0][price]': price, 'metadata[billing_interval]': interval, 'subscription_data[metadata][billing_interval]': interval });
    expect(t.recorded).toEqual([{ u: user, ids: [DOC], sid: 'cs_1', plan, interval }]);
  });
  it('ohne Intervall → monatlich (kompatibel); unbekanntes Intervall → 400', async () => {
    const t = setup({ user: 'u_private' });
    await handleCheckout(req({ plan: 'private' }), t.deps);
    expect(t.calls.find((c) => c.path === 'checkout/sessions')!.params['line_items[0][price]']).toBe('price_1UKgZZDi0mx4WWPoSxzWozbG');
    const t2 = setup({ user: 'u_private' });
    expect((await handleCheckout(req({ plan: 'private', interval: 'weekly' }), t2.deps)).status).toBe(400);
    expect(t2.calls).toHaveLength(0);
  });
  it('fehlende Zustimmungen → 422, KEINE Stripe-Anfrage', async () => {
    const t = setup({ user: 'u_private', consentOk: false });
    const res = await handleCheckout(req({ plan: 'private', interval: 'monthly', consents: [] }), t.deps);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Obj).code).toBe('consents_missing');
    expect(t.calls).toHaveLength(0);
  });
  it('veraltete Dokumentversion → 409 consents_outdated', async () => {
    const t = setup({ user: 'u_private', consentOk: false });
    const res = await handleCheckout(req({ plan: 'private', interval: 'monthly', consents: [OLD_DOC] }), t.deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Obj).code).toBe('consents_outdated');
  });
  it('Protokoll schlägt fehl → Session wird sofort ungültig gemacht, keine URL', async () => {
    const t = setup({ user: 'u_private', recordFails: true });
    const res = await handleCheckout(req({ plan: 'private', interval: 'yearly', consents: [DOC] }), t.deps);
    expect(res.status).toBe(409);
    expect(await res.json()).not.toHaveProperty('url');
    expect(t.calls.some((c) => c.path === 'checkout/sessions/cs_1/expire')).toBe(true);
  });
  it('B2B: Rechnungsadresse Pflicht + USt-IdNr.-Erfassung; B2C: ohne USt-IdNr.', async () => {
    const b = setup({ user: 'u_education' });
    await handleCheckout(req({ plan: 'education', interval: 'yearly' }), b.deps);
    expect(b.calls.find((c) => c.path === 'checkout/sessions')!.params).toMatchObject({ billing_address_collection: 'required', 'tax_id_collection[enabled]': 'true', 'customer_update[address]': 'auto' });
    const p = setup({ user: 'u_private' });
    await handleCheckout(req({ plan: 'private', interval: 'yearly' }), p.deps);
    const params = p.calls.find((c) => c.path === 'checkout/sessions')!.params;
    expect(params.billing_address_collection).toBe('auto');
    expect(params['tax_id_collection[enabled]']).toBeUndefined();
  });
  it('nur gültige UUIDs werden als Zustimmung weitergereicht', async () => {
    const t = setup({ user: 'u_private' });
    await handleCheckout(req({ plan: 'private', interval: 'monthly', consents: [DOC, 'x', 42, "'; drop table"] }), t.deps);
    expect(t.recorded[0].ids).toEqual([DOC]);
  });
});

describe('Webhook – Phase 8', () => {
  it('Intervall aus Whitelist bzw. Stripe-Preis; Session-ID nur aus checkout.session.*', () => {
    const base = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: {} };
    expect(snapshotFromSubscription({ ...base, items: { data: [{ price: { id: 'price_1UKwPZDi0mx4WWPoWV5rgRuI' } }] } }).billing_interval).toBe('yearly');
    expect(snapshotFromSubscription({ ...base, items: { data: [{ price: { id: 'price_unbekannt', recurring: { interval: 'month' } } }] } }).billing_interval).toBe('monthly');
    expect(snapshotFromSubscription({ ...base, items: { data: [] } }, { checkoutSessionId: 'cs_abc' }).checkout_session_id).toBe('cs_abc');
    expect(snapshotFromSubscription({ ...base, items: { data: [] } }, { checkoutSessionId: 'evil' }).checkout_session_id).toBeNull();
  });
  it('checkout.session.completed übergibt die Session-ID an die Datenbank', async () => {
    const t = setup();
    const e = { id: 'evt_s1', type: 'checkout.session.completed', data: { object: { id: 'cs_live_1', mode: 'subscription', subscription: 'sub_7' } } };
    const payload = JSON.stringify(e);
    await handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, 'whsec_h') }, body: payload }), t.deps);
    expect(t.applied[0]).toMatchObject({ subscription_id: 'sub_7', checkout_session_id: 'cs_live_1' });
  });
});
