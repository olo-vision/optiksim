/**
 * Endgültige Kontolöschung (Edge Function delete-account).
 *
 * Ablauf:
 *  1. Benutzer-JWT prüfen; die Anmeldung muss frisch sein (≤ 10 Minuten – der Browser meldet sich
 *     dafür mit dem Passwort erneut an). Bestätigungswort „LÖSCHEN“.
 *  2. Super-Admins dürfen (für Löschanträge per E-Mail) ein anderes Konto löschen.
 *  3. Datenbank: public.delete_account_data() – Inhalte und Stammdaten entfernen, Nachweise behalten.
 *     Nicht möglich bei laufendem, ungekündigtem Abonnement (OLA01).
 *  4. Stripe-Kunde bleibt (Rechnungen, Aufbewahrungspflicht); er erhält nur die Markierung account_deleted.
 *  5. Auth-Benutzer löschen, Bestätigung per E-Mail an die frühere Adresse.
 * Wiederholbar: bricht ein Schritt ab, setzt ein erneuter Aufruf an der richtigen Stelle fort.
 */
import type { Deps } from './handlers.ts';
import { corsHeaders } from './stripeConfig.ts';
import { sendLogged } from './legalOps.ts';
import { accountDeletedMail, accountDeletionReminderMail } from './mailTemplates.ts';

export interface AccountProfile {
  role: 'super_admin' | 'institution_admin' | 'user';
  email: string;
  first_name: string | null;
  last_name: string | null;
  institution_id: string;
}

export type DeletionInitiator = 'self' | 'admin' | 'retention';

export interface RetentionCandidate {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  deletion_due_at: string;
  /** frühester Löschzeitpunkt (Frist, mindestens 14 Tage nach der Erinnerung) */
  delete_not_before?: string | null;
}

export interface AccountDb {
  getProfile(userId: string): Promise<AccountProfile | null>;
  deleteAccountData(userId: string, initiatedBy: DeletionInitiator): Promise<{ ok: boolean; already_deleted?: boolean; email?: string; institution_id?: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  /** geschlossene Konten, deren Löschung innerhalb von `days` Tagen bevorsteht (noch nicht erinnert) */
  retentionReminderCandidates(days: number): Promise<RetentionCandidate[]>;
  markDeletionReminded(userId: string): Promise<void>;
  /** geschlossene Konten, die jetzt gelöscht werden dürfen (Frist abgelaufen, rechtzeitig erinnert) */
  retentionDueAccounts(limit: number): Promise<RetentionCandidate[]>;
}

/** Tage vor der Löschung, an denen die Erinnerung verschickt wird */
export const RETENTION_REMINDER_DAYS = 30;

export const DELETE_CONFIRM_WORD = 'LÖSCHEN';
/** Höchstes Alter der Anmeldung für die Löschung (Sekunden) */
export const REAUTH_MAX_AGE_SEC = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function handleDeleteAccount(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405, cors);
  try {
    const user = await deps.authUser(req).catch(() => null);
    if (!user) return json({ error: 'Bitte melden Sie sich an.', code: 'unauthenticated' }, 401, cors);
    if (!deps.accountDb) throw new Error('Kontoverwaltung nicht konfiguriert');
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown; targetUserId?: unknown };
    if (typeof body.confirm !== 'string' || body.confirm.trim().toUpperCase() !== DELETE_CONFIRM_WORD) {
      return json({ error: `Bitte bestätigen Sie die Löschung mit dem Wort „${DELETE_CONFIRM_WORD}“.`, code: 'confirm_required' }, 422, cors);
    }
    const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    if (!user.authenticatedAt || nowSec - user.authenticatedAt > REAUTH_MAX_AGE_SEC) {
      return json({ error: 'Bitte bestätigen Sie die Löschung mit Ihrem Passwort.', code: 'reauth_required' }, 401, cors);
    }

    let target = user.id;
    let initiatedBy: 'self' | 'admin' = 'self';
    if (typeof body.targetUserId === 'string' && body.targetUserId !== user.id) {
      if (!UUID_RE.test(body.targetUserId)) return json({ error: 'Ungültiges Konto.', code: 'invalid' }, 422, cors);
      const caller = await deps.accountDb.getProfile(user.id);
      if (caller?.role !== 'super_admin') return json({ error: 'Nicht erlaubt.', code: 'forbidden' }, 403, cors);
      target = body.targetUserId;
      initiatedBy = 'admin';
    }

    let result: DeletionResult;
    try {
      result = await performAccountDeletion(deps, target, initiatedBy, nowSec);
    } catch (e) {
      if ((e as { code?: string })?.code === 'OLA01') {
        return json({ error: 'Es besteht noch ein laufendes Abonnement. Bitte kündigen Sie es zuerst – danach ist die Löschung möglich.', code: 'subscription_active' }, 409, cors);
      }
      throw e;
    }
    return json({ ok: true, alreadyDeleted: result.alreadyDeleted }, 200, cors);
  } catch (e) {
    deps.log?.(`delete-account: ${errMsg(e)}`);
    return json({ error: 'Die Löschung konnte gerade nicht abgeschlossen werden. Bitte versuchen Sie es erneut oder schreiben Sie an info@olo-vision.de.', code: 'internal' }, 500, cors);
  }
}

