/**
 * Texte der transaktionalen E-Mails (reines TypeScript, in Vitest prüfbar).
 * Keine Werbung, nur vertrags- und kontobezogene Inhalte.
 */
import { endsAutomatically, isBillingInterval, PLAN_NAMES, priceLine, PRODUCT_NAME, PROVIDER_NAME, termNote, type BillingInterval } from './stripeConfig.ts';
import { isPlan, type LicensePlan } from './licenseStatus.ts';
import { plainText, type MailAttachment, type MailMessage } from './mailer.ts';

export const PROVIDER_BLOCK = `${PROVIDER_NAME}
Inhaber: Jonas Karol Lingener
Forsthausstraße 14
66709 Weiskirchen
E-Mail: info@olo-vision.de
USt-IdNr.: DE464512585`;

const FOOTER = `\n\n--\n${PROVIDER_BLOCK}\nhttps://olo-lab.de`;

const TZ = 'Europe/Berlin';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('de-DE', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) + ' Uhr' : '–';
export const fmtDate = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('de-DE', { timeZone: TZ, dateStyle: 'long' }).format(new Date(iso)) : '–');

const hello = (first?: string | null) => (first ? `Hallo ${first},` : 'Hallo,');

const DOC_LABEL: Record<string, string> = {
  terms: 'AGB',
  license_terms: 'Lizenz- und Nutzungsbedingungen',
  b2b_terms: 'B2B-Zusatzbedingungen',
  privacy: 'Datenschutzerklärung',
  withdrawal: 'Widerrufsbelehrung',
  withdrawal_form: 'Muster-Widerrufsformular',
  consent_immediate_performance: 'Verlangen des sofortigen Leistungsbeginns',
  consent_withdrawal_loss: 'Hinweis zum Wertersatz bei Widerruf',
};
const CONSENT_WORD: Record<string, string> = { accepted: 'akzeptiert', acknowledged: 'zur Kenntnis genommen', agreed: 'erklärt bzw. bestätigt' };

export interface ContractDoc {
  type: string;
  version: string;
  audience: string;
  hash: string | null;
  consent_type: string | null;
  title: string;
  checkbox_label: string | null;
  content: string;
}

export interface ContractData {
  email: string;
  first_name: string | null;
  last_name: string | null;
  customer_type: 'private' | 'business' | 'education';
  institution_name: string | null;
  country: string | null;
  plan: string | null;
  billing_interval: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  documents: ContractDoc[];
}

const safeName = (s: string) => s.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80);

/** Checkbox-Text so, wie er beim Kauf angezeigt wurde ({link} → Dokumenttitel) */
export const statementOf = (d: ContractDoc) => (d.checkbox_label ? d.checkbox_label.replace('{link}', d.title) : null);

