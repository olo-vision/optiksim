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
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'PGRST301' || code === 'PGRST303' || msg.includes('auth session missing') || msg.includes('jwt expired') || msg.includes('invalid jwt'))
    return new CloudError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an – Ihre Änderungen sind auf diesem Gerät gesichert.', undefined, 'session');
  if (code === 'otp_expired' || code === 'flow_state_expired' || (msg.includes('expired') && (msg.includes('link') || msg.includes('otp') || msg.includes('token has')))) return map('Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.');
  if (code === 'validation_failed' || msg.includes('missing email or phone')) return map('Bitte geben Sie E-Mail-Adresse und Passwort ein.', 'email');
  if (code === 'user_banned' || msg.includes('banned')) return map('Dieses Konto ist gesperrt. Bitte wenden Sie sich an info@olo-vision.de.');
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) return map('Registrierungen sind derzeit nicht möglich. Bitte versuchen Sie es später erneut.');
  // Phase 8: fachliche Fehlercodes der Datenbank (SQLSTATE)
  if (code === 'OLD01') return map('Die kostenlose Demo wurde für dieses Kundenkonto bereits genutzt.');
  if (code === 'OLD02') return map('Für dieses Kundenkonto besteht bereits eine Lizenz – die Demo ist nicht nötig.');
  if (code === 'OLD03') return map('Die Demo kann nur die Administration des Kundenkontos starten.');
  if (code === 'OLC01' || code === 'consents_missing') return map('Bitte bestätigen Sie alle erforderlichen Rechtstexte.');
  if (code === 'OLC02' || code === 'consents_outdated') return map('Die Rechtstexte wurden inzwischen aktualisiert. Bitte prüfen Sie sie und bestätigen Sie erneut.');
  // 0.10.0: Cloud-Inhalte und Konto
  if (code === 'OLL01') return map('Zum Speichern ist eine aktive Lizenz erforderlich. Ihre bereits gespeicherten Inhalte bleiben erhalten.');
  if (code === 'OLL02') return map('Die maximale Anzahl gespeicherter Inhalte ist erreicht. Bitte löschen Sie nicht mehr benötigte Einträge oder wenden Sie sich an info@olo-vision.de.');
  if (code === 'OLA03') return map('Ihr Konto ist geschlossen. Bitte öffnen Sie es unter „Konto“ zuerst wieder.');
  if (code === '57014' || msg.includes('statement timeout')) return map('Der Vorgang hat zu lange gedauert. Bitte versuchen Sie es erneut.');
  if (code === 'OLA01' || code === 'subscription_active') return map('Bitte kündigen Sie zuerst Ihr Abonnement. Danach ist dieser Schritt möglich.');
  if (code === 'reauth_required') return map('Bitte bestätigen Sie den Vorgang mit Ihrem aktuellen Passwort.', 'password');
  if (code === 'email_change_same' || msg.includes('same as the old')) return map('Die neue E-Mail-Adresse entspricht der bisherigen.', 'email');
  if (code === '23514') return map('Der Inhalt ist zu groß zum Speichern. Bitte verkleinern Sie die Simulation oder exportieren Sie sie als Datei.');
  if (code === '42501' || msg.includes('permission denied') || msg.includes('row-level security')) return map('Dafür fehlen die Berechtigungen.');
  if (msg.includes('database error saving new user')) return map('Das Konto konnte nicht angelegt werden (Datenbank). Sind die Supabase-Migrationen eingespielt?');
  // Netzwerkfehler erhalten den Code „network“ (Speichern wird später automatisch erneut versucht)
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) return new CloudError('Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.', undefined, 'network');
  // Eigene Datenbankmeldungen (deutsch, RAISE ohne/mit eigenem Code) unverändert anzeigen –
  // alles andere (technische englische Meldungen) nur als neutrale Meldung mit Code
  if ((/^(P0001|P0002|22023|OL[A-Z]\d\d)$/.test(code) || !code) && err.message && /[äöüß]|^(Bitte|Die|Der|Das|Ihr|Sie|Es|Nur|Kein|Diese|Zu|Für|Name|Ungültig|Unbekannt|Konto)\b/.test(err.message)) return map(err.message);
  if (typeof console !== 'undefined') console.warn('[OLO-LAB3D] Unerwarteter Fehler:', err.message ?? e);
  return map(`Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es erneut${code ? ` (Code ${code})` : ''}.`);
}
