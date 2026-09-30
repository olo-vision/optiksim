/**
 * Produktive Abhängigkeiten der Stripe-Edge-Functions (Deno, Supabase Edge Runtime).
 *
 * Sicherheitsmodell (je Anfrage):
 *   1. Identität: Benutzer-JWT aus dem Authorization-Header prüfen
 *        a) lokal gegen die JWKS des Projekts (@supabase/server, verifyCredentials, auth 'user')
 *        b) Rückfall für ältere HS256-Token: Auth-Server (/auth/v1/user) über einen reinen Identitäts-Client
 *      → Ergebnis ist nur die User-ID (+ E-Mail). Institution, Customer usw. kommen NIE aus dem Request.
 *   2. Datenbank: ausschließlich über einen SEPARATEN Admin-Client mit Secret Key
 *        (createAdminClient aus @supabase/server – entfernt Authorization-/apikey-Header aus den Optionen,
 *        der Benutzer-JWT kann ihn also nicht überschreiben). Rolle: service_role.
 *      Benötigte Tabellenrechte: Migration 20260929090000_service_role_grants.sql.
 *
 * Secrets NUR als Supabase Function Secrets (nie im Frontend, nie im Git):
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL (optional STRIPE_PRICE_*, STRIPE_PORTAL_CONFIGURATION_ID,
 *   STRIPE_TAX_RATE_ID), E-Mail: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, MAIL_NOTIFY_TO (mailer.ts),
 *   CRON_SECRET (mail-jobs)
 * SUPABASE_URL, SUPABASE_SECRET_KEYS, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_JWKS stellt Supabase automatisch bereit.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, verifyCredentials } from '@supabase/server/core';
import type { BillingAccount, BillingDb, Deps, StripeApi } from './handlers.ts';
import { STRIPE_API_VERSION, type EnvGetter } from './stripeConfig.ts';
import type { SubscriptionSnapshot } from './stripeObjects.ts';
import { LIVE_SUBSCRIPTION_STATUSES } from './licenseStatus.ts';
import { bearerToken, resolvePublishableKey, resolveServerKey, SERVER_CLIENT_OPTIONS } from './supabaseKeys.ts';
import type { OpsDb } from './legalOps.ts';
import type { AccountDb } from './accountOps.ts';
import type { ContractData } from './mailTemplates.ts';
import { mailerFromEnv } from './smtpMailer.ts';
import { StripeError } from './stripeError.ts';

export const env: EnvGetter = (name) => Deno.env.get(name) ?? undefined;

const supabaseUrl = () => {
  const url = env('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL fehlt');
  return url;
};

/* ------------------------------------------------------------------------------------------------ */
/* Clients                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Privilegierter Admin-Client (service_role, umgeht RLS) – nur hier auf dem Server, je Anfrage neu.
 * Bekommt nie den Benutzer-JWT: keine globalen Header, keine Sitzung, kein accessToken.
 */
export function createServerAdminClient(): SupabaseClient {
  const key = resolveServerKey(env);
  if (key.source === 'secret_keys') {
    return createAdminClient({ auth: { keyName: key.name } }) as unknown as SupabaseClient;
  }
  // Rückfall für Projekte ohne neue API-Schlüssel (legacy service_role-JWT) – gleiche sichere Optionen
  return createClient(supabaseUrl(), key.key, SERVER_CLIENT_OPTIONS);
}

/** Nur für auth.getUser(token) – wird nie für Datenbankzugriffe verwendet */
function identityClient(): SupabaseClient {
  return createClient(supabaseUrl(), resolvePublishableKey(env), SERVER_CLIENT_OPTIONS);
}

/** iat (Ausstellungszeit, Sekunden) aus einem bereits geprüften JWT */
function issuedAtOf(token: string): number | undefined {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof payload.iat === 'number' ? payload.iat : undefined;
  } catch {
    return undefined;
  }
}

/** Benutzer-JWT prüfen → { id, email, issuedAt } oder null */
async function authUser(req: Request): Promise<{ id: string; email: string; issuedAt?: number } | null> {
  const token = bearerToken(req);
  if (!token) return null;
  // a) lokal gegen die JWKS (aktuelle asymmetrische JWT-Signaturschlüssel)
  try {
    const { data, error } = await verifyCredentials({ token, apikey: null }, { auth: 'user' });
    if (!error && data?.userClaims?.id) {
      if (data.userClaims.role !== 'authenticated') return null;
      return { id: data.userClaims.id, email: data.userClaims.email ?? '', issuedAt: issuedAtOf(token) };
    }
  } catch {
    /* JWKS nicht verfügbar → Rückfall */
  }
  // b) Auth-Server (prüft auch ältere HS256-Token und gesperrte/gelöschte Benutzer)
  const { data, error } = await identityClient().auth.getUser(token);
  if (error || !data.user) return null;
  if (data.user.role && data.user.role !== 'authenticated') return null;
  return { id: data.user.id, email: data.user.email ?? '', issuedAt: issuedAtOf(token) };
}

