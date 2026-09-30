/**
 * Rechtsbetrieb in den Edge Functions:
 *
 *  - consumer-request:  „Verträge hier kündigen“ (§ 312k BGB) und „Vertrag widerrufen“ (§ 356a BGB) – ohne Login.
 *                       Speichert die Erklärung, kündigt ein zugeordnetes Abo automatisch zum Periodenende,
 *                       bestätigt den Eingang per E-Mail und benachrichtigt OLO Vision.
 *  - mail-jobs:         stündlich per pg_cron (CRON_SECRET): fehlgeschlagene Vertragsbestätigungen nachholen,
 *                       Erinnerung vor Ablauf privater Jahreslizenzen.
 *  - Webhook-Ergänzungen: Vertragsbestätigung nach dem Kauf (§ 312f Abs. 2 BGB), private Jahreslizenz endet
 *    automatisch (keine Verlängerung), Hinweis bei B2B-Kauf mit ausländischer Rechnungsadresse.
 *
 * Sicherheit: Die Antwort an den Browser verrät nie, ob zu einer E-Mail-Adresse ein Konto existiert.
 * Zuordnung, Stripe-Aktionen und E-Mails laufen ausschließlich serverseitig. E-Mail-Fehler brechen nie die
 * eigentliche Verarbeitung ab.
 */
import type { Deps } from './handlers.ts';
import { corsHeaders, endsAutomatically, type EnvGetter } from './stripeConfig.ts';
import { LIVE_SUBSCRIPTION_STATUSES } from './licenseStatus.ts';
import { isEmail, type Mailer, type MailMessage } from './mailer.ts';
import type { SubscriptionSnapshot } from './stripeObjects.ts';
import {
  b2bCountryNoticeMail,
  cancellationConfirmationMail,
  contractConfirmationMail,
  declarationNoticeMail,
  renewalReminderMail,
  withdrawalConfirmationMail,
  type ContractData,
  type DeclarationMailData,
} from './mailTemplates.ts';

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export type MailKind = 'contract_confirmation' | 'cancellation_confirmation' | 'withdrawal_confirmation' | 'declaration_notice' | 'renewal_reminder' | 'b2b_country_notice' | 'account_deleted' | 'account_deletion_reminder' | 'admin_notice';

export interface DeclarationInput {
  kind: 'cancellation' | 'withdrawal';
  cancellationType: 'ordinary' | 'extraordinary' | null;
  name: string;
  email: string;
  contractDetails: string | null;
  reason: string | null;
}

export interface DeclarationRecord {
  id: string;
  received_at: string;
  recent_count: number;
  account: { user_id: string; email: string; first_name: string | null; customer_type: string } | null;
  subscription: { stripe_subscription_id: string | null; status: string | null; plan: string | null; billing_interval: string | null; current_period_end: string | null; cancel_at_period_end: boolean } | null;
}

export interface RenewalCandidate {
  subscription_id: string;
  stripe_subscription_id: string | null;
  email: string;
  first_name: string | null;
  last_name?: string | null;
  current_period_end: string | null;
}

