/**
 * Stripe Live/Test-Preiszuordnung:
 *  - Modus nur aus dem Secret Key (sk_live_ / sk_test_); eine Price ID verrät ihren Modus nicht.
 *  - Live: ausschließlich die sechs STRIPE_PRICE_*-Secrets (Pflicht, syntaktisch gültig, nicht doppelt),
 *    kein Rückfall auf die eingebauten Standard-IDs – auch nicht, wenn die Secrets dieselben Werte haben.
 *  - Test/Entwicklung: Secret, sonst Standard-ID.
 *  - Checkout und Webhook verwenden dieselbe Zuordnung; fremde Preise schalten nichts frei.
 */
import { describe, expect, it } from 'vitest';
import { handleCheckout, handleWebhook, type BillingDb, type Deps, type StripeApi } from '../supabase/functions/_shared/handlers';
import { liveConfigProblems, PRICE_ENV, PRICE_IDS, priceIdFor, priceInfo, planForPriceId, priceTable, stripeMode } from '../supabase/functions/_shared/stripeConfig';
import { signStripePayload } from '../supabase/functions/_shared/stripeSignature';
import type { Mailer, MailMessage } from '../supabase/functions/_shared/mailer';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Live-Zuordnung laut Betreiber (Stripe-Dashboard, Live-Modus) */
const LIVE_PRICES: Record<string, string> = {
  STRIPE_PRICE_PRIVATE: 'price_1UKgZZDi0mx4WWPoSxzWozbG',
  STRIPE_PRICE_PRIVATE_YEARLY: 'price_1UKwPqDi0mx4WWPo6wJiRryZ',
  STRIPE_PRICE_BUSINESS: 'price_1UKgaqDi0mx4WWPo9VeQhU6Y',
  STRIPE_PRICE_BUSINESS_YEARLY: 'price_1UKwPZDi0mx4WWPoWV5rgRuI',
  STRIPE_PRICE_EDUCATION: 'price_1UKgdWDi0mx4WWPoJaiYfQqu',
  STRIPE_PRICE_EDUCATION_YEARLY: 'price_1UKwP0Di0mx4WWPoJiOu2iDW',
};
const COMBOS: [string, 'monthly' | 'yearly', string][] = [
  ['private', 'monthly', 'STRIPE_PRICE_PRIVATE'],
  ['private', 'yearly', 'STRIPE_PRICE_PRIVATE_YEARLY'],
  ['business', 'monthly', 'STRIPE_PRICE_BUSINESS'],
  ['business', 'yearly', 'STRIPE_PRICE_BUSINESS_YEARLY'],
  ['education', 'monthly', 'STRIPE_PRICE_EDUCATION'],
  ['education', 'yearly', 'STRIPE_PRICE_EDUCATION_YEARLY'],
];
const LIVE_KEY = 'sk_live_GEHEIM_nicht_loggen_123';
const BASE_LIVE: Record<string, string> = { STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_TAX_RATE_ID: 'txr_19inkl', SITE_URL: 'https://olo-lab.de', ...LIVE_PRICES };
const getter = (e: Record<string, string>) => (k: string) => e[k];

const ACCOUNTS: Record<string, Obj> = {
  u_private: { userId: 'u_private', email: 'p@x.de', role: 'institution_admin', institutionId: 'inst_p', institutionType: 'private', institutionName: 'Privat', license: { status: 'pending', source: 'stripe' } },
  u_business: { userId: 'u_business', email: 'b@x.de', role: 'institution_admin', institutionId: 'inst_b', institutionType: 'business', institutionName: 'Optik B', country: 'DE', license: { status: 'pending', source: 'stripe' } },
  u_education: { userId: 'u_education', email: 'e@x.de', role: 'institution_admin', institutionId: 'inst_e', institutionType: 'education', institutionName: 'Schule E', country: 'DE', license: { status: 'pending', source: 'stripe' } },
};

