# OLO-LAB3D – Rechtstexte und Rechtsbetrieb (Version 0.9.0)

Baut auf Phase 8 auf ([PHASE8_DEMO_LEGAL.md](PHASE8_DEMO_LEGAL.md)). Enthält die erste Betriebsfassung der Rechtstexte
(als **Entwürfe 1.0**), den Kündigungs- und Widerrufsbutton, die Vertragsbestätigung per E-Mail, den Umsatzsteuer-
ausweis über Stripe und die automatische Beendigung privater Jahreslizenzen.

> Die Texte sind eine sorgfältig vorbereitete erste Fassung, aber **keine anwaltlich geprüften oder garantiert
> rechtssicheren Texte**. Punkte mit Prüfbedarf sind im Text mit **[Prüfhinweis: …]** markiert. Das Vertragscenter
> veröffentlicht einen Entwurf erst, wenn alle Markierungen entfernt sind.

## 1. Dokumente (Entwürfe 1.0)

Quelle: `docs/legal/*.md` + `docs/legal/manifest.json` → Import-Skript `supabase/seed/legal_documents_v1_0_drafts.sql`
(neu erzeugen mit `node scripts/legal-seed.mjs`).

| Dokument | Typ / Zielgruppe | Abgefragt bei | Art | Checkbox-Text |
|---|---|---|---|---|
| Impressum | `imprint` / alle | nie – Seite `/impressum`, Fußzeile | – | – |
| AGB | `terms` / alle | Kauf (B2C + B2B) | Pflicht | „Ich habe die {AGB} gelesen und akzeptiere sie.“ |
| Lizenz- und Nutzungsbedingungen (inkl. Demo, Standort, Zugangsdaten, kein Medizinprodukt) | `license_terms` / alle | Registrierung (gilt für Demo) + Kauf | Pflicht | „Ich akzeptiere die {…} und bestätige, mindestens 18 Jahre alt zu sein oder mit Zustimmung meiner gesetzlichen Vertreter zu handeln.“ |
| B2B-Zusatzbedingungen | `b2b_terms` / B2B | Kauf Business/Education | Pflicht | „Ich bestelle für ein Unternehmen bzw. eine Bildungseinrichtung und akzeptiere die {…}.“ |
| Datenschutzerklärung | `privacy` / alle | Registrierung + Kauf | Kenntnisnahme | „Ich habe die {…} zur Kenntnis genommen.“ |
| Widerrufsbelehrung (digitale Dienstleistung, Wertersatz) | `withdrawal` / B2C | Kauf Private | Kenntnisnahme | „Ich habe die {…} zur Kenntnis genommen.“ |
| Muster-Widerrufsformular | `withdrawal_form` / B2C | Kauf Private | nur Link | – |
| Verlangen des sofortigen Leistungsbeginns | `consent_immediate_performance` / B2C | Kauf Private | Pflicht | „Ich verlange ausdrücklich, dass OLO Vision mit der Leistung (Freischaltung von OLO-LAB3D) sofort nach Vertragsschluss und damit vor Ablauf der Widerrufsfrist beginnt.“ |
| Hinweis zum Wertersatz bei Widerruf | `consent_withdrawal_loss` / B2C | Kauf Private | Pflicht | „Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachte Leistung einen anteiligen Betrag (Wertersatz) zahlen muss und dass mein Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist.“ |

Der interne Typ `consent_withdrawal_loss` bleibt bestehen, damit frühere Zustimmungen gültig bleiben. Anzeige und
Inhalt lauten jetzt „Hinweis zum Wertersatz“, weil OLO-LAB3D als laufende **digitale Dienstleistung** eingeordnet
wird: Das Widerrufsrecht erlischt nicht mit dem Start, bei Widerruf wird zeitanteilig Wertersatz fällig.

Jede Zustimmung wird unverändert protokolliert (Dokument, Version, SHA-256, Anlass, Tarif, Intervall, Checkout-
Session). Ein Kauf ohne alle Pflicht-Zustimmungen ist serverseitig ausgeschlossen (Phase 8).

## 2. Technische Änderungen

