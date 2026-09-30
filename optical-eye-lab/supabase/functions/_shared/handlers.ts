/**
 * Fachlogik der drei Stripe-Edge-Functions als reine Funktionen mit austauschbaren Abhängigkeiten.
 * Die index.ts-Dateien verbinden sie mit Supabase (service_role, nur serverseitig) und der Stripe-API
 * (_shared/deps.ts). Die Tests (tests/stripe.*.test.ts) verwenden dieselben Handler mit Test-Doubles
 * bzw. einer echten PostgreSQL-Datenbank.
 *
 * Sicherheit:
 *  - Checkout/Portal: nur mit gültigem Benutzer-JWT; Institution, Stripe Customer und Price ID werden
 *    ausschließlich serverseitig bestimmt – Felder wie price, customer, institution_id im Request-Body
 *    werden ignoriert.
 *  - Webhook: ohne Benutzer-JWT, aber nur mit gültiger Stripe-Signatur (STRIPE_WEBHOOK_SECRET);
 *    idempotent über public.stripe_events; Abo-Daten werden frisch von der Stripe-API geladen.
 *  - Keine Secrets, Tokens oder Payloads in Logs.
 */
import { checkoutSubmitMessage, corsHeaders, isBillingInterval, PLAN_MISMATCH_MESSAGE, planAllowedFor, priceIdFor, resolveSiteUrl, type BillingInterval, type EnvGetter } from './stripeConfig.ts';
import { isPlan, LIVE_SUBSCRIPTION_STATUSES, type InstitutionType, type LicensePlan, type LicenseStatus } from './licenseStatus.ts';
import { verifyStripeSignature } from './stripeSignature.ts';
import { idOf, snapshotFromSubscription, subscriptionIdFromInvoice, type SubscriptionSnapshot } from './stripeObjects.ts';
import { afterCheckoutCompleted, enforceNoAutoRenewal, type OpsDb } from './legalOps.ts';
import { isPortalNotConfigured, isResourceMissing, StripeError } from './stripeError.ts';
import type { Mailer } from './mailer.ts';
import type { AccountDb } from './accountOps.ts';

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export interface BillingAccount {
  userId: string;
  email: string;
  role: 'super_admin' | 'institution_admin' | 'user';
  institutionId: string;
  institutionType: InstitutionType;
  institutionName: string;
  /** Land der Rechnungsanschrift aus der Registrierung (ISO, z. B. DE) */
  country?: string | null;
  license: { status: LicenseStatus; source: 'stripe' | 'manual' } | null;
}

export interface BillingDb {
  getAccount(userId: string): Promise<BillingAccount | null>;
  getCustomerId(institutionId: string): Promise<string | null>;
  /** Customer der Institution speichern; existiert bereits einer, gewinnt der vorhandene (Rückgabe) */
  linkCustomer(institutionId: string, customerId: string): Promise<string>;
  /** laufendes Abo (active, trialing, past_due, unpaid, paused) der Institution */
  getLiveSubscription(institutionId: string): Promise<{ status: string } | null>;
  eventBegin(id: string, type: string, createdIso: string | null): Promise<boolean>;
  eventFinish(id: string, status: 'processed' | 'ignored' | 'failed', error?: string | null): Promise<void>;
  applySubscription(snapshot: SubscriptionSnapshot): Promise<Obj>;
  /** Phase 8: Zustimmungen für den Kauf prüfen (erforderliche Dokumente = aktuelle Versionen, serverseitig) */
  checkCheckoutConsents(userId: string, documentIds: string[]): Promise<{ ok: boolean; outdated: boolean; missing: Array<{ id: string; type: string; version: string }> }>;
  /** Phase 8: Zustimmungen mit Checkout-Session protokollieren (prüft erneut; Fehlercodes OLC01/OLC02) */
  recordCheckoutConsents(userId: string, documentIds: string[], checkoutSessionId: string, plan: LicensePlan, interval: BillingInterval): Promise<number>;
}

export interface StripeApi {
  request(method: 'GET' | 'POST', path: string, params?: Record<string, string>, idempotencyKey?: string): Promise<Obj>;
}