function setup(env: Record<string, string>, opts: { user?: string; subPrice?: string; subStatus?: string } = {}) {
  const calls: { method: string; path: string; params: Record<string, string> }[] = [];
  const applied: Obj[] = [];
  const logs: string[] = [];
  const mails: MailMessage[] = [];
  const finished: string[] = [];
  const db: BillingDb = {
    getAccount: async (id) => (ACCOUNTS[id] as never) ?? null,
    getCustomerId: async () => 'cus_1',
    linkCustomer: async (_i, c) => c,
    getLiveSubscription: async () => null,
    eventBegin: async () => true,
    eventFinish: async (_id, status) => void finished.push(status),
    applySubscription: async (s) => (applied.push(s as Obj), { license_status: 'active' }),
    checkCheckoutConsents: async () => ({ ok: true, outdated: false, missing: [] }),
    recordCheckoutConsents: async (_u, ids) => ids.length,
    missingLegalTypes: async () => [],
  };
  const stripe: StripeApi = {
    request: async (method, path, params = {}) => {
      calls.push({ method, path, params });
      if (method === 'GET' && path.startsWith('customers/')) return { id: 'cus_1' };
      if (method === 'GET' && path === 'checkout/sessions') return { object: 'list', data: [] };
      if (path === 'checkout/sessions') return { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' };
      if (path.startsWith('subscriptions/')) return { id: path.split('/')[1], customer: 'cus_1', status: opts.subStatus ?? 'active', items: { data: [{ price: { id: opts.subPrice ?? LIVE_PRICES.STRIPE_PRICE_PRIVATE } }] } };
      if (path === 'subscriptions') return { data: [] };
      throw new Error(path);
    },
  };
  const mailer: Mailer = { configured: true, notifyTo: 'info@olo-vision.de', send: async (m) => void mails.push(m) };
  const deps: Deps = { env: getter(env), authUser: async () => (opts.user ? { id: opts.user, email: '' } : null), db, stripe, mailer, log: (m) => logs.push(m) };
  return { deps, calls, applied, logs, mails, finished };
}
const checkoutReq = (plan: string, interval: string) => new Request('https://fn.test', { method: 'POST', headers: { Origin: 'https://olo-lab.de' }, body: JSON.stringify({ plan, interval, consents: [] }) });
async function webhook(t: ReturnType<typeof setup>, secret: string, type = 'customer.subscription.updated', livemode = true) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, created: 1, livemode, data: { object: { id: 'sub_1' } } });
  return handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, secret) }, body: payload }), t.deps);
}

describe('Modus nur aus dem Secret Key', () => {
  it('sk_live_ / rk_live_ = live, sk_test_ / rk_test_ = test – unabhängig von den Price IDs', () => {
    expect(stripeMode(getter(BASE_LIVE))).toBe('live');
    expect(stripeMode(getter({ ...BASE_LIVE, STRIPE_SECRET_KEY: 'rk_live_x' }))).toBe('live');
    expect(stripeMode(getter({ ...BASE_LIVE, STRIPE_SECRET_KEY: 'sk_test_x' }))).toBe('test');
  });
});

describe('Live: ausschließlich die sechs Secrets', () => {
  it('alle sechs gesetzt (auch wenn sie den eingebauten Standard-IDs entsprechen) → keine Konfigurationsprobleme', () => {
    expect(Object.values(LIVE_PRICES).sort()).toEqual(Object.values(PRICE_IDS).sort()); // genau der Fall aus dem Betrieb
    expect(liveConfigProblems(getter(BASE_LIVE))).toEqual([]);
    for (const [plan, interval, name] of COMBOS) expect(priceIdFor(plan, interval, getter(BASE_LIVE))).toBe(LIVE_PRICES[name]);
  });

  it('Checkout funktioniert für alle sechs Kombinationen mit genau der Live-Price-ID', async () => {
    for (const [plan, interval, name] of COMBOS) {
      const t = setup(BASE_LIVE, { user: `u_${plan}` });
      const res = await handleCheckout(checkoutReq(plan, interval), t.deps);
      expect(res.status, `${plan}/${interval}`).toBe(200);
      const call = t.calls.find((c) => c.method === 'POST' && c.path === 'checkout/sessions')!;
      expect(call.params['line_items[0][price]']).toBe(LIVE_PRICES[name]);
    }
  });

  it('kein Rückfall: Live-Schlüssel ohne Secrets → keine Price ID, Standard-IDs werden nicht verwendet', () => {
    const env = getter({ STRIPE_SECRET_KEY: LIVE_KEY });
    for (const [plan, interval] of COMBOS) expect(priceIdFor(plan, interval, env)).toBeNull();
    expect(priceTable(env)).toEqual({});
    for (const id of Object.values(PRICE_IDS)) expect(priceInfo(id, env)).toBeNull();
  });

  for (const name of Object.values(PRICE_ENV)) {
    it(`${name} fehlt → 503, kein Stripe-Aufruf`, async () => {
      const env = { ...BASE_LIVE };
      delete env[name];
      expect(liveConfigProblems(getter(env))).toEqual([`${name} fehlt`]);
      const t = setup(env, { user: 'u_private' });
      const res = await handleCheckout(checkoutReq('private', 'monthly'), t.deps);
      expect(res.status).toBe(503);
      expect(((await res.json()) as Obj).code).toBe('stripe_not_configured');
      expect(t.calls).toHaveLength(0);
    });
  }

  it('ungültige Price ID → 503; Meldung nennt den Secret-Namen, nie Werte', async () => {
    for (const bad of ['prod_123', 'price_', 'price_abc def', 'sk_live_versehentlich', ' ']) {
      const env = { ...BASE_LIVE, STRIPE_PRICE_BUSINESS_YEARLY: bad };
      const problems = liveConfigProblems(getter(env));
      expect(problems.length).toBe(1);
      expect(problems[0]).toMatch(/^STRIPE_PRICE_BUSINESS_YEARLY (fehlt|ist keine gültige Price ID)/);
      const t = setup(env, { user: 'u_business' });
      expect((await handleCheckout(checkoutReq('business', 'yearly'), t.deps)).status).toBe(503);
      const log = t.logs.join('\n');
      expect(log).toContain('STRIPE_PRICE_BUSINESS_YEARLY');
      if (bad.trim().length > 7) expect(log).not.toContain(bad.trim());
      expect(log).not.toContain(LIVE_KEY);
      for (const v of Object.values(LIVE_PRICES)) expect(log).not.toContain(v);
    }
  });

  it('dieselbe Price ID für zwei Produkte → 503 (Zuordnung wäre nicht eindeutig)', () => {
    const env = { ...BASE_LIVE, STRIPE_PRICE_BUSINESS: LIVE_PRICES.STRIPE_PRICE_PRIVATE };
    expect(liveConfigProblems(getter(env))).toEqual(['STRIPE_PRICE_BUSINESS und STRIPE_PRICE_PRIVATE verwenden dieselbe Price ID']);
  });
});