| Bereich | Änderung |
|---|---|
| Migration `20260930090000_legal_operations.sql` | Dokumenttyp `imprint`; Tabellen `consumer_declarations` (Kündigungen/Widerrufe, Inhalt unveränderlich, 3 Jahre Aufbewahrung) und `system_mails` (E-Mail-Protokoll, Doppelversand ausgeschlossen); `subscriptions.renewal_reminder_sent_at`; Serverfunktionen nur für `service_role`; Admin-Funktionen nur Super-Admin; Veröffentlichen nur ohne `[Prüfhinweis]` |
| Edge Function `consumer-request` (neu, ohne JWT) | Kündigungs-/Widerrufsbutton: Erklärung speichern, per E-Mail-Adresse dem Konto zuordnen, ordentliche Kündigung **automatisch** bei Stripe zum Periodenende, Eingangsbestätigung an die Konto-Adresse, Hinweis an OLO Vision. Honeypot, max. 3 E-Mails je Adresse und Stunde, Antwort verrät nie, ob ein Konto existiert |
| Edge Function `mail-jobs` (neu, per `x-cron-secret`) | stündlich: fehlgeschlagene Vertragsbestätigungen nachholen (7 Tage), Erinnerung 14 Tage vor Ende privater Jahreslizenzen |
| `stripe-webhook` | Vertragsbestätigung nach dem Kauf (einmal je Session, mit allen akzeptierten Texten als Anhang, § 312f Abs. 2 BGB); private Jahreslizenz wird sofort auf „endet zum Periodenende“ gesetzt – auch nach einer Reaktivierung im Kundenportal; Hinweis an OLO Vision bei B2B-Kauf mit Rechnungsland ≠ DE |
| `create-checkout-session` | Steuersatz `STRIPE_TAX_RATE_ID` (19 %, inklusive) auf allen Rechnungen; Hinweistext direkt am Stripe-Button („Mit Klick auf „Abonnieren“ bestellst du … zahlungspflichtig …“); B2B nur mit Sitz in Deutschland (422 `b2b_country`) |
| E-Mail (`_shared/mailer.ts`, `smtpMailer.ts`) | austauschbarer Versand; heute SMTP (united-domains), später ein API-Dienst per Konfiguration. Ohne Konfiguration wird nichts versendet, aber alles weiter verarbeitet („skipped“ im Protokoll) |
| Frontend | `/impressum`, `/kuendigen` („Verträge hier kündigen“), `/widerrufen` („Vertrag widerrufen“) ohne Login, zweistufig mit Eingangsbestätigung; Fußzeile mit Rechtstexten und beiden Buttons (auch Lizenz-/Kontoseite, Benutzermenü); Preise mit „inkl. 19 % USt.“; private Jahreslizenz „/ 12 Monate – endet automatisch“; Bestelldialog mit Hinweis auf „Abonnieren“ bei Stripe; B2B-Hinweis bei Land ≠ DE; Admin-Reiter „Kündigungen & Widerrufe“; Vertragscenter zeigt offene Prüfhinweise |

## 3. Einrichtung (Reihenfolge)

### 3.1 Datenbank

Im Supabase **SQL Editor**, jeweils einzeln ausführen:

1. `supabase/migrations/20260929090000_service_role_grants.sql` (falls noch nicht geschehen)
2. `supabase/migrations/20260929120000_demo_billing_legal.sql` (falls noch nicht geschehen)
3. `supabase/migrations/20260930090000_legal_operations.sql`
4. `supabase/seed/legal_documents_v1_0_drafts.sql` – legt die 9 Entwürfe an (nichts wird veröffentlicht oder
   überschrieben; vorhandene Versionen 1.0 werden übersprungen und gemeldet).

### 3.2 Secrets (Supabase → Edge Functions → Secrets)