export interface Deps {
  env: EnvGetter;
  /** Benutzer aus dem Authorization-Header (von Supabase Auth geprüft) oder null; issuedAt = iat des JWT (s) */
  authUser(req: Request): Promise<{ id: string; email: string; issuedAt?: number } | null>;
  db: BillingDb;
  stripe: StripeApi;
  now?: () => number;
  log?: (message: string) => void;
  /** Rechtsbetrieb: Erklärungen, Vertragsbestätigung, E-Mail-Protokoll (optional – ohne: keine E-Mails) */
  ops?: OpsDb;
  mailer?: Mailer;
  /** Kontoverwaltung (Edge Function delete-account) */
  accountDb?: AccountDb;
}

/** Steuersatz „19 % DE, inklusive“ aus dem Stripe-Dashboard (Function Secret STRIPE_TAX_RATE_ID) */
export const taxRateId = (env: EnvGetter) => {
  const v = env('STRIPE_TAX_RATE_ID')?.trim();
  return v && /^txr_[A-Za-z0-9]+$/.test(v) ? v : null;
};

export const B2B_COUNTRY_MESSAGE =
  'Buchungen für Unternehmen und Bildungseinrichtungen sind derzeit nur mit Sitz in Deutschland möglich. Bitte wenden Sie sich für ein Angebot an info@olo-vision.de.';

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