/** Vertragsbestätigung auf dauerhaftem Datenträger (§ 312f Abs. 2 BGB): Text + akzeptierte Dokumente als Anhang */
export function contractConfirmationMail(d: ContractData): MailMessage {
  const plan: LicensePlan | null = isPlan(d.plan) ? d.plan : null;
  const interval: BillingInterval | null = isBillingInterval(d.billing_interval) ? d.billing_interval : null;
  const b2c = d.customer_type === 'private';
  const lines: string[] = [];
  lines.push(hello(d.first_name), '', `vielen Dank für deine Bestellung. Hiermit bestätigen wir den Vertrag über die Nutzung von ${PRODUCT_NAME}.`, '');
  lines.push('VERTRAGSDATEN');
  lines.push(`Tarif: ${plan ? PLAN_NAMES[plan] : '–'}`);
  if (plan && interval) {
    lines.push(`Preis: ${priceLine(plan, interval)}`);
    lines.push(`Laufzeit: ${termNote(plan, interval)}`);
  }
  if (!b2c && d.institution_name) lines.push(`Kunde: ${d.institution_name}`);
  lines.push(`Vertragsbeginn und Freischaltung: ${fmtDateTime(d.current_period_start)}`);
  if (plan && interval && endsAutomatically(plan, interval)) lines.push(`Ende der Laufzeit: ${fmtDate(d.current_period_end)} (keine automatische Verlängerung)`);
  else lines.push(`Aktueller Abrechnungszeitraum bis: ${fmtDate(d.current_period_end)}`);
  if (d.stripe_subscription_id) lines.push(`Abonnement-Nr.: ${d.stripe_subscription_id}`);
  lines.push('', 'Die Zahlung wird über Stripe abgewickelt; den Zahlungsbeleg bzw. die Rechnung erhältst du gesondert per E-Mail.');

  const statements = d.documents.filter((x) => x.consent_type === 'agreed' && statementOf(x));
  if (b2c && statements.length) {
    lines.push('', 'DEINE ERKLÄRUNGEN BEI DER BESTELLUNG');
    for (const s of statements) lines.push(`- ${statementOf(s)}`);
    lines.push(
      '',
      'Du kannst den Vertrag innerhalb von 14 Tagen widerrufen – auch über https://olo-lab.de/widerrufen. Da du den sofortigen Beginn der Leistung verlangt hast, schuldest du bei einem Widerruf einen zeitanteiligen Betrag für die Zeit bis zum Widerruf (Wertersatz). Einzelheiten stehen in der beigefügten Widerrufsbelehrung.',
    );
  }
  lines.push('', 'KÜNDIGUNG', 'Über https://olo-lab.de/kuendigen („Verträge hier kündigen“), im Kundenkonto unter „Abonnement verwalten“ oder per E-Mail an info@olo-vision.de.');

  const docs = d.documents.filter((x) => x.content?.trim());
  if (docs.length) {
    lines.push('', 'VERTRAGSDOKUMENTE (als Anhang, in der bei der Bestellung gültigen Fassung)');
    for (const x of docs) lines.push(`- ${x.title}, Version ${x.version}${x.consent_type ? ` – ${CONSENT_WORD[x.consent_type] ?? x.consent_type}` : ''}`);
  }
  const attachments: MailAttachment[] = docs.map((x, i) => ({
    filename: `${String(i + 1).padStart(2, '0')}_${safeName(DOC_LABEL[x.type] ?? x.title)}_v${safeName(x.version)}.txt`,
    content: `${x.title}\nVersion ${x.version}${x.hash ? `\nPrüfsumme (SHA-256): ${x.hash}` : ''}\n\n${plainText(x.content)}\n\n--\n${PROVIDER_BLOCK}\n`,
  }));
  return {
    to: d.email,
    subject: `Vertragsbestätigung ${plan ? PLAN_NAMES[plan] : PRODUCT_NAME}`,
    text: lines.join('\n') + FOOTER,
    attachments,
  };
}

export interface DeclarationMailData {
  id: string;
  kind: 'cancellation' | 'withdrawal';
  cancellationType: 'ordinary' | 'extraordinary' | null;
  name: string;
  email: string;
  contractDetails: string | null;
  reason: string | null;
  receivedAt: string;
  firstName?: string | null;
  /** Ergebnis der automatischen Kündigung: Vertragsende */
  endsAt?: string | null;
  /** bereits zuvor gekündigt */
  alreadyCancelled?: boolean;
  /** kein Abonnement zugeordnet → manuelle Prüfung */
  unmatched?: boolean;
}

/** Eingangsbestätigung Kündigung (§ 312k Abs. 4 BGB): Inhalt, Datum und Uhrzeit, Zeitpunkt der Beendigung */
export function cancellationConfirmationMail(d: DeclarationMailData): MailMessage {
  const lines = [hello(d.firstName), '', `wir bestätigen den Eingang deiner Kündigung am ${fmtDateTime(d.receivedAt)}.`, '', 'INHALT DEINER KÜNDIGUNG'];
  lines.push(`Art: ${d.cancellationType === 'extraordinary' ? 'außerordentliche Kündigung' : 'ordentliche Kündigung zum nächstmöglichen Zeitpunkt'}`);
  lines.push(`Name: ${d.name}`, `E-Mail: ${d.email}`);
  if (d.contractDetails) lines.push(`Vertrag: ${d.contractDetails}`);
  if (d.reason) lines.push(`Grund: ${d.reason}`);
  lines.push(`Vorgangsnummer: ${d.id}`, '');
  if (d.endsAt && d.cancellationType !== 'extraordinary') {
    lines.push(`Dein Vertrag endet zum ${fmtDate(d.endsAt)}. Bis dahin kannst du ${PRODUCT_NAME} weiter nutzen. Eine weitere Abbuchung erfolgt nicht.${d.alreadyCancelled ? ' (Der Vertrag war bereits zu diesem Zeitpunkt gekündigt.)' : ''}`);
  } else if (d.cancellationType === 'extraordinary') {
    lines.push('Wir prüfen deine außerordentliche Kündigung und melden uns zeitnah mit dem Zeitpunkt der Beendigung.');
  } else {
    lines.push('Wir konnten der angegebenen E-Mail-Adresse kein laufendes Abonnement automatisch zuordnen. Wir prüfen deine Kündigung und melden uns mit dem Zeitpunkt der Beendigung.');
  }
  return { to: d.email, subject: `Eingangsbestätigung deiner Kündigung – ${PRODUCT_NAME}`, text: lines.join('\n') + FOOTER };
}