| Secret | Wert |
|---|---|
| `SMTP_HOST` | SMTP-Server von united-domains (laut united-domains-Hilfe bzw. Postfach-Einstellungen) |
| `SMTP_PORT` | `465` (SSL/TLS). Ports 25 und 587 sind in Supabase Edge Functions gesperrt |
| `SMTP_USER` | `info@olo-vision.de` |
| `SMTP_PASSWORD` | Passwort des Postfachs – **nur hier**, nie im Code, Git oder Frontend |
| `MAIL_FROM` | `OLO Vision <info@olo-vision.de>` |
| `MAIL_NOTIFY_TO` | optional, Standard `info@olo-vision.de` |
| `STRIPE_TAX_RATE_ID` | `txr_…` aus 3.4 |
| `CRON_SECRET` | zufällige Zeichenfolge, mind. 16 Zeichen (z. B. `openssl rand -hex 24`) |

### 3.3 Login-/Registrierungs-E-Mails über dasselbe Postfach

Supabase → **Authentication → Emails → SMTP Settings**: „Enable custom SMTP“, Host/Port 465/Benutzer/Passwort wie oben,
Absender `info@olo-vision.de`, Name `OLO Vision`. (Dafür ist kein Code nötig.)

### 3.4 Stripe (zuerst Testmodus, später Live; Menübezeichnungen im Dashboard können leicht abweichen)

1. **Steuersatz:** *Product catalog → Tax rates → New*: Anzeigename „USt.“, 19 %, **Inclusive**, Land Deutschland →
   ID `txr_…` als `STRIPE_TAX_RATE_ID`.
2. **Unternehmensdaten und Rechnungen:** *Settings → Business details*: OLO Vision, Anschrift, Support-E-Mail.
   *Settings → Billing → Invoices*: USt-IdNr. DE464512585 als Account Tax ID auf Rechnungen anzeigen.
3. **Kunden-E-Mails:** *Settings → Customer emails*: Zahlungsbelege/Rechnungen versenden aktivieren.
4. **Zahlungsarten:** *Settings → Payment methods*: Stripe zeigt im Abo-Checkout nur passende Arten. Für den
   Vertrieb in Deutschland sind Kakao Pay, Naver Pay, PAYCO, Pix und BLIK nicht sinnvoll – Deaktivieren empfohlen.
5. **Kundenportal:** Kündigung „at end of billing period“ an, Tarifwechsel aus (unverändert). Reaktiviert ein
   Privatkunde seine Jahreslizenz im Portal, setzt der Webhook sie wieder auf „endet zum Periodenende“.

### 3.5 Functions deployen

```bash
npm run supabase:deploy-functions   # jetzt alle fünf: checkout, portal, webhook, consumer-request, mail-jobs
```

### 3.6 Zeitplan für `mail-jobs` (SQL Editor, einmalig)

```sql
create extension if not exists pg_net;
select vault.create_secret('https://mqbxzilcdeuhiapyozny.supabase.co', 'olo_project_url');
select vault.create_secret('<DEIN CRON_SECRET>', 'olo_cron_secret');
select cron.schedule('olo-mail-jobs', '17 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'olo_project_url') || '/functions/v1/mail-jobs',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'olo_cron_secret')),
    body := '{}'::jsonb)
$$);
```

### 3.7 Rechtstexte prüfen und veröffentlichen

*Admin → Rechtliches*: Entwürfe öffnen, **Vorschau** prüfen, `[Prüfhinweis: …]` klären (ggf. mit Kanzlei), den
Hinweis aus dem Text entfernen, speichern, **Veröffentlichen**. Reihenfolge egal; solange ein Dokument fehlt, wird es
im jeweiligen Ablauf nicht abgefragt (Warnhinweis im Vertragscenter). Vor dem Verkauf an echte Kunden müssen alle 9
aktiv sein.

## 4. Laufender Betrieb

- **Kündigung über die Website:** Ordentliche Kündigungen mit zugeordnetem Abo werden automatisch bei Stripe zum
  Periodenende gesetzt; der Kunde erhält die Bestätigung mit Enddatum. Außerordentliche Kündigungen und Erklärungen
  ohne zuordenbares Abo stehen unter *Admin → Kündigungen & Widerrufe* als „Zu bearbeiten“.
- **Widerruf:** Stripe → Abo **sofort** beenden → Zahlung teilweise erstatten: Preis − Wertersatz
  (Preis ÷ Tage des Abrechnungszeitraums × Tage bis zum Eingang des Widerrufs) → im Admin-Bereich „Erledigt“.
