/**
 * Lizenzprüfung (rein, testbar). Der Simulator ist NUR zugänglich, wenn
 *   angemeldet ∧ Profil + Institution vorhanden ∧ Lizenz vorhanden ∧
 *   ( status = 'active'  ∨  status = 'past_due' mit noch laufender Frist – Grace Period, Phase 7 )
 *   ∧ (valid_from ≤ jetzt, falls gesetzt) ∧ (valid_until > jetzt, falls gesetzt).
 * Die Datenbank bietet dieselbe Prüfung serverseitig als public.has_active_license().
 * Der Lizenzstatus selbst wird ausschließlich serverseitig (Stripe-Webhook, Demo-Start, Super-Admin) gesetzt.
 *
 * Phase 8 – Demo: Lizenz mit source = 'demo' und valid_until = Demo-Ende.
 *   'demo'       → Demo läuft (voller Zugriff)
 *   'demo-ended' → Demo abgelaufen (kein Zugriff, Seite „Ihre Demo ist beendet“)
 * „jetzt“ ist die Serverzeit (serverClock), nicht die veränderbare Systemuhr.
 */
import type { CloudAccount } from './types';

export type AccessState =
  | 'signed-out'
  | 'no-profile'
  | 'no-institution'
  | 'no-license'
  | 'inactive'
  | 'expired'
  | 'not-yet-valid'
  | 'grace'
  | 'demo'
  | 'demo-ended'
  /** 0.10.0: Konto geschlossen – kein Zugriff, Inhalte bleiben erhalten, Konto kann wieder geöffnet werden */
  | 'account-closed'
  | 'active';

export function accessState(account: CloudAccount | null, now: Date = new Date()): AccessState {
  if (!account) return 'signed-out';
  if (!account.profile) return 'no-profile';
  if (!account.institution) return 'no-institution';
  if (account.profile.accountStatus === 'closed') return 'account-closed';
  const l = account.license;
  if (!l) return 'no-license';
  const t = now.getTime();
  if (l.source === 'demo') {
    const running = l.status === 'active' && !!l.validUntil && Date.parse(l.validUntil) > t && (!l.validFrom || Date.parse(l.validFrom) <= t);
    return running ? 'demo' : 'demo-ended';
  }
  const inGrace = l.status === 'past_due' && !!l.gracePeriodUntil && Date.parse(l.gracePeriodUntil) > t;
  if (l.status !== 'active' && !inGrace) return 'inactive';
  if (l.validFrom && Date.parse(l.validFrom) > t) return 'not-yet-valid';
  if (l.validUntil && Date.parse(l.validUntil) <= t) return 'expired';
  return inGrace ? 'grace' : 'active';
}

/** Darf der Simulator genutzt werden? (aktiv, Demo läuft oder Frist nach fehlgeschlagener Zahlung) */
export const canUseSimulator = (state: AccessState) => state === 'active' || state === 'grace' || state === 'demo';
export const hasActiveLicense = (account: CloudAccount | null, now?: Date) => canUseSimulator(accessState(account, now));
export const isSuperAdmin = (account: CloudAccount | null) => account?.profile?.role === 'super_admin';

/** Verbleibende Demo-Zeit in ms (0, wenn keine laufende Demo) – Grundlage NUR für die Anzeige */
export function demoRemainingMs(account: CloudAccount | null, now: Date): number {
  const l = account?.license;
  if (!l || l.source !== 'demo' || l.status !== 'active' || !l.validUntil) return 0;
  return Math.max(0, Date.parse(l.validUntil) - now.getTime());
}

/** Darf das Konto die Demo noch starten? (Anzeige; der Server prüft beim Start erneut) */
export function canStartDemo(account: CloudAccount | null, state: AccessState): boolean {
  if (!account?.profile || account.billing?.demoUsed) return false;
  if (account.profile.role !== 'institution_admin' && account.profile.role !== 'super_admin') return false;
  // geschlossenes Konto: erst wieder öffnen (serverseitig ebenso gesperrt)
  if (state === 'account-closed' || account.profile.accountStatus === 'closed') return false;
  return !canUseSimulator(state) && state !== 'demo-ended';
}

export const ACCESS_MESSAGE: Record<Exclude<AccessState, 'active' | 'grace' | 'demo' | 'signed-out'>, string> = {
  'no-profile': 'Zu Ihrem Konto wurde noch kein Profil angelegt. Bitte wenden Sie sich an info@olo-vision.de.',
  'no-institution': 'Ihrem Konto ist keine Institution zugeordnet. Bitte wenden Sie sich an info@olo-vision.de.',
  'no-license': 'Für Ihr Konto ist noch keine Lizenz vorhanden.',
  inactive: 'Ihre Lizenz ist noch nicht aktiv.',
  expired: 'Ihre Lizenz ist abgelaufen.',
  'not-yet-valid': 'Ihre Lizenz ist noch nicht gültig.',
  'demo-ended': 'Ihre OLO-LAB Demo ist beendet.',
  'account-closed': 'Ihr Konto ist geschlossen.',
};