/* ------------------------------------------------------------------------------------------------ */
/* Datenbank (nur Admin-Client)                                                                     */
/* ------------------------------------------------------------------------------------------------ */

class DbError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}
const fail = (e: { message: string; code?: string } | null) => {
  if (e) throw new DbError(e.message, e.code);
};

function billingDb(admin: SupabaseClient): BillingDb {
  const db: BillingDb = {
    async getAccount(userId): Promise<BillingAccount | null> {
      const { data: p, error } = await admin.from('profiles').select('user_id, email, role, institution_id').eq('user_id', userId).maybeSingle();
      fail(error);
      if (!p) return null;
      const [{ data: inst, error: e1 }, { data: lic, error: e2 }] = await Promise.all([
        admin.from('institutions').select('id, type, name, country').eq('id', p.institution_id).maybeSingle(),
        admin.from('licenses').select('status, source').eq('institution_id', p.institution_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      fail(e1);
      fail(e2);
      if (!inst) return null;
      return {
        userId: p.user_id,
        email: p.email,
        role: p.role,
        institutionId: inst.id,
        institutionType: inst.type,
        institutionName: inst.name,
        country: inst.country ?? null,
        license: lic ? { status: lic.status, source: lic.source } : null,
      };
    },
    async getCustomerId(institutionId) {
      const { data, error } = await admin.from('billing_customers').select('stripe_customer_id').eq('institution_id', institutionId).maybeSingle();
      fail(error);
      return data?.stripe_customer_id ?? null;
    },
    async linkCustomer(institutionId, customerId) {
      // nur einfügen; existiert bereits ein Kunde, bleibt er (ON CONFLICT DO NOTHING)
      const { error } = await admin.from('billing_customers').upsert({ institution_id: institutionId, stripe_customer_id: customerId }, { onConflict: 'institution_id', ignoreDuplicates: true });
      fail(error);
      const current = await db.getCustomerId(institutionId);
      if (!current) throw new Error('Stripe-Kunde konnte nicht gespeichert werden');
      return current;
    },
    async getLiveSubscription(institutionId) {
      const { data, error } = await admin
        .from('subscriptions')
        .select('status')
        .eq('institution_id', institutionId)
        .in('status', LIVE_SUBSCRIPTION_STATUSES)
        .limit(1)
        .maybeSingle();
      fail(error);
      return data ?? null;
    },
    async eventBegin(id, type, createdIso) {
      const { data, error } = await admin.rpc('stripe_event_begin', { p_id: id, p_type: type, p_created: createdIso });
      fail(error);
      return data === true;
    },
    async eventFinish(id, status, message) {
      const { error } = await admin.rpc('stripe_event_finish', { p_id: id, p_status: status, p_error: message ?? null });
      fail(error);
    },
    async checkCheckoutConsents(userId, documentIds) {
      const { data, error } = await admin.rpc('checkout_consent_check', { p_user: userId, p_document_ids: documentIds });
      fail(error);
      const r = (data ?? {}) as { ok?: boolean; outdated?: boolean; missing?: Array<{ id: string; type: string; version: string }> };
      return { ok: r.ok === true, outdated: r.outdated === true, missing: r.missing ?? [] };
    },
    async recordCheckoutConsents(userId, documentIds, checkoutSessionId, plan, interval) {
      const { data, error } = await admin.rpc('record_checkout_consents', {
        p_user: userId,
        p_document_ids: documentIds,
        p_checkout_session_id: checkoutSessionId,
        p_plan: plan,
        p_billing_interval: interval,
      });
      fail(error);
      return Number(data ?? 0);
    },
    async applySubscription(snapshot: SubscriptionSnapshot) {
      const { data, error } = await admin.rpc('apply_stripe_subscription', { p: snapshot });
      fail(error);
      return (data ?? {}) as Record<string, unknown>;
    },
  };
  return db;
}

/** Rechtsbetrieb (Migration 20260930090000_legal_operations.sql) – nur über security-definer-Funktionen */
function opsDb(admin: SupabaseClient): OpsDb {
  return {
    async recordDeclaration(i) {
      const { data, error } = await admin.rpc('consumer_declaration_record', {
        p_kind: i.kind,
        p_cancellation_type: i.cancellationType,
        p_name: i.name,
        p_email: i.email,
        p_contract_details: i.contractDetails,
        p_reason: i.reason,
      });
      fail(error);
      return data as Awaited<ReturnType<OpsDb['recordDeclaration']>>;
    },
    async updateDeclaration(id, status, result, confirmationSent, notified) {
      const { error } = await admin.rpc('consumer_declaration_update', { p_id: id, p_status: status, p_result: result, p_confirmation_sent: confirmationSent, p_notified: notified });
      fail(error);
    },
    async contractConfirmationData(sessionId) {
      const { data, error } = await admin.rpc('contract_confirmation_data', { p_checkout_session_id: sessionId });
      fail(error);
      return (data ?? null) as ContractData | null;
    },
    async logMail(kind, recipient, subject, relatedKey, status, message) {
      const { data, error } = await admin.rpc('system_mail_log', { p_kind: kind, p_recipient: recipient, p_subject: subject, p_related_key: relatedKey, p_status: status, p_error: message });
      fail(error);
      return data === true;
    },
    async renewalCandidates(days) {
      const { data, error } = await admin.rpc('renewal_reminder_candidates', { p_days: days });
      fail(error);
      return (data ?? []) as Awaited<ReturnType<OpsDb['renewalCandidates']>>;
    },
    async markRenewal(subscriptionId) {
      const { error } = await admin.rpc('renewal_reminder_mark', { p_subscription_id: subscriptionId });
      fail(error);
    },
    async pendingContractConfirmations(days) {
      const { data, error } = await admin.rpc('contract_confirmation_pending', { p_days: days });
      fail(error);
      return ((data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>).contract_confirmation_pending ?? ''))).filter(Boolean);
    },
  };
}

/** Kontoverwaltung (Migration 20261001090000_cloud_content_accounts.sql) */
function accountDb(admin: SupabaseClient): AccountDb {
  return {
    async getProfile(userId) {
      const { data, error } = await admin.from('profiles').select('role, email, first_name, last_name, institution_id').eq('user_id', userId).maybeSingle();
      fail(error);
      return (data ?? null) as Awaited<ReturnType<AccountDb['getProfile']>>;
    },
    async deleteAccountData(userId, initiatedBy) {
      const { data, error } = await admin.rpc('delete_account_data', { p_user: userId, p_initiated_by: initiatedBy });
      fail(error);
      return (data ?? { ok: true }) as Awaited<ReturnType<AccountDb['deleteAccountData']>>;
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      // bereits gelöscht → in Ordnung (wiederholter Aufruf)
      if (error && !/not.?found/i.test(error.message)) throw new DbError(error.message);
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Stripe                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** Stripe-REST ohne SDK, mit fester API-Version; Fehlermeldungen ohne Schlüssel/Anfrageinhalt */
const stripe: StripeApi = {
  async request(method, path, params, idempotencyKey) {
    const key = env('STRIPE_SECRET_KEY');
    if (!key) throw new Error('STRIPE_SECRET_KEY fehlt');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_API_VERSION,
    };
    let url = `https://api.stripe.com/v1/${path}`;
    let body: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(params ?? {}).toString();
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    } else if (params && Object.keys(params).length) {
      url += `?${new URLSearchParams(params)}`;
    }
    const res = await fetch(url, { method, headers, body });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error ?? {}) as { type?: string; code?: string; message?: string; param?: string };
      throw new StripeError(res.status, err.type ?? '', err.code ?? '', err.message ?? 'Fehler', err.param ?? null);
    }
    return data;
  },
};