/** Datenbankzugriffe des Rechtsbetriebs (nur service_role, siehe Migration 20260930090000) */
export interface OpsDb {
  recordDeclaration(input: DeclarationInput): Promise<DeclarationRecord>;
  updateDeclaration(id: string, status: string | null, result: Obj, confirmationSent: boolean, notified: boolean): Promise<void>;
  contractConfirmationData(checkoutSessionId: string): Promise<ContractData | null>;
  logMail(kind: MailKind, recipient: string, subject: string, relatedKey: string | null, status: 'sent' | 'failed' | 'skipped', error: string | null): Promise<boolean>;
  renewalCandidates(days: number): Promise<RenewalCandidate[]>;
  /** Checkout-Sessions der letzten Tage ohne erfolgreich versendete Vertragsbestätigung */
  pendingContractConfirmations(days: number): Promise<string[]>;
  markRenewal(subscriptionId: string): Promise<void>;
  /** Drosselung öffentlicher Endpunkte: true = erlaubt */
  throttle?(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
  /** Erklärungen ohne versendete Eingangsbestätigung (Nachversand) */
  pendingDeclarationConfirmations?(days: number): Promise<PendingDeclaration[]>;
  markDeclarationConfirmed?(id: string): Promise<void>;
}

export interface PendingDeclaration {
  id: string;
  kind: 'cancellation' | 'withdrawal';
  cancellation_type: 'ordinary' | 'extraordinary' | null;
  name: string;
  email: string;
  recipient: string;
  contract_details: string | null;
  reason: string | null;
  received_at: string;
  first_name: string | null;
  status: string;
  result: Obj | null;
  matched: boolean;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const iso = (s: unknown): string | null => (typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null);

/** Versand mit Protokoll; liefert true bei Erfolg. Fehler werden protokolliert, nie geworfen. */
export async function sendLogged(deps: Deps, kind: MailKind, message: MailMessage, relatedKey: string | null): Promise<boolean> {
  const mailer: Mailer | undefined = deps.mailer;
  const ops = deps.ops;
  if (!mailer?.configured) {
    await ops?.logMail(kind, message.to, message.subject, relatedKey, 'skipped', 'E-Mail-Versand nicht konfiguriert').catch(() => undefined);
    deps.log?.(`mail ${kind}: übersprungen (nicht konfiguriert)`);
    return false;
  }
  try {
    await mailer.send(message);
    await ops?.logMail(kind, message.to, message.subject, relatedKey, 'sent', null).catch((e) => deps.log?.(`mail ${kind}: Protokoll fehlgeschlagen – ${errMsg(e)}`));
    return true;
  } catch (e) {
    deps.log?.(`mail ${kind}: Versand fehlgeschlagen – ${errMsg(e)}`);
    await ops?.logMail(kind, message.to, message.subject, relatedKey, 'failed', errMsg(e)).catch(() => undefined);
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* consumer-request                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

const MAX_PER_HOUR = 3;
const IP_LIMIT_PER_HOUR = 10;
const GLOBAL_LIMIT_PER_HOUR = 300;

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function parseDeclaration(body: Obj): DeclarationInput | { error: string; field?: string } {
  const kind = body?.kind;
  if (kind !== 'cancellation' && kind !== 'withdrawal') return { error: 'Unbekannte Erklärung.' };
  // Steuerzeichen entfernen (keine Zeilenumbrüche in Betreffzeilen, keine unsichtbaren Zeichen in E-Mails)
  const str = (v: unknown, max: number, multiline = false) =>
    typeof v === 'string' ? v.replace(multiline ? /[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g : /[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max) : '';
  const name = str(body.name, 200);
  const email = str(body.email, 320).toLowerCase();
  const contractDetails = str(body.contract, 500, true) || null;
  const reason = str(body.reason, 2000, true) || null;
  const cancellationType = kind === 'cancellation' ? (body.cancellationType === 'extraordinary' ? 'extraordinary' : 'ordinary') : null;
  if (!name) return { error: 'Bitte geben Sie Ihren Namen an.', field: 'name' };
  if (!isEmail(email)) return { error: 'Bitte geben Sie die E-Mail-Adresse Ihres Kundenkontos an.', field: 'email' };
  if (cancellationType === 'extraordinary' && !reason) return { error: 'Bitte geben Sie bei einer außerordentlichen Kündigung den Grund an.', field: 'reason' };
  return { kind, cancellationType, name, email, contractDetails, reason };
}

export async function handleConsumerRequest(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405, cors);
  try {
    const body = (await req.json().catch(() => ({}))) as Obj;
    // Honeypot-Feld (für Menschen unsichtbar): Bots erhalten eine neutrale Antwort, es passiert nichts
    if (typeof body?.website === 'string' && body.website.trim()) return json({ ok: true, receivedAt: new Date(deps.now?.() ?? Date.now()).toISOString() }, 200, cors);
    const input = parseDeclaration(body);
    if ('error' in input) return json({ error: input.error, field: input.field ?? null, code: 'invalid' }, 422, cors);
    if (!deps.ops) throw new Error('Rechtsbetrieb nicht konfiguriert');

    // Missbrauchsschutz (Spam über das öffentliche Formular): je Absender-IP und insgesamt begrenzen
    if (deps.ops.throttle) {
      const ip = clientIp(req);
      const okIp = ip ? await deps.ops.throttle(`consumer:ip:${await sha256Hex(ip)}`, IP_LIMIT_PER_HOUR, 3600) : true;
      const okAll = await deps.ops.throttle('consumer:global', GLOBAL_LIMIT_PER_HOUR, 3600);
      if (!okIp || !okAll) {
        deps.log?.(`consumer-request: gedrosselt (${okIp ? 'global' : 'IP'})`);
        return json(
          { error: 'Gerade gehen sehr viele Anfragen ein. Bitte versuchen Sie es später erneut oder senden Sie Ihre Erklärung per E-Mail an info@olo-vision.de – maßgeblich ist der Zeitpunkt des Absendens.', code: 'rate_limited' },
          429,
          cors,
        );
      }
    }

    const rec = await deps.ops.recordDeclaration(input);
    const data: DeclarationMailData = {
      id: rec.id,
      kind: input.kind,
      cancellationType: input.cancellationType,
      name: input.name,
      email: input.email,
      contractDetails: input.contractDetails,
      reason: input.reason,
      receivedAt: rec.received_at,
      firstName: rec.account?.first_name ?? null,
      unmatched: !rec.subscription,
    };

    // Missbrauchsschutz: viele Erklärungen zur selben Adresse in kurzer Zeit → speichern, aber nicht erneut mailen
    if (rec.recent_count >= MAX_PER_HOUR) {
      await deps.ops.updateDeclaration(rec.id, 'needs_review', { throttled: true }, false, false);
      return json({ ok: true, id: rec.id, receivedAt: rec.received_at }, 200, cors);
    }

    let status = 'needs_review';
    const result: Obj = {};
    const sub = rec.subscription;
    // Automatisch bei Stripe kündigen nur, wenn die Adresse zum Inhaber des Kundenkontos gehört
    // (Administration der Institution); sonst manuelle Prüfung – die Erklärung ist dennoch eingegangen.
    let holder = true;
    if (rec.account?.user_id && deps.accountDb) {
      const prof = await deps.accountDb.getProfile(rec.account.user_id).catch(() => null);
      holder = !!prof && (prof.role === 'institution_admin' || prof.role === 'super_admin');
      if (!holder) result.not_account_holder = true;
    }
    if (holder && input.kind === 'cancellation' && input.cancellationType === 'ordinary' && sub?.stripe_subscription_id && sub.status && LIVE_SUBSCRIPTION_STATUSES.includes(sub.status as never)) {
      if (sub.cancel_at_period_end) {
        data.endsAt = sub.current_period_end;
        data.alreadyCancelled = true;
        status = 'processed';
        result.cancel_at = sub.current_period_end;
        result.already_cancelled = true;
      } else if (deps.env('STRIPE_SECRET_KEY')) {
        try {
          const updated = await deps.stripe.request('POST', `subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, { cancel_at_period_end: 'true' }, `declaration-${rec.id}`);
          const endsAt = iso(updated?.cancel_at) ?? iso(updated?.items?.data?.[0]?.current_period_end) ?? sub.current_period_end;
          data.endsAt = endsAt;
          status = 'processed';
          result.cancel_at = endsAt;
        } catch (e) {
          deps.log?.(`consumer-request: Stripe-Kündigung fehlgeschlagen – ${errMsg(e)}`);
          result.stripe_error = errMsg(e);
        }
      }
    }
    if (data.unmatched) result.unmatched = true;

    // Bestätigung an die Konto-Adresse (bei fehlender Zuordnung an die angegebene Adresse)
    const confirmation = input.kind === 'withdrawal' ? withdrawalConfirmationMail(data) : cancellationConfirmationMail(data);
    if (rec.account?.email) confirmation.to = rec.account.email;
    const confirmed = await sendLogged(deps, input.kind === 'withdrawal' ? 'withdrawal_confirmation' : 'cancellation_confirmation', confirmation, rec.id);
    const notifyTo = deps.mailer?.notifyTo;
    const notified = notifyTo ? await sendLogged(deps, 'declaration_notice', declarationNoticeMail(notifyTo, data, status), rec.id) : false;
    await deps.ops.updateDeclaration(rec.id, status, result, confirmed, notified);

    return json({ ok: true, id: rec.id, receivedAt: rec.received_at, confirmationSent: confirmed }, 200, cors);
  } catch (e) {
    deps.log?.(`consumer-request: ${errMsg(e)}`);
    return json(
      { error: 'Ihre Erklärung konnte gerade nicht gespeichert werden. Bitte senden Sie sie per E-Mail an info@olo-vision.de – maßgeblich ist der Zeitpunkt des Absendens.', code: 'internal' },
      500,
      cors,
    );
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* mail-jobs (stündlich per pg_cron → pg_net, Header x-cron-secret)                                 */
/*   1. Vertragsbestätigungen nachholen, deren Versand fehlgeschlagen ist (letzte 7 Tage)          */
/*   2. Erinnerung 14 Tage vor Ablauf privater Jahreslizenzen                                      */
/* ------------------------------------------------------------------------------------------------ */

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

/** Weitere geplante Aufgaben, die mail-jobs mit ausführt (z. B. Aufbewahrung geschlossener Konten) */
export type ScheduledJob = (deps: Deps) => Promise<Record<string, unknown>>;

export async function handleMailJobs(req: Request, deps: Deps, extraJobs: Record<string, ScheduledJob> = {}): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405);
  const secret = deps.env('CRON_SECRET') ?? '';
  const given = req.headers.get('x-cron-secret') ?? '';
  if (secret.length < 16 || !safeEqual(given, secret)) return json({ error: 'Nicht erlaubt.' }, 401);
  if (!deps.ops) return json({ error: 'Nicht konfiguriert.' }, 503);
  try {
    let confirmations = 0;
    for (const sessionId of await deps.ops.pendingContractConfirmations(7)) {
      const data = await deps.ops.contractConfirmationData(sessionId);
      if (data && (await sendLogged(deps, 'contract_confirmation', contractConfirmationMail(data), sessionId))) confirmations++;
    }
    const list = await deps.ops.renewalCandidates(14);
    let sent = 0;
    for (const c of list) {
      try {
        const ok = await sendLogged(deps, 'renewal_reminder', renewalReminderMail(c.email, [c.first_name, c.last_name].filter(Boolean).join(' '), c.current_period_end), c.subscription_id);
        if (ok) {
          await deps.ops.markRenewal(c.subscription_id);
          sent++;
        }
      } catch (e) {
        deps.log?.(`mail-jobs/renewal ${c.subscription_id}: ${errMsg(e)}`);
      }
    }
    // Eingangsbestätigungen für Kündigung/Widerruf nachholen (§ 312k BGB), wenn der Versand fehlschlug
    let declarations = 0;
    if (deps.ops.pendingDeclarationConfirmations && deps.ops.markDeclarationConfirmed) {
      for (const d of await deps.ops.pendingDeclarationConfirmations(7)) {
        try {
          const data: DeclarationMailData = {
            id: d.id,
            kind: d.kind,
            cancellationType: d.cancellation_type,
            name: d.name,
            email: d.email,
            contractDetails: d.contract_details,
            reason: d.reason,
            receivedAt: d.received_at,
            firstName: d.first_name,
            endsAt: typeof d.result?.cancel_at === 'string' ? d.result.cancel_at : null,
            alreadyCancelled: d.result?.already_cancelled === true,
            unmatched: !d.matched,
          };
          const mail = d.kind === 'withdrawal' ? withdrawalConfirmationMail(data) : cancellationConfirmationMail(data);
          mail.to = d.recipient;
          if (await sendLogged(deps, d.kind === 'withdrawal' ? 'withdrawal_confirmation' : 'cancellation_confirmation', mail, d.id)) {
            await deps.ops.markDeclarationConfirmed(d.id);
            declarations++;
          }
        } catch (e) {
          deps.log?.(`mail-jobs/declaration ${d.id}: ${errMsg(e)}`);
        }
      }
    }
    const extra: Record<string, unknown> = {};
    for (const [name, job] of Object.entries(extraJobs)) {
      try {
        extra[name] = await job(deps);
      } catch (e) {
        deps.log?.(`mail-jobs/${name}: ${errMsg(e)}`);
        extra[name] = { error: true };
      }
    }
    return json({ confirmations, reminders: { checked: list.length, sent }, declarations, ...extra }, 200);
  } catch (e) {
    deps.log?.(`mail-jobs: ${errMsg(e)}`);
    return json({ error: 'Fehler.' }, 500);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Webhook-Ergänzungen                                                                              */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Private Jahreslizenz: niemals automatisch verlängern. Ist das Abo (noch) nicht zum Periodenende gekündigt –
 * direkt nach dem Kauf oder nach einer Reaktivierung im Kundenportal – wird das bei Stripe gesetzt.
 * Fehler werfen → Webhook antwortet 500 → Stripe stellt das Ereignis erneut zu.
 */
export async function enforceNoAutoRenewal(snapshot: SubscriptionSnapshot, eventId: string, deps: Deps): Promise<boolean> {
  if (!endsAutomatically(snapshot.plan, snapshot.billing_interval)) return false;
  if (snapshot.cancel_at_period_end || snapshot.cancel_at || !LIVE_SUBSCRIPTION_STATUSES.includes(snapshot.status as never)) return false;
  await deps.stripe.request('POST', `subscriptions/${encodeURIComponent(snapshot.subscription_id)}`, { cancel_at_period_end: 'true' }, `no-renewal-${snapshot.subscription_id}-${eventId}`);
  deps.log?.(`stripe-webhook: private Jahreslizenz ${snapshot.subscription_id} endet automatisch (keine Verlängerung)`);
  return true;
}

/** Nach erfolgreichem Checkout: Vertragsbestätigung (einmal je Session) und ggf. Hinweis zum Rechnungsland */
export async function afterCheckoutCompleted(session: Obj, deps: Deps): Promise<void> {
  const sessionId = typeof session?.id === 'string' ? session.id : null;
  if (!sessionId || !deps.ops) return;
  const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  if (!paid) return;
  try {
    const data = await deps.ops.contractConfirmationData(sessionId);
    if (data) await sendLogged(deps, 'contract_confirmation', contractConfirmationMail(data), sessionId);
    const country = session.customer_details?.address?.country ?? null;
    const b2b = data ? data.customer_type !== 'private' : session.metadata?.customer_type && session.metadata.customer_type !== 'private';
    const notifyTo = deps.mailer?.notifyTo;
    if (b2b && country && country !== 'DE' && notifyTo) {
      await sendLogged(deps, 'b2b_country_notice', b2bCountryNoticeMail(notifyTo, { email: data?.email ?? session.customer_details?.email ?? '–', institution: data?.institution_name ?? null, country, session: sessionId }), sessionId);
    }
  } catch (e) {
    // Bestätigungs-E-Mails dürfen die Freischaltung nie verhindern
    deps.log?.(`stripe-webhook: Vertragsbestätigung – ${errMsg(e)}`);
  }
}

export type { EnvGetter };
