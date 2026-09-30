/**
 * Verständliche deutsche Fehlermeldungen für Supabase-Auth-/Datenbankfehler.
 */
import { CloudError } from './types';

interface ErrLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

export function translateError(e: unknown): CloudError {
  if (e instanceof CloudError) return e;
  const err = (e ?? {}) as ErrLike;
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  const map = (text: string, field?: string) => new CloudError(text, field, code || undefined);
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return map('E-Mail oder Passwort ist nicht korrekt.', 'password');
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return map('Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse (Link in der Bestätigungs-E-Mail).');
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return map('Für diese E-Mail-Adresse existiert bereits ein Konto.', 'email');
  if (code === 'weak_password' || msg.includes('password should be')) return map('Das Passwort ist zu schwach. Bitte ein längeres Passwort mit Buchstaben und Ziffern wählen.', 'password');
  if (code === 'email_address_invalid' || msg.includes('invalid email') || msg.includes('email address') && msg.includes('invalid')) return map('Diese E-Mail-Adresse wird nicht akzeptiert.', 'email');
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429 || msg.includes('rate limit')) return map('Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.');
  if (code === 'same_password') return map('Das neue Passwort muss sich vom bisherigen unterscheiden.', 'password');
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || msg.includes('auth session missing')) return map('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  if (code === 'otp_expired' || msg.includes('expired')) return map('Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.');
  // Phase 8: fachliche Fehlercodes der Datenbank (SQLSTATE)
  if (code === 'OLD01') return map('Die kostenlose Demo wurde für dieses Kundenkonto bereits genutzt.');
  if (code === 'OLD02') return map('Für dieses Kundenkonto besteht bereits eine Lizenz – die Demo ist nicht nötig.');
  if (code === 'OLD03') return map('Die Demo kann nur die Administration des Kundenkontos starten.');
  if (code === 'OLC01' || code === 'consents_missing') return map('Bitte bestätigen Sie alle erforderlichen Rechtstexte.');
  if (code === 'OLC02' || code === 'consents_outdated') return map('Die Rechtstexte wurden inzwischen aktualisiert. Bitte prüfen Sie sie und bestätigen Sie erneut.');
  // 0.10.0: Cloud-Inhalte und Konto
  if (code === 'OLL01') return map('Zum Speichern ist eine aktive Lizenz erforderlich. Ihre bereits gespeicherten Inhalte bleiben erhalten.');
  if (code === 'OLA01' || code === 'subscription_active') return map('Bitte kündigen Sie zuerst Ihr Abonnement. Danach ist dieser Schritt möglich.');
  if (code === 'reauth_required') return map('Bitte bestätigen Sie den Vorgang mit Ihrem aktuellen Passwort.', 'password');
  if (code === 'email_change_same' || msg.includes('same as the old')) return map('Die neue E-Mail-Adresse entspricht der bisherigen.', 'email');
  if (code === '23514') return map('Der Inhalt ist zu groß zum Speichern. Bitte verkleinern Sie die Simulation oder exportieren Sie sie als Datei.');
  if (code === '42501' || msg.includes('permission denied') || msg.includes('row-level security')) return map('Dafür fehlen die Berechtigungen.');
  if (msg.includes('database error saving new user')) return map('Das Konto konnte nicht angelegt werden (Datenbank). Sind die Supabase-Migrationen eingespielt?');
  // Netzwerkfehler erhalten den Code „network“ (Speichern wird später automatisch erneut versucht)
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) return new CloudError('Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.', undefined, 'network');
  return map(err.message || 'Unbekannter Fehler.');
}