/* ------------------------------------------------------------------------------------------------ */

/** Abhängigkeiten für EINE Anfrage (Admin-Client wird je Anfrage erzeugt, erst bei Bedarf) */
export function realDeps(): Deps {
  let admin: SupabaseClient | null = null;
  const lazyDb = (): BillingDb => billingDb((admin ??= createServerAdminClient()));
  const db: BillingDb = {
    getAccount: (...a) => lazyDb().getAccount(...a),
    getCustomerId: (...a) => lazyDb().getCustomerId(...a),
    linkCustomer: (...a) => lazyDb().linkCustomer(...a),
    getLiveSubscription: (...a) => lazyDb().getLiveSubscription(...a),
    eventBegin: (...a) => lazyDb().eventBegin(...a),
    eventFinish: (...a) => lazyDb().eventFinish(...a),
    applySubscription: (...a) => lazyDb().applySubscription(...a),
    checkCheckoutConsents: (...a) => lazyDb().checkCheckoutConsents(...a),
    recordCheckoutConsents: (...a) => lazyDb().recordCheckoutConsents(...a),
  };
  const lazyOps = (): OpsDb => opsDb((admin ??= createServerAdminClient()));
  const ops: OpsDb = {
    recordDeclaration: (...a) => lazyOps().recordDeclaration(...a),
    updateDeclaration: (...a) => lazyOps().updateDeclaration(...a),
    contractConfirmationData: (...a) => lazyOps().contractConfirmationData(...a),
    logMail: (...a) => lazyOps().logMail(...a),
    renewalCandidates: (...a) => lazyOps().renewalCandidates(...a),
    markRenewal: (...a) => lazyOps().markRenewal(...a),
    pendingContractConfirmations: (...a) => lazyOps().pendingContractConfirmations(...a),
  };
  const lazyAccounts = (): AccountDb => accountDb((admin ??= createServerAdminClient()));
  const accounts: AccountDb = {
    getProfile: (...a) => lazyAccounts().getProfile(...a),
    deleteAccountData: (...a) => lazyAccounts().deleteAccountData(...a),
    deleteAuthUser: (...a) => lazyAccounts().deleteAuthUser(...a),
  };
  const log = (m: string) => console.error(m);
  return { env, authUser, db, stripe, log, ops, mailer: mailerFromEnv(env, log), accountDb: accounts };
}
