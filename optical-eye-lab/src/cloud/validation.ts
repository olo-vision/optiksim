/**
 * Prüfung der Registrierungsdaten (Frontend). Die Datenbank prüft und begrenzt die Werte zusätzlich
 * im Trigger handle_new_user; Rolle und Lizenzstatus kommen NIE aus dem Frontend.
 */
import { CloudError, INSTITUTION_TYPES, type RegistrationInput } from './types';

export const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateRegistration(r: RegistrationInput): void {
  if (!r.firstName.trim()) throw new CloudError('Bitte Vornamen eingeben.', 'firstName');
  if (!r.lastName.trim()) throw new CloudError('Bitte Nachnamen eingeben.', 'lastName');
  if (!EMAIL_RE.test(r.email.trim())) throw new CloudError('Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
  if (r.password.length < MIN_PASSWORD) throw new CloudError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`, 'password');
  if (!/[A-Za-zÄÖÜäöüß]/.test(r.password) || !/\d/.test(r.password)) throw new CloudError('Das Passwort muss Buchstaben und Ziffern enthalten.', 'password');
  if (r.password !== r.passwordConfirm) throw new CloudError('Die Passwörter stimmen nicht überein.', 'passwordConfirm');
  if (!INSTITUTION_TYPES.includes(r.institutionType)) throw new CloudError('Bitte die Art der Nutzung wählen.', 'institutionType');
  if (r.institutionType === 'business' && !r.institutionName?.trim()) throw new CloudError('Bitte den Firmennamen eingeben.', 'institutionName');
  if (r.institutionType === 'education' && !r.institutionName?.trim()) throw new CloudError('Bitte den Namen der Schule / Bildungseinrichtung eingeben.', 'institutionName');
  // B2B (Phase 8): Rechnungsanschrift ist Pflicht, USt-IdNr. optional
  if (r.institutionType !== 'private') {
    if (!r.addressLine1?.trim()) throw new CloudError('Bitte Straße und Hausnummer der Rechnungsanschrift eingeben.', 'addressLine1');
    if (!r.postalCode?.trim()) throw new CloudError('Bitte die Postleitzahl eingeben.', 'postalCode');
    if (!r.city?.trim()) throw new CloudError('Bitte den Ort eingeben.', 'city');
    if (!r.country?.trim()) throw new CloudError('Bitte das Land wählen.', 'country');
    const vat = (r.vatId ?? '').replace(/\s/g, '');
    if (vat && !/^[A-Za-z]{2}[A-Za-z0-9+*.]{2,13}$/.test(vat)) throw new CloudError('Bitte eine gültige USt-IdNr. eingeben (z. B. DE123456789) oder das Feld leer lassen.', 'vatId');
  }
  for (const [k, v, max] of [
    ['firstName', r.firstName, 100],
    ['lastName', r.lastName, 100],
    ['institutionName', r.institutionName, 200],
    ['contactName', r.contactName, 200],
    ['addressLine1', r.addressLine1, 200],
    ['postalCode', r.postalCode, 20],
    ['city', r.city, 120],
    ['contactPosition', r.contactPosition, 120],
  ] as const) {
    if (v && v.trim().length > max) throw new CloudError(`Eingabe zu lang (max. ${max} Zeichen).`, k);
  }
}

/**
 * Metadaten für supabase.auth.signUp({ options: { data } }). Nur Stammdaten – der Trigger
 * übernimmt ausschließlich diese Schlüssel.
 */
export function registrationMetadata(r: RegistrationInput): Record<string, string | string[]> {
  const t = (s?: string) => (s ?? '').trim();
  const meta: Record<string, string | string[]> = {
    first_name: t(r.firstName),
    last_name: t(r.lastName),
    institution_type: r.institutionType,
  };
  if (r.institutionType !== 'private') {
    meta.institution_name = t(r.institutionName);
    for (const [k, v] of [
      ['contact_name', r.contactName],
      ['address_line_1', r.addressLine1],
      ['address_line_2', r.addressLine2],
      ['postal_code', r.postalCode],
      ['city', r.city],
      ['country', r.country],
      ['contact_position', r.contactPosition],
      ['vat_id', r.vatId],
    ] as const) {
      if (t(v)) meta[k] = t(v);
    }
  }
  // IDs der angezeigten Rechtstext-Versionen – der Datenbank-Trigger prüft und protokolliert sie
  if (r.consentDocumentIds?.length) meta.legal_consents = [...new Set(r.consentDocumentIds)];
  return meta;
}