interface DeletionResult {
  alreadyDeleted: boolean;
}

/**
 * Kern der Löschung (Kunde, Administration, Aufbewahrungs-Job):
 * Daten löschen (DB-Funktion prüft Abo und – bei „retention“ – Frist/Erinnerung), Stripe-Kunden markieren,
 * Auth-Benutzer löschen, Bestätigung an die frühere Adresse. Fehlercodes der DB (OLA01/OLA02) werden weitergereicht.
 */
export async function performAccountDeletion(deps: Deps, target: string, initiatedBy: DeletionInitiator, nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000)): Promise<DeletionResult> {
  if (!deps.accountDb) throw new Error('Kontoverwaltung nicht konfiguriert');
  const profile = await deps.accountDb.getProfile(target);
  // Stripe-Kunde vor dem Anonymisieren ermitteln (bleibt wegen Rechnungen bestehen)
  const customerId = profile ? await deps.db.getCustomerId(profile.institution_id).catch(() => null) : null;
  // Stripe ist maßgeblich: auch wenn ein Webhook fehlt/verspätet ist, nie mit laufendem Abo löschen
  if (customerId && deps.env('STRIPE_SECRET_KEY')) {
    const list = await deps.stripe.request('GET', 'subscriptions', { customer: customerId, status: 'all', limit: '20' });
    const open = (Array.isArray(list?.data) ? (list.data as Array<Record<string, unknown>>) : []).some(
      (x) => ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(String(x?.status)) && x?.cancel_at_period_end !== true && !x?.cancel_at,
    );
    if (open) throw Object.assign(new Error('Laufendes Abonnement bei Stripe'), { code: 'OLA01' });
  }
  const result = await deps.accountDb.deleteAccountData(target, initiatedBy);
  if (customerId && deps.env('STRIPE_SECRET_KEY')) {
    await deps.stripe
      .request('POST', `customers/${encodeURIComponent(customerId)}`, { 'metadata[account_deleted]': new Date(nowSec * 1000).toISOString() })
      .catch((e) => deps.log?.(`delete-account: Stripe-Markierung – ${errMsg(e)}`));
  }
  await deps.accountDb.deleteAuthUser(target);
  const email = profile?.email ?? result.email ?? null;
  if (email && !result.already_deleted) {
    await sendLogged(deps, 'account_deleted', accountDeletedMail(email, [profile?.first_name, profile?.last_name].filter(Boolean).join(' '), initiatedBy === 'retention' ? 'retention' : 'request'), target);
  }
  return { alreadyDeleted: result.already_deleted === true };
}

/**
 * Aufbewahrung geschlossener Konten (stündlich über mail-jobs):
 *  1. Erinnerung 30 Tage vor Fristende (nur bei erfolgreichem Versand als erinnert markiert).
 *  2. Automatische Löschung nach Fristablauf – nur geschlossene Konten, die mindestens 14 Tage vorher
 *     erinnert wurden (DB prüft das zusätzlich). Ohne funktionierenden E-Mail-Versand wird nie gelöscht.
 * Lizenzende oder Kündigung allein führen NIE zu einer Löschung.
 * Abschaltbar mit ACCOUNT_AUTO_DELETE=off (dann weder Erinnerung noch Löschung).
 */
export async function runAccountRetention(deps: Deps): Promise<Record<string, unknown>> {
  if ((deps.env('ACCOUNT_AUTO_DELETE') ?? '').toLowerCase() === 'off') return { disabled: true };
  const db = deps.accountDb;
  if (!db) return { disabled: true };
  const candidates = await db.retentionReminderCandidates(RETENTION_REMINDER_DAYS);
  let reminded = 0;
  for (const c of candidates) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
    const ok = await sendLogged(deps, 'account_deletion_reminder', accountDeletionReminderMail(c.email, name, c.delete_not_before ?? c.deletion_due_at), c.user_id);
    if (ok) {
      await db.markDeletionReminded(c.user_id);
      reminded++;
    }
  }
  const due = await db.retentionDueAccounts(20);
  let deleted = 0;
  let skipped = 0;
  for (const d of due) {
    try {
      await performAccountDeletion(deps, d.user_id, 'retention');
      deleted++;
    } catch (e) {
      skipped++;
      deps.log?.(`retention: ${d.user_id} nicht gelöscht – ${errMsg(e)}`);
    }
  }
  return { retention: { reminderCandidates: candidates.length, reminded, due: due.length, deleted, skipped } };
}
