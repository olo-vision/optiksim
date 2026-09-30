/**
 * Rechtsbetrieb – reine Logik: Preis-/Laufzeittexte (Server = Browser), Hinweis am Stripe-Button,
 * E-Mail-Konfiguration und -Texte, Anzeige privater Jahreslizenzen, Markdown-Zeilenumbrüche, Prüfhinweise,
 * Rechtstexte 1.0 (Pflichtangaben vorhanden, keine erfundenen Daten, Checkbox-Texte).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutSubmitMessage, endsAutomatically as serverEnds, PRICE_LABELS, priceLine, termNote } from '../supabase/functions/_shared/stripeConfig';
import { addressOf, mailConfig, plainText } from '../supabase/functions/_shared/mailer';
import { cancellationConfirmationMail, contractConfirmationMail, withdrawalConfirmationMail, type ContractData } from '../supabase/functions/_shared/mailTemplates';
import { endsAutomatically, planPrice, PLANS } from '@/cloud/plans';
import { billingNotice } from '@/cloud/billing';
import { countReviewMarkers, consentLabel, hasReviewMarkers, parseMarkdown } from '@/cloud/legal';
import type { CloudAccount } from '@/cloud/types';

const env = (m: Record<string, string>) => (k: string) => m[k];

describe('Preise und Laufzeit: Server und Browser stimmen überein', () => {
  it('Preisangaben identisch, alle inkl. 19 % USt.', () => {
    for (const p of PLANS) {
      expect(PRICE_LABELS[`${p.id}_monthly`]).toBe(p.priceLabel);
      expect(PRICE_LABELS[`${p.id}_yearly`]).toBe(p.yearlyPriceLabel);
      for (const i of ['monthly', 'yearly'] as const) {
        expect(planPrice(p, i).note).toContain('inkl. 19 % USt.');
        expect(priceLine(p.id, i)).toContain('inkl. 19 % USt.');
        expect(endsAutomatically(p.id, i)).toBe(serverEnds(p.id, i));
      }
    }
  });
  it('nur die private Jahreslizenz endet automatisch; B2B-Jahresabos verlängern sich', () => {
    expect(termNote('private', 'yearly')).toContain('endet automatisch');
    expect(termNote('business', 'yearly')).toContain('verlängert sich');
    expect(termNote('education', 'monthly')).toContain('jederzeit zum Ende des Abrechnungsmonats kündbar');
    expect(planPrice(PLANS[0], 'yearly').term).toContain('keine Verlängerung');
  });
  it('Hinweis am Stripe-Button nennt Zahlungspflicht, Preis, Laufzeit und Bedingungen', () => {
    const b2c = checkoutSubmitMessage('private', 'monthly', true);
    expect(b2c).toMatch(/^Mit Klick auf „Abonnieren“ bestellen Sie OLO-LAB3D Private zahlungspflichtig: 19,90 € pro Monat inkl\. 19 % USt\./);
    expect(b2c).toContain('Widerrufsbelehrung');
    const b2b = checkoutSubmitMessage('education', 'yearly', false);
    expect(b2b).toContain('999,00 € pro Jahr');
    expect(b2b).toContain('B2B-Zusatzbedingungen');
    for (const p of PLANS) for (const i of ['monthly', 'yearly'] as const) expect(checkoutSubmitMessage(p.id, i, p.id === 'private').length).toBeLessThanOrEqual(1200);
  });
});

describe('E-Mail-Konfiguration', () => {
  it('ohne vollständige SMTP-Daten kein Versand; Port 587/25 wird beanstandet', () => {
    expect(mailConfig(env({})).transport).toBe('none');
    expect(mailConfig(env({ SMTP_HOST: 'smtp.x', SMTP_USER: 'info@olo-vision.de' })).transport).toBe('none');
    const ok = mailConfig(env({ SMTP_HOST: 'smtp.x', SMTP_USER: 'info@olo-vision.de', SMTP_PASSWORD: 'geheim' }));
    expect(ok).toMatchObject({ transport: 'smtp', port: 465, from: 'info@olo-vision.de', notifyTo: 'info@olo-vision.de', warning: null });
    expect(mailConfig(env({ SMTP_HOST: 'smtp.x', SMTP_USER: 'a@b.de', SMTP_PASSWORD: 'x', SMTP_PORT: '587' })).warning).toMatch(/465/);
    expect(mailConfig(env({ SMTP_HOST: 'h', SMTP_USER: 'a@b.de', SMTP_PASSWORD: 'x', MAIL_FROM: 'OLO Vision <info@olo-vision.de>', MAIL_NOTIFY_TO: 'jon@olo-vision.de' }))).toMatchObject({ notifyTo: 'jon@olo-vision.de' });
    expect(addressOf('OLO Vision <info@olo-vision.de>')).toBe('info@olo-vision.de');
    expect(addressOf('kaputt')).toBeNull();
  });
  it('Markdown wird für Anhänge in lesbaren Text umgewandelt', () => {
    expect(plainText('## Titel\n\n**fett** und normal\n\n\n\nEnde')).toBe('TITEL\n\nfett und normal\n\nEnde');
  });
});

describe('E-Mail-Texte', () => {
  const data: ContractData = {
    email: 'kunde@web.de', first_name: 'Karla', last_name: 'Kunde', customer_type: 'private', institution_name: null, country: 'DE', plan: 'private', billing_interval: 'monthly',
    current_period_start: '2026-10-01T10:00:00Z', current_period_end: '2026-11-01T10:00:00Z', cancel_at_period_end: false, stripe_subscription_id: 'sub_1',
    documents: [
      { type: 'terms', version: '1.0', audience: 'all', hash: 'abc', consent_type: 'accepted', title: 'Allgemeine Geschäftsbedingungen', checkbox_label: 'Ich habe die {link} gelesen und akzeptiere sie.', content: '## 1. Geltung\n\nText' },
      { type: 'consent_immediate_performance', version: '1.0', audience: 'b2c', hash: 'def', consent_type: 'agreed', title: 'Verlangen', checkbox_label: 'Ich verlange ausdrücklich den sofortigen Beginn. ({link})', content: 'Erläuterung' },
    ],
  };
  it('Vertragsbestätigung: Vertragsdaten, Erklärungen, Anhänge; Anbieter vollständig', () => {
    const m = contractConfirmationMail(data);
    expect(m.subject).toBe('Vertragsbestätigung OLO-LAB3D Private');
    expect(m.text).toContain('19,90 € pro Monat inkl. 19 % USt.');
    expect(m.text).toContain('Ich verlange ausdrücklich den sofortigen Beginn. (Verlangen)');
    expect(m.text).toContain('Forsthausstraße 14');
    expect(m.text).toContain('DE464512585');
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments![0].filename).toMatch(/^01_AGB_v1\.0\.txt$/);
    expect(m.attachments![0].content).toContain('1. GELTUNG');
    // B2B: keine Verbraucher-Erklärungen
    expect(contractConfirmationMail({ ...data, customer_type: 'business', plan: 'business' }).text).not.toContain('DEINE ERKLÄRUNGEN');
  });
  it('Kündigungs- und Widerrufsbestätigung: Inhalt, Datum/Uhrzeit, Vertragsende', () => {
    const base = { id: 'd1', cancellationType: 'ordinary' as const, name: 'Karla', email: 'kunde@web.de', contractDetails: 'Private', reason: null, receivedAt: '2026-10-05T08:30:00Z' };
    const c = cancellationConfirmationMail({ ...base, kind: 'cancellation', endsAt: '2026-11-01T10:00:00Z' });
    expect(c.text).toContain('am 05.10.2026, 10:30 Uhr');
    expect(c.text).toContain('Ihr Vertrag endet zum 1. November 2026');
    expect(cancellationConfirmationMail({ ...base, kind: 'cancellation', cancellationType: 'extraordinary', reason: 'Umzug' }).text).toContain('außerordentliche Kündigung');
    expect(withdrawalConfirmationMail({ ...base, kind: 'withdrawal', cancellationType: null }).text).toContain('Wertersatz');
  });
});

describe('Anzeige privater Jahreslizenzen', () => {
  const acc = (end: string, plan: 'private' | 'business' = 'private'): CloudAccount =>
    ({
      license: { id: 'l', institutionId: 'i', plan, status: 'active', validFrom: null, validUntil: end, maxLocations: 1, source: 'stripe', gracePeriodUntil: null },
      billing: { cancelAtPeriodEnd: true, billingInterval: 'yearly', currentPeriodEnd: end },
    }) as unknown as CloudAccount;
  const now = new Date('2026-10-01T00:00:00Z');
  it('kein „Gekündigt“, Hinweis erst in den letzten 30 Tagen', () => {
    expect(billingNotice(acc('2027-06-01T00:00:00Z'), now)).toBeNull();
    expect(billingNotice(acc('2026-10-20T00:00:00Z'), now)).toMatchObject({ testId: 'term-end-note' });
    expect(billingNotice(acc('2026-10-20T00:00:00Z', 'business'), now)).toMatchObject({ testId: 'cancel-note' });
  });
});

describe('Rechtstexte im Browser', () => {
  it('Zeilenumbrüche bleiben erhalten (Anschrift), Prüfhinweise werden erkannt', () => {
    const b = parseMarkdown('**OLO Vision**\nForsthausstraße 14\n66709 Weiskirchen');
    expect(b).toHaveLength(1);
    expect(b[0].kind === 'p' && b[0].inline.filter((x) => x.br)).toHaveLength(2);
    expect(hasReviewMarkers('a [Prüfhinweis: x] b')).toBe(true);
    expect(countReviewMarkers('[Prüfhinweis: a]\n[Prüfhinweis: b]')).toBe(2);
    expect(hasReviewMarkers(null)).toBe(false);
  });
});

describe('Rechtstexte 1.0 (docs/legal)', () => {
  const dir = join(__dirname, '..', 'docs', 'legal');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { documents: Array<{ file: string; type: string; audience: string; checkboxLabel: string | null; title: string }> };
  const text = (f: string) => readFileSync(join(dir, f), 'utf8');
  it('alle erwarteten Dokumenttypen mit passender Zielgruppe', () => {
    expect(manifest.documents.map((d) => `${d.type}/${d.audience}`).sort()).toEqual(
      ['b2b_terms/b2b', 'consent_immediate_performance/b2c', 'consent_withdrawal_loss/b2c', 'imprint/all', 'license_terms/all', 'privacy/all', 'terms/all', 'withdrawal/b2c', 'withdrawal_form/b2c'].sort(),
    );
  });
  it('Anbieterdaten konsistent und vollständig; keine Platzhalter', () => {
    for (const d of manifest.documents) {
      const t = text(d.file);
      expect(t).not.toMatch(/\[(NAME|ADRESSE|TODO|XXX|PLATZHALTER)/i);
      if (/Forsthausstraße/.test(t)) expect(t).toContain('66709 Weiskirchen');
    }
    const imp = text('01_impressum.md');
    for (const s of ['OLO Vision', 'Jonas Karol Lingener', 'Forsthausstraße 14', '66709 Weiskirchen', 'info@olo-vision.de', 'DE464512585']) expect(imp).toContain(s);
    expect(imp).not.toMatch(/OS-Plattform|ec\.europa\.eu\/consumers\/odr/);
  });
  it('Checkbox-Texte: Verlinkung, Verbraucher-Erklärungen eindeutig', () => {
    const byType = Object.fromEntries(manifest.documents.map((d) => [d.type, d]));
    for (const t of ['terms', 'license_terms', 'b2b_terms', 'privacy', 'withdrawal', 'consent_immediate_performance', 'consent_withdrawal_loss']) expect(byType[t].checkboxLabel).toContain('{link}');
    expect(byType.imprint.checkboxLabel).toBeNull();
    expect(byType.withdrawal_form.checkboxLabel).toBeNull();
    expect(byType.consent_immediate_performance.checkboxLabel).toMatch(/^Ich verlange ausdrücklich/);
    expect(byType.consent_withdrawal_loss.checkboxLabel).toContain('Wertersatz');
    expect(consentLabel({ title: 'AGB', checkboxLabel: byType.terms.checkboxLabel, consentType: 'accepted' })).toEqual({ before: 'Ich habe die ', linkText: 'AGB', after: ' gelesen und akzeptiere sie.' });
  });
  it('Kernaussagen: Demo ohne Abo, private Jahreslizenz ohne Verlängerung, Wertersatz statt pauschalem Erlöschen', () => {
    const agb = text('02_agb.md');
    expect(agb).toContain('nicht automatisch in ein kostenpflichtiges Abonnement über');
    expect(agb).toContain('endet automatisch');
    expect(agb).toContain('inklusive 19 % Umsatzsteuer');
    expect(agb).toContain('„Abonnieren“');
    expect(text('06_widerrufsbelehrung.md')).toContain('einen angemessenen Betrag zu zahlen');
    expect(text('09_hinweis_wertersatz.md')).not.toMatch(/erlischt (sofort|mit Beginn)/);
    const lic = text('03_lizenzbedingungen.md');
    for (const s of ['eine Betriebsstätte unter einer konkreten Geschäftsanschrift', 'Homeoffice', 'kein Medizinprodukt', 'an das Kundenkonto gebunden, nicht an die Lizenz', 'endgültig löschen', 'einmalig für 2 Stunden']) expect(lic).toContain(s);
    // 0.10.1: Lizenzende ist kein Löschwunsch; 12-Monats-Frist nur für geschlossene Konten (mit Erinnerung)
    const ds = text('05_datenschutz.md');
    expect(ds).toContain('führt nicht zur Löschung');
    expect(ds).toContain('12 Monate ab der Schließung');
    expect(ds).toMatch(/erinnern wir Sie per E-Mail/);
    expect(ds).not.toMatch(/12 Monate nach (dem )?Ende des (letzten )?Vertrags/);
    expect(ds).not.toMatch(/letzten relevanten Anmeldung/);
    expect(lic).toContain('kein Löschgrund');
    expect(text('02_agb.md')).not.toContain('bis zum Ablauf der in der Datenschutzerklärung genannten Speicherdauer');
    // 0.10.0: Cloud-Speicherung – keine veralteten Aussagen zur reinen Browser-Speicherung
    for (const f of ['02_agb.md', '03_lizenzbedingungen.md', '04_b2b_bedingungen.md', '05_datenschutz.md']) expect(text(f)).not.toMatch(/derzeit (\*\*)?(ausschließlich )?lokal im Browser/);
  });
});
