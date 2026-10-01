/**
 * E-Mail-Änderung über Supabase Auth – Auswertung der Antworten und des Rücksprungs aus dem Bestätigungslink.
 *
 * Ablauf in Supabase (implicit flow):
 *  1. `updateUser({ email })` → Supabase setzt `new_email` und `email_change_sent_at` und versendet die Vorlage
 *     „Change Email Address“ – bei „Secure email change“ (Standard) an die bisherige UND die neue Adresse.
 *     Ist „Confirm email“ ausgeschaltet, ändert Supabase die Adresse sofort und versendet nichts.
 *  2. Klick auf den ersten von zwei Links → Rücksprung mit `#message=Confirmation link accepted. Please proceed
 *     to confirm link sent to the other email`.
 *  3. Klick auf den letzten Link → Rücksprung mit `#access_token=…&type=email_change`; erst jetzt gilt die neue Adresse.
 *  Fehler (abgelaufen, schon benutzt) → `#error=…&error_code=otp_expired&error_description=…`.
 */
import type { CloudUser, EmailChangeResult } from './types';
import { CloudError } from './types';

/** Supabase versendet E-Mails derselben Art je Benutzer höchstens alle 60 s (Auth → Rate Limits) */
export const EMAIL_RESEND_COOLDOWN_S = 60;

export interface AuthRedirectInfo {
  type?: string;
  message?: string;
  error?: string;
  errorCode?: string;
  errorDescription?: string;
  hasToken?: boolean;
}

/** Parameter aus Hash und Query des Rücksprungs (Supabase nutzt je nach Flow beides) */
export function parseAuthRedirect(hash: string, search: string): AuthRedirectInfo {
  const p = new URLSearchParams(search.replace(/^\?/, ''));
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const get = (k: string) => h.get(k) ?? p.get(k) ?? undefined;
  return {
    type: get('type'),
    message: get('message'),
    error: get('error'),
    errorCode: get('error_code'),
    errorDescription: get('error_description'),
    hasToken: !!(get('access_token') || get('code') || get('token_hash')),
  };
}

/** Beim Laden der Seite festgehalten – bevor supabase-js den Hash auswertet bzw. die Seite umleitet */
let arrival: AuthRedirectInfo | null = typeof window !== 'undefined' ? parseAuthRedirect(window.location.hash, window.location.search) : null;

/** Rücksprung-Informationen genau einmal abholen */
export function takeArrivalAuthRedirect(): AuthRedirectInfo {
  const a = arrival ?? {};
  arrival = null;
  return a;
}

export type EmailChangeReturn =
  | { kind: 'confirmed'; email: string }
  | { kind: 'partial'; pendingEmail: string | null; currentEmail: string }
  | { kind: 'error'; message: string };

/**
 * Was ist nach dem Klick auf einen Bestätigungslink passiert? Entscheidend ist der aktuelle Benutzer laut
 * Supabase (nach dem Neuladen), nicht allein der Parameter in der Adresse.
 */
export function classifyEmailChangeReturn(info: AuthRedirectInfo, user: Pick<CloudUser, 'email' | 'pendingEmail'> | null): EmailChangeReturn {
  if (info.error || info.errorCode) {
    const expired = info.errorCode === 'otp_expired' || /expired|invalid/i.test(info.errorDescription ?? '');
    return {
      kind: 'error',
      message: expired
        ? 'Der Bestätigungslink ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie die Änderung der E-Mail-Adresse erneut an.'
        : 'Die E-Mail-Adresse konnte nicht bestätigt werden. Bitte fordern Sie die Änderung erneut an.',
    };
  }
  const firstOfTwo = /other email|proceed to confirm/i.test(info.message ?? '');
  if (user?.pendingEmail || firstOfTwo) return { kind: 'partial', pendingEmail: user?.pendingEmail ?? null, currentEmail: user?.email ?? '' };
  return { kind: 'confirmed', email: user?.email ?? '' };
}

/**
 * Antwort von `updateUser`/`resend` auswerten. Erfolg wird nur gemeldet, wenn Supabase die Änderung
 * nachweislich angenommen hat.
 */
export function emailChangeResultFrom(requested: string, user: { email?: string | null; new_email?: string | null; email_change_sent_at?: string | null } | null, previousEmail: string, confirmBoth: boolean, requestedAt?: number): EmailChangeResult {
  const want = requested.trim().toLowerCase();
  const email = (user?.email ?? '').toLowerCase();
  const pending = (user?.new_email ?? '').toLowerCase();
  if (email === want && email !== previousEmail.toLowerCase()) return { status: 'changed', newEmail: want };
  if (pending === want) {
    const sentAt = user?.email_change_sent_at ?? null;
    // Supabase setzt email_change_sent_at erst nach erfolgreicher Übergabe an den Mailserver
    if (!sentAt || (requestedAt !== undefined && Date.parse(sentAt) < requestedAt - 5 * 60_000)) {
      throw new CloudError('Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte versuchen Sie es in einigen Minuten erneut. Falls das Problem bleibt, schreiben Sie uns an info@olo-vision.de.', undefined, 'email_not_sent');
    }
    return { status: 'pending', newEmail: want, currentEmail: previousEmail, sentAt, confirmBoth };
  }
  throw new CloudError('Die Änderung der E-Mail-Adresse wurde nicht angenommen. Bitte versuchen Sie es erneut.', undefined, 'email_change_rejected');
}

/** Sekunden bis „Erneut senden“ möglich ist */
export function resendWaitSeconds(sentAt: string | null | undefined, now = Date.now()): number {
  if (!sentAt) return 0;
  const t = Date.parse(sentAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil(EMAIL_RESEND_COOLDOWN_S - (now - t) / 1000));
}