const ADMIN_ROLES = new Set(['institution_admin', 'super_admin']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unerwartete Fehler (z. B. Datenbank/Konfiguration) → 500 mit CORS-Headern und neutraler Meldung;
 * ins Log nur die Fehlermeldung (ohne Token, Payload oder Schlüssel).
 */
function guarded(name: string, fn: (req: Request, deps: Deps) => Promise<Response>) {
  return async (req: Request, deps: Deps): Promise<Response> => {
    try {
      return await fn(req, deps);
    } catch (e) {
      deps.log?.(`${name}: ${errMsg(e)}`);
      return json({ error: 'Interner Fehler. Bitte versuchen Sie es später erneut.', code: 'internal' }, 500, name === 'stripe-webhook' ? {} : corsHeaders(req.headers.get('Origin'), deps.env));
    }
  };
}

/** Gemeinsamer Vorspann für Checkout und Portal */
async function authorize(req: Request, deps: Deps, cors: Record<string, string>): Promise<{ account: BillingAccount } | { response: Response }> {
  if (req.method !== 'POST') return { response: json({ error: 'Methode nicht erlaubt.' }, 405, cors) };
  const user = await deps.authUser(req).catch(() => null);
  if (!user) return { response: json({ error: 'Bitte melden Sie sich an.', code: 'unauthenticated' }, 401, cors) };
  const account = await deps.db.getAccount(user.id);
  if (!account) return { response: json({ error: 'Zu Ihrem Konto gibt es kein Profil.', code: 'no_profile' }, 403, cors) };
  if (!ADMIN_ROLES.has(account.role)) return { response: json({ error: 'Nur die Administration Ihres Kundenkontos kann das Abonnement verwalten.', code: 'forbidden' }, 403, cors) };
  if (!deps.env('STRIPE_SECRET_KEY')) return { response: json({ error: 'Die Online-Zahlung ist noch nicht eingerichtet.', code: 'stripe_not_configured' }, 503, cors) };
  return { account };
}

/* ------------------------------------------------------------------------------------------------ */
/* create-checkout-session                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export const handleCheckout = guarded('create-checkout-session', checkout);

async function checkout(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin, deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const auth = await authorize(req, deps, cors);
  if ('response' in auth) return auth.response;
  const { account } = auth;

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown; interval?: unknown; consents?: unknown };
  // Nur interner Tarif + Intervall zählen – alles andere im Body (price, customer, …) wird ignoriert.
  const plan = body?.plan;
  const interval: unknown = body?.interval ?? 'monthly';
  if (!isPlan(plan)) return json({ error: 'Unbekannter Tarif.', code: 'unknown_plan' }, 400, cors);
  if (!isBillingInterval(interval)) return json({ error: 'Unbekanntes Abrechnungsintervall.', code: 'unknown_interval' }, 400, cors);
  const priceId = priceIdFor(plan, interval, deps.env);
  if (!priceId) return json({ error: 'Unbekannter Tarif.', code: 'unknown_plan' }, 400, cors);
  if (!planAllowedFor(account.institutionType, plan)) return json({ error: PLAN_MISMATCH_MESSAGE[plan], code: 'plan_mismatch' }, 422, cors);
  // B2B vorerst nur mit Sitz in Deutschland (fester deutscher Steuersatz, kein Reverse Charge)
  if (account.institutionType !== 'private' && (account.country ?? 'DE').toUpperCase() !== 'DE') {
    return json({ error: B2B_COUNTRY_MESSAGE, code: 'b2b_country' }, 422, cors);
  }
  const consentIds = Array.isArray(body?.consents) ? body.consents.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 20) : [];

  if (account.license?.source === 'manual' && account.license.status === 'active') {
    return json({ error: 'Für Ihr Konto ist eine Sonderlizenz freigeschaltet. Bitte wenden Sie sich an info@olo-vision.de.', code: 'manual_license' }, 409, cors);
  }
  const live = await deps.db.getLiveSubscription(account.institutionId);
  if (live) {
    return json({ error: 'Es besteht bereits ein Abonnement. Sie können es unter „Abonnement verwalten“ ändern.', code: 'subscription_exists' }, 409, cors);
  }

  // Rechtliche Zustimmungen: serverseitig gegen die aktuell gültigen Dokumentversionen prüfen
  const consent = await deps.db.checkCheckoutConsents(account.userId, consentIds);
  if (!consent.ok) {
    return consent.outdated
      ? json({ error: 'Die Rechtstexte wurden inzwischen aktualisiert. Bitte prüfen Sie sie und bestätigen Sie erneut.', code: 'consents_outdated' }, 409, cors)
      : json({ error: 'Bitte bestätigen Sie alle erforderlichen Rechtstexte.', code: 'consents_missing', missing: consent.missing }, 422, cors);
  }

  let sessionId = '';
  let sessionUrl = '';
  try {
    const customerId = await ensureCustomer(account, deps);
    // Zusätzlich bei Stripe prüfen (Quelle der Wahrheit): Zwischen Zahlung und Webhook ist die Datenbank
    // noch leer – so entsteht auch dann kein zweites Abo.
    const existing = await deps.stripe.request('GET', 'subscriptions', { customer: customerId, status: 'all', limit: '20' });
    const list: Obj[] = Array.isArray(existing?.data) ? existing.data : [];
    if (list.some((x) => LIVE_SUBSCRIPTION_STATUSES.includes(x?.status))) {
      return json({ error: 'Es besteht bereits ein Abonnement. Sie können es unter „Abonnement verwalten“ ändern.', code: 'subscription_exists' }, 409, cors);
    }
    const site = resolveSiteUrl(origin, deps.env);
    const bucket = Math.floor((deps.now?.() ?? Date.now()) / 60000);
    const b2b = account.institutionType !== 'private';
    const params: Record<string, string> = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: account.institutionId,
      success_url: `${site}/license?checkout=success`,
      cancel_url: `${site}/pricing?checkout=cancelled`,
      locale: 'de',
      'metadata[institution_id]': account.institutionId,
      'metadata[user_id]': account.userId,
      'metadata[plan]': plan,
      'metadata[billing_interval]': interval,
      'metadata[customer_type]': account.institutionType,
      'subscription_data[metadata][institution_id]': account.institutionId,
      'subscription_data[metadata][plan]': plan,
      'subscription_data[metadata][billing_interval]': interval,
      'subscription_data[metadata][customer_type]': account.institutionType,
      // Hinweis direkt am Stripe-Button „Abonnieren“ (zahlungspflichtige Bestellung, Laufzeit, Bedingungen)
      'custom_text[submit][message]': checkoutSubmitMessage(plan, interval, !b2b),
      billing_address_collection: b2b ? 'required' : 'auto',
      // Name/Adresse aus dem Checkout am Kunden speichern (für Rechnungen)
      'customer_update[address]': 'auto',
      'customer_update[name]': 'auto',
    };
    // B2B: USt-IdNr. im Checkout erfassen (Stripe prüft das Format je Land)
    if (b2b) params['tax_id_collection[enabled]'] = 'true';
    // 19 % USt. (inklusive) auf Rechnungen ausweisen – Steuersatz im Stripe-Dashboard anlegen
    const taxRate = taxRateId(deps.env);
    if (taxRate) params['subscription_data[default_tax_rates][0]'] = taxRate;
    else deps.log?.('create-checkout-session: STRIPE_TAX_RATE_ID fehlt – Rechnungen ohne Steuerausweis');
    const session = await deps.stripe.request(
      'POST',
      'checkout/sessions',
      params,
      // Doppelklick/Wiederholung innerhalb einer Minute → dieselbe Session statt einer zweiten
      `checkout-${account.institutionId}-${plan}-${interval}-${consentIds.slice().sort().join('.').slice(0, 120)}-${bucket}`,
    );
    if (typeof session.url !== 'string' || typeof session.id !== 'string') throw new Error('Checkout-Session ohne URL/ID');
    sessionId = session.id;
    sessionUrl = session.url;
  } catch (e) {
    deps.log?.(`create-checkout-session: ${errMsg(e)}`);
    return json({ error: 'Die Zahlungsseite konnte nicht geöffnet werden. Bitte versuchen Sie es später erneut.', code: 'stripe_error' }, 502, cors);
  }

  // Zustimmungen mit der konkreten Checkout-Session protokollieren. Scheitert das (z. B. Dokument wurde
  // genau jetzt aktualisiert), wird die Session sofort ungültig gemacht – ohne Protokoll kein Kauf.
  try {
    await deps.db.recordCheckoutConsents(account.userId, consentIds, sessionId, plan, interval);
  } catch (e) {
    deps.log?.(`create-checkout-session: Zustimmungen nicht gespeichert – ${errMsg(e)}`);
    await deps.stripe.request('POST', `checkout/sessions/${encodeURIComponent(sessionId)}/expire`).catch(() => undefined);
    const outdated = (e as { code?: string })?.code === 'OLC02';
    return json(
      outdated
        ? { error: 'Die Rechtstexte wurden inzwischen aktualisiert. Bitte prüfen Sie sie und bestätigen Sie erneut.', code: 'consents_outdated' }
        : { error: 'Die Bestellung konnte nicht vorbereitet werden. Bitte versuchen Sie es erneut.', code: 'consents_failed' },
      409,
      cors,
    );
  }
  return json({ url: sessionUrl }, 200, cors);
}

/** Genau ein Stripe Customer je Institution: vorhandenen verwenden, sonst anlegen und speichern */
async function ensureCustomer(account: BillingAccount, deps: Deps): Promise<string> {
  const existing = await deps.db.getCustomerId(account.institutionId);
  if (existing) return existing;
  const customer = await deps.stripe.request(
    'POST',
    'customers',
    {
      email: account.email,
      name: account.institutionName,
      'preferred_locales[0]': 'de',
      'metadata[institution_id]': account.institutionId,
      'metadata[institution_type]': account.institutionType,
    },
    // Stripe-Idempotenz: parallele Anfragen erzeugen keinen zweiten Kunden
    `customer-${account.institutionId}`,
  );
  const id = idOf(customer);
  if (!id) throw new Error('Stripe-Kunde ohne ID');
  return deps.db.linkCustomer(account.institutionId, id);
}

/* ------------------------------------------------------------------------------------------------ */
/* create-customer-portal                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export const handlePortal = guarded('create-customer-portal', portal);

async function portal(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin, deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const auth = await authorize(req, deps, cors);
  if ('response' in auth) return auth.response;
  const { account } = auth;

  // ausschließlich der Customer der EIGENEN Institution (Body wird nicht ausgewertet)
  const customerId = await deps.db.getCustomerId(account.institutionId);
  if (!customerId) {
    return json({ error: 'Für Ihr Konto besteht noch kein Abonnement. Die Abo-Verwaltung steht nach Ihrer ersten Buchung zur Verfügung.', code: 'no_customer' }, 404, cors);
  }
  const site = resolveSiteUrl(origin, deps.env);

  // 1) Kunde bei Stripe prüfen (fehlt z. B., wenn er im Testmodus angelegt wurde und jetzt der Live-Schlüssel gilt)
  try {
    const customer = await deps.stripe.request('GET', `customers/${encodeURIComponent(customerId)}`);
    if (customer?.deleted === true) throw new StripeError(404, 'invalid_request_error', 'resource_missing', 'customer deleted');
  } catch (e) {
    if (isResourceMissing(e)) {
      deps.log?.(`create-customer-portal: Stripe-Kunde ${customerId} nicht gefunden (gelöscht oder anderer Stripe-Modus: Test/Live?)`);
      return json({ error: 'Ihr Kundenkonto wurde beim Zahlungsdienstleister nicht gefunden. Bitte wenden Sie sich an info@olo-vision.de.', code: 'customer_missing' }, 404, cors);
    }
    deps.log?.(`create-customer-portal: Kunde prüfen – ${errMsg(e)}`);
    return json({ error: 'Die Abo-Verwaltung ist gerade nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.', code: 'stripe_error' }, 502, cors);
  }

  // 2) Portal-Sitzung; fehlt die Standard-Konfiguration im Stripe-Dashboard, eine eigene anlegen/verwenden
  const params: Record<string, string> = { customer: customerId, return_url: `${site}/account`, locale: 'de' };
  const configured = deps.env('STRIPE_PORTAL_CONFIGURATION_ID');
  if (configured && /^bpc_[A-Za-z0-9]+$/.test(configured)) params.configuration = configured;
  try {
    let session: Obj;
    try {
      session = await deps.stripe.request('POST', 'billing_portal/sessions', params);
    } catch (e) {
      if (!isPortalNotConfigured(e) || params.configuration) throw e;
      deps.log?.('create-customer-portal: keine Standard-Konfiguration des Kundenportals – verwende OLO-LAB3D-Konfiguration');
      params.configuration = await ensurePortalConfiguration(site, deps);
      session = await deps.stripe.request('POST', 'billing_portal/sessions', params);
    }
    if (typeof session.url !== 'string') throw new Error('Portal-Session ohne URL');
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    deps.log?.(`create-customer-portal: ${errMsg(e)}`);
    if (isPortalNotConfigured(e)) {
      return json({ error: 'Die Abo-Verwaltung ist noch nicht eingerichtet. Bitte wenden Sie sich an info@olo-vision.de.', code: 'portal_not_configured' }, 503, cors);
    }
    return json({ error: 'Die Abo-Verwaltung ist gerade nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.', code: 'stripe_error' }, 502, cors);
  }
}

/** Kennzeichen der von OLO-LAB3D angelegten Portal-Konfiguration (Metadaten) */
export const PORTAL_CONFIG_MARKER = 'olo-lab3d-default';

/**
 * Portal-Konfiguration für OLO-LAB3D: vorhandene (Metadaten-Kennzeichen) wiederverwenden, sonst anlegen.
 * Funktionen: Rechnungen, Zahlungsmittel, Rechnungsadresse/USt-IdNr., Kündigung zum Periodenende.
 * Tarifwechsel bleibt aus (Tarif = Kundentyp; Wechsel über Kündigung und Neubuchung).
 */
export async function ensurePortalConfiguration(site: string, deps: Deps): Promise<string> {
  const list = await deps.stripe.request('GET', 'billing_portal/configurations', { active: 'true', limit: '100' });
  const found = (Array.isArray(list?.data) ? list.data : []).find((c: Obj) => c?.metadata?.olo === PORTAL_CONFIG_MARKER && typeof c.id === 'string');
  if (found) return found.id;
  const p: Record<string, string> = {
    'metadata[olo]': PORTAL_CONFIG_MARKER,
    'business_profile[headline]': 'OLO-LAB3D – Abonnement verwalten',
    default_return_url: `${site}/account`,
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[customer_update][enabled]': 'true',
    'features[customer_update][allowed_updates][0]': 'address',
    'features[customer_update][allowed_updates][1]': 'tax_id',
    'features[customer_update][allowed_updates][2]': 'name',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_cancel][proration_behavior]': 'none',
    'features[subscription_update][enabled]': 'false',
  };
  if (/^https:\/\//.test(site)) {
    p['business_profile[privacy_policy_url]'] = `${site}/legal/privacy`;
    p['business_profile[terms_of_service_url]'] = `${site}/legal/terms`;
  }
  const created = await deps.stripe.request('POST', 'billing_portal/configurations', p, `portal-config-${PORTAL_CONFIG_MARKER}`);
  if (typeof created?.id !== 'string') throw new Error('Portal-Konfiguration ohne ID');
  return created.id;
}