- **Private Jahreslizenz:** endet automatisch nach 12 Monaten; Erinnerung 14 Tage vorher per E-Mail.
- **E-Mail-Protokoll:** `select created_at, kind, recipient, status, error from public.system_mails order by created_at desc;`
  Fehlgeschlagene Vertragsbestätigungen holt `mail-jobs` automatisch nach.
- **B2B außerhalb Deutschlands:** Registrierung möglich (Demo), Kauf gesperrt mit Verweis auf info@olo-vision.de.
  Gibt ein deutscher B2B-Kunde bei Stripe eine ausländische Rechnungsadresse an, erhältst du einen Hinweis.

## 5. Vor größerem Rollout anwaltlich prüfen lassen

Die folgenden Punkte sind im Text als `[Prüfhinweis]` markiert bzw. offen:

1. Einordnung als **digitale Dienstleistung** mit Wertersatz (§§ 356 Abs. 4, 357a Abs. 2 BGB) statt Erlöschen des
   Widerrufsrechts; Muster-Widerrufsbelehrung in der seit 19.06.2026 geltenden Fassung (Widerrufsfunktion § 356a BGB);
   Zulässigkeit der Erläuterung zur Wertersatz-Berechnung.
2. Ob die Bestellung vom **Verlangen des sofortigen Beginns** abhängig gemacht werden darf.
3. **Bestell-Button:** genügt Stripes „Abonnieren“ § 312j Abs. 3 BGB?
4. **Änderungsvorbehalt** für digitale Produkte (§ 327r BGB).
5. **Sperrung** bei Verstößen ohne Abmahnung (v. a. gegenüber Verbrauchern).
6. **B2B-Haftung:** Ausschluss der verschuldensunabhängigen Anfangshaftung; ob eine summenmäßige Höchstgrenze sinnvoll ist.
7. **Datenschutz-Rollen** bei Schulen/gemeinsamem Login; Bedarf für einen Auftragsverarbeitungsvertrag (AVV) mit B2B-Kunden.
8. **Drittlandübermittlung:** Data-Privacy-Framework-Zertifizierung bzw. Standardvertragsklauseln (Stripe, Supabase,
   Netlify); DPA von Supabase und Netlify abschließen/archivieren; AVV und genaue Firmierung von united-domains.
9. **Impressum:** zweiter unmittelbarer Kontaktweg (Telefon oder Kontaktformular) empfohlen.
10. Aufbewahrung von Zustimmungs-/Vertragsnachweisen nach Kontolöschung (heute bleibt der Nachweis, der Kontobezug entfällt).
11. **Steuer:** B2B-Verkauf ins EU-Ausland (Reverse Charge) und Verkauf an Verbraucher im EU-Ausland (OSS) mit dem
    Steuerberater klären – bis dahin B2B nur Deutschland.
12. **Barrierefreiheit (BFSG):** ob die Ausnahme für Kleinstunternehmen greift, sollte geprüft werden.

## 6. Tests

- `tests/db/legalops.test.ts` (PostgreSQL): Import der Entwürfe ohne Überschreiben, Prüfhinweis-Sperre, Impressum,
  Erklärungen (Zuordnung, Unveränderlichkeit, Rechte), Vertragsbestätigung (einmalig, mit Dokumenten), Erinnerung,
  End-to-End Handler + Webhook + Kündigung/Widerruf + Mail-Jobs + SMTP-Ausfall.
- `tests/legalops.unit.test.ts`: Preise Server = Browser, Hinweis am Stripe-Button, E-Mail-Texte und -Konfiguration,
  Rechtstexte (Pflichtangaben, Checkbox-Texte, Kernaussagen).
- `npm run test:edge`: `consumer-request` und `mail-jobs` im Deno-Runtime inkl. **echtem SMTP-Versand** über nodemailer
  gegen einen lokalen Test-SMTP-Server.
- `node tests/e2e/legal.e2e.mjs` (Mock): Fußzeile, Impressum, Preise, B2B-Land, Kauf Private jährlich, Kündigungs- und
  Widerrufsbutton, Admin, Prüfhinweise, Mobilansicht.