describe('Test/Entwicklung: Secret oder Standard-ID', () => {
  it('sk_test_ ohne Overrides → eingebaute Standardpreise, keine Konfigurationsprobleme', async () => {
    const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_t', SITE_URL: 'http://localhost:5173' };
    expect(liveConfigProblems(getter(env))).toEqual([]);
    for (const [plan, interval] of COMBOS) expect(priceIdFor(plan, interval, getter(env))).toBe(PRICE_IDS[`${plan}_${interval}` as keyof typeof PRICE_IDS]);
    const t = setup(env, { user: 'u_education' });
    const res = await handleCheckout(new Request('https://fn.test', { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: JSON.stringify({ plan: 'education', interval: 'yearly' }) }), t.deps);
    expect(res.status).toBe(200);
    expect(t.calls.find((c) => c.method === 'POST' && c.path === 'checkout/sessions')!.params['line_items[0][price]']).toBe(PRICE_IDS.education_yearly);
  });
  it('sk_test_ mit Override → Override; ungültiger Override → Standard-ID', () => {
    const env = getter({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_PRIVATE: 'price_TestPrivat', STRIPE_PRICE_BUSINESS: 'kaputt' });
    expect(priceIdFor('private', 'monthly', env)).toBe('price_TestPrivat');
    expect(priceIdFor('business', 'monthly', env)).toBe(PRICE_IDS.business_monthly);
    expect(planForPriceId('price_TestPrivat', env)).toBe('private');
  });
});

describe('Webhook: dieselbe Zuordnung wie der Checkout', () => {
  it('erkennt im Live-Modus alle sechs Live-Price-IDs korrekt', async () => {
    for (const [plan, interval, name] of COMBOS) {
      expect(priceInfo(LIVE_PRICES[name], getter(BASE_LIVE))).toEqual({ plan, interval });
      const t = setup(BASE_LIVE, { subPrice: LIVE_PRICES[name] });
      const res = await webhook(t, 'whsec_live');
      expect(res.status).toBe(200);
      expect(t.applied).toHaveLength(1);
      expect(t.applied[0]).toMatchObject({ plan, billing_interval: interval, price_id: LIVE_PRICES[name] });
    }
  });

  it('fremde Price ID → nicht akzeptiert: nichts freigeschaltet, Hinweis an den Betreiber', async () => {
    const t = setup(BASE_LIVE, { subPrice: 'price_FremdesProdukt999' });
    const res = await webhook(t, 'whsec_live');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Obj).ignored).toBe('unbekannter Preis');
    expect(t.applied).toHaveLength(0);
    expect(t.finished).toEqual(['ignored']);
    expect(t.mails.map((m) => m.subject)).toEqual(['[OLO-LAB3D] Abonnement mit unbekanntem Preis – nicht freigeschaltet']);
    expect(t.logs.join('\n')).not.toContain(LIVE_KEY);
  });

  it('Live ohne Secrets: auch die Standard-IDs gelten als fremd (kein stiller Rückfall im Webhook)', async () => {
    const t = setup({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_live' }, { subPrice: PRICE_IDS.private_monthly });
    const res = await webhook(t, 'whsec_live');
    expect(((await res.json()) as Obj).ignored).toBe('unbekannter Preis');
    expect(t.applied).toHaveLength(0);
  });

  it('Beenden wird auch bei fremdem Preis übernommen (keine Lizenz bleibt dadurch aktiv)', async () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      const t = setup(BASE_LIVE, { subPrice: 'price_FremdesProdukt999', subStatus: status });
      expect((await webhook(t, 'whsec_live', 'customer.subscription.deleted')).status).toBe(200);
      expect(t.applied[0]).toMatchObject({ status, plan: null });
    }
  });

  it('Test-Ereignis bei Live-Schlüssel wird weiterhin ignoriert', async () => {
    const t = setup(BASE_LIVE);
    const res = await webhook(t, 'whsec_live', 'customer.subscription.updated', false);
    expect(((await res.json()) as Obj).ignored).toBe('anderer Stripe-Modus');
    expect(t.applied).toHaveLength(0);
  });
});