/* ------------------------------------------------------------------------------------------------ */
/* stripe-webhook                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

/** Verarbeitete Ereignisse (im Stripe-Dashboard für den Endpoint auswählen) */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
] as const;
const HANDLED = new Set<string>(HANDLED_EVENTS);

export const handleWebhook = guarded('stripe-webhook', webhook);

async function webhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405);
  const secret = deps.env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !deps.env('STRIPE_SECRET_KEY')) {
    deps.log?.('stripe-webhook: STRIPE_WEBHOOK_SECRET/STRIPE_SECRET_KEY fehlen');
    return json({ error: 'Webhook nicht konfiguriert.' }, 503);
  }

  const payload = await req.text();
  const valid = await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), secret, {
    nowSec: deps.now ? Math.floor(deps.now() / 1000) : undefined,
  });
  if (!valid) return json({ error: 'Ungültige Signatur.' }, 400);

  let event: { id?: string; type?: string; created?: number; data?: { object?: Obj } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'Ungültige Nutzlast.' }, 400);
  }
  const id = typeof event.id === 'string' ? event.id : '';
  const type = typeof event.type === 'string' ? event.type : '';
  const obj = event.data?.object ?? {};
  if (!id.startsWith('evt_') || !type) return json({ error: 'Ungültiges Ereignis.' }, 400);
  if (!HANDLED.has(type)) return json({ received: true, ignored: type }, 200);

  const created = typeof event.created === 'number' ? new Date(event.created * 1000).toISOString() : null;
  if (!(await deps.db.eventBegin(id, type, created))) return json({ received: true, duplicate: true }, 200);

  try {
    const result = await processEvent(type, id, obj, deps);
    await deps.db.eventFinish(id, result ? 'processed' : 'ignored');
    return json({ received: true, ...(result ? { license_status: result.license_status ?? null } : { ignored: 'ohne Abo' }) }, 200);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'P0002') {
      // Abo ohne Bezug zu einer Institution (z. B. im Stripe-Dashboard angelegt) – nicht endlos wiederholen
      await deps.db.eventFinish(id, 'ignored', errMsg(e));
      deps.log?.(`stripe-webhook ${type}: ignoriert – ${errMsg(e)}`);
      return json({ received: true, ignored: 'unbekannter Kunde' }, 200);
    }
    await deps.db.eventFinish(id, 'failed', errMsg(e)).catch(() => undefined);
    deps.log?.(`stripe-webhook ${type}: ${errMsg(e)}`);
    // 500 → Stripe wiederholt die Zustellung; das Ereignis wird dann erneut verarbeitet
    return json({ error: 'Verarbeitung fehlgeschlagen.' }, 500);
  }
}