/** Eingangsbestätigung Widerruf (§ 356a BGB) */
export function withdrawalConfirmationMail(d: DeclarationMailData): MailMessage {
  const lines = [hello(d.firstName), '', `wir bestätigen den Eingang deines Widerrufs am ${fmtDateTime(d.receivedAt)}.`, '', 'INHALT DEINES WIDERRUFS'];
  lines.push(`Name: ${d.name}`, `E-Mail: ${d.email}`);
  if (d.contractDetails) lines.push(`Vertrag: ${d.contractDetails}`);
  if (d.reason) lines.push(`Anmerkung: ${d.reason}`);
  lines.push(`Vorgangsnummer: ${d.id}`, '');
  lines.push(
    'Wir bearbeiten den Widerruf und erstatten dir die Zahlung spätestens 14 Tage nach Eingang über das bei der Bestellung verwendete Zahlungsmittel – abzüglich des zeitanteiligen Wertersatzes für die Zeit bis zum Widerruf, sofern du den sofortigen Beginn der Leistung verlangt hattest. Mit dem Widerruf endet der Vertrag.',
  );
  return { to: d.email, subject: `Eingangsbestätigung deines Widerrufs – ${PRODUCT_NAME}`, text: lines.join('\n') + FOOTER };
}

/** interne Benachrichtigung an OLO Vision */
export function declarationNoticeMail(to: string, d: DeclarationMailData, status: string): MailMessage {
  const lines = [
    `Neue ${d.kind === 'withdrawal' ? 'Widerrufserklärung' : 'Kündigung'} über die Website (${fmtDateTime(d.receivedAt)}).`,
    '',
    `Vorgang: ${d.id}`,
    `Status: ${status}`,
    `Art: ${d.kind === 'withdrawal' ? 'Widerruf' : d.cancellationType === 'extraordinary' ? 'außerordentliche Kündigung' : 'ordentliche Kündigung'}`,
    `Name: ${d.name}`,
    `E-Mail: ${d.email}`,
    `Vertrag (Angabe): ${d.contractDetails ?? '–'}`,
    `Grund/Anmerkung: ${d.reason ?? '–'}`,
    `Automatisch gekündigt zum: ${d.endsAt ? fmtDate(d.endsAt) : '–'}`,
    `Konto/Abo zugeordnet: ${d.unmatched ? 'nein – bitte manuell prüfen' : 'ja'}`,
    '',
    d.kind === 'withdrawal'
      ? 'Zu tun: Abo in Stripe sofort beenden, Wertersatz berechnen, Erstattung in Stripe ausführen, danach im Admin-Bereich auf „erledigt“ setzen.'
      : 'Zu tun: Vorgang im Admin-Bereich (Kündigungen & Widerrufe) prüfen und auf „erledigt“ setzen.',
  ];
  return { to, subject: `[OLO-LAB3D] ${d.kind === 'withdrawal' ? 'Widerruf' : 'Kündigung'} eingegangen – ${d.name}`, text: lines.join('\n'), replyTo: d.email };
}

export function renewalReminderMail(to: string, firstName: string | null, endsAt: string | null): MailMessage {
  const lines = [
    hello(firstName),
    '',
    `deine Jahreslizenz ${PLAN_NAMES.private} endet am ${fmtDate(endsAt)}. Sie verlängert sich nicht automatisch – es erfolgt keine weitere Abbuchung.`,
    '',
    `Wenn du ${PRODUCT_NAME} danach weiter nutzen möchtest, kannst du jederzeit neu buchen: https://olo-lab.de/license`,
  ];
  return { to, subject: `Deine Jahreslizenz ${PRODUCT_NAME} endet am ${fmtDate(endsAt)}`, text: lines.join('\n') + FOOTER };
}

export function b2bCountryNoticeMail(to: string, info: { email: string; institution: string | null; country: string | null; session: string }): MailMessage {
  return {
    to,
    subject: '[OLO-LAB3D] B2B-Kauf mit Rechnungsland außerhalb Deutschlands – bitte prüfen',
    text: [
      'Ein Business-/Education-Kauf wurde mit einer Rechnungsadresse außerhalb Deutschlands abgeschlossen.',
      'Die Rechnung enthält 19 % deutsche USt. – bitte steuerlich prüfen (ggf. Reverse Charge) und den Kunden kontaktieren.',
      '',
      `Kunde: ${info.institution ?? '–'} (${info.email})`,
      `Rechnungsland: ${info.country ?? '–'}`,
      `Checkout-Session: ${info.session}`,
    ].join('\n'),
  };
}