async function processEvent(type: string, eventId: string, obj: Obj, deps: Deps): Promise<Obj | null> {
  const sync = async (subscriptionId: string, paymentFailed = false, checkoutSessionId: string | null = null) => {
    // immer den AKTUELLEN Stand von Stripe laden – Reihenfolge und Alter der Ereignisse spielen so keine Rolle
    const sub = await deps.stripe.request('GET', `subscriptions/${encodeURIComponent(subscriptionId)}`);
    const snapshot = snapshotFromSubscription(sub, { eventId, eventType: type, paymentFailed, env: deps.env, checkoutSessionId });
    const result = await deps.db.applySubscription(snapshot);
    // private Jahreslizenz: keine automatische Verlängerung (Stripe meldet die Änderung anschließend erneut)
    await enforceNoAutoRenewal(snapshot, eventId, deps);
    return result;
  };

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      if (obj.mode !== 'subscription') return null;
      const subId = idOf(obj.subscription);
      if (!subId) return null;
      // Session-ID verknüpft das Abo mit den beim Kauf protokollierten Zustimmungen
      const result = await sync(subId, false, idOf(obj));
      // Vertragsbestätigung per E-Mail (einmal je Session; Fehler verhindern die Freischaltung nie)
      if (type !== 'checkout.session.async_payment_failed') await afterCheckoutCompleted(obj, deps);
      return result;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const subId = idOf(obj);
      return subId ? sync(subId) : null;
    }
    case 'invoice.paid': {
      const subId = subscriptionIdFromInvoice(obj);
      return subId ? sync(subId) : null;
    }
    case 'invoice.payment_failed': {
      const subId = subscriptionIdFromInvoice(obj);
      if (!subId) return null;
      // Rechnung frisch laden: nur wenn sie weiterhin offen ist, gilt die Zahlung als fehlgeschlagen
      const invId = idOf(obj);
      const invoice = invId ? await deps.stripe.request('GET', `invoices/${encodeURIComponent(invId)}`) : obj;
      return sync(subId, invoice.status === 'open');
    }
    default:
      return null;
  }
}

export type { LicensePlan };
