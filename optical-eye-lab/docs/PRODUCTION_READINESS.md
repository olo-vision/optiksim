# OLO-LAB3D – Produktionscheck & Go-Live-Anleitung (Audit 0.10.x)

## 1. Einzuspielende Migrationen (Reihenfolge)

Die Migrationen 1–5 sind bekannt aus 0.9.

| # | Datei | Inhalt |
|---|---|---|
| 6 | `20261001090000_cloud_content_accounts.sql` | Cloud-Inhalte, Kontostatus, Löschung |
| 7 | `20261002090000_account_retention.sql` | Aufbewahrung geschlossener Konten, Erinnerung, Admin-Lebenszyklus |
| 8 | `20261003090000_production_hardening.sql` | siehe unten |
| 9 | `20261004090000_legal_publish_review_override.sql` | Vertragscenter: Prüfhinweise warnen statt hart zu blockieren (nur Super-Admin, mit Bestätigung, protokolliert) |

Inhalt von Migration 8:
- Geschlossene Konten sind serverseitig gesperrt (Lizenz und Demo).
- „Gekündigt“ gilt auch über `cancel_at`.
- Inhaltsgrenzen.
- Drosselung.
- Nachversand von Bestätigungen.
- Prüfung der Pflicht-Rechtstexte.
- Stripe-Ereignis „läuft gerade“.
- Ersetzen des Stripe-Kunden.
- Rechte.

Danach den Seed `supabase/seed/legal_documents_v1_0_drafts.sql` einspielen. Er überschreibt nichts.

## 2. Functions deployen

```
npm run supabase:deploy-functions
```

Das deployt `create-checkout-session`, `create-customer-portal`, `stripe-webhook`, `consumer-request`, `mail-jobs` und `delete-account`. Alle wurden in 0.10.x geändert.

## 3. Secrets (Supabase → Edge Functions)

| Secret | Pflicht | Hinweis |
|---|---|---|
| `STRIPE_SECRET_KEY` | ja | `sk_live_…` im Live-Betrieb; der Modus wird daraus erkannt |
| `STRIPE_WEBHOOK_SECRET` | ja | Secret des **Live**-Endpoints |
| `STRIPE_PRICE_PRIVATE`, `_BUSINESS`, `_EDUCATION` | live: ja | monatliche Live-Price-IDs |
| `STRIPE_PRICE_PRIVATE_YEARLY`, `_BUSINESS_YEARLY`, `_EDUCATION_YEARLY` | live: ja | jährliche Live-Price-IDs |
| `STRIPE_TAX_RATE_ID` | live: ja | `txr_…` – 19 % inklusive, im **Live**-Modus angelegt |
| `SITE_URL` | live: ja | `https://olo-lab.de`; der erste Eintrag muss `https://` sein |
| `STRIPE_PORTAL_CONFIGURATION_ID` | nein | sonst wird bei Bedarf automatisch eine Konfiguration angelegt |
| `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_NOTIFY_TO` | ja | E-Mails; ohne SMTP werden geschlossene Konten **nie** automatisch gelöscht |
| `CRON_SECRET` | ja | stündlicher Aufruf von `mail-jobs` |
| `ACCOUNT_AUTO_DELETE` | nein | `off` schaltet Erinnerung und automatische Löschung geschlossener Konten ab |

**Fail closed im Live-Modus:**
- Fehlt eine Price ID, der Steuersatz oder die https-Adresse, antwortet der Checkout mit 503. Das Log nennt, was fehlt.
- Die eingebauten Test-Price-IDs werden live nie verwendet.
- Sind die Pflicht-Rechtstexte nicht **veröffentlicht**, antwortet der Checkout mit 503 (`legal_not_published`).
- Webhook-Ereignisse aus dem anderen Stripe-Modus werden ignoriert.

## 4. Umstellung von Test auf Live

**Achtung, das löscht Testdaten.** Bitte nur bewusst ausführen und vorher sichern. Es ist nicht Teil der Migrationen.

Testkunden und Test-Abos aus dem Testbetrieb würden im Live-Modus stören:
- **Kunden:** Ein gespeicherter Testkunde wird beim nächsten Checkout automatisch ersetzt. Im Portal erscheint dafür eine klare Meldung.
- **Test-Abos:** Sie blockieren als „laufendes Abo“ einen Kauf in der Datenbank.

Nach dem Umstellen deshalb im SQL-Editor prüfen:

```sql
-- Übersicht: Abos/Kunden aus dem Testbetrieb
select s.stripe_subscription_id, s.status, i.name from public.subscriptions s join public.institutions i on i.id = s.institution_id;
select * from public.billing_customers;
```

Reine Testkonten löschen Sie über die Kontolöschung. Einzelne Test-Abos von echten Konten entfernen Sie nach Rücksprache gezielt:

```sql
delete from public.subscriptions where stripe_subscription_id = 'sub_…';
select public.sync_license_for_institution('<institution-uuid>', 'go-live');
```

## 5. Stripe-Dashboard (Live)

1. Produkte und Preise (6 Price IDs) im Live-Modus anlegen und als Secrets eintragen.
2. Steuersatz 19 % inklusive anlegen und als `STRIPE_TAX_RATE_ID` eintragen.
3. Webhook-Endpoint `https://<projekt>.supabase.co/functions/v1/stripe-webhook` mit diesen Ereignissen anlegen:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Kundenportal (Einstellungen → Billing → Customer Portal) im **Live**-Modus einmal speichern. Rechnungen, Zahlungsmethode und Kündigung zum Periodenende aktivieren, Tarifwechsel deaktivieren.
5. Rechnungseinstellungen: Firmenname, Anschrift, USt-IdNr., Rechnungs-E-Mails an Kunden.
6. Test-Kauf mit echter Karte und kleinem Betrag bzw. einem 100-%-Gutschein, danach erstatten.

## 6. Supabase

- **Auth → SMTP:** united-domains eintragen, sonst gilt das Supabase-Limit für Auth-E-Mails.
- **Auth → URL-Konfiguration:**
  - Site URL `https://olo-lab.de`
  - Redirect-URLs: `https://olo-lab.de/**` (deckt `/login`, `/reset-password` und `/account?email_changed=1` ab; eine
    Angabe ohne Platzhalter wie `https://olo-lab.de/account` passt **nicht** auf `/account?email_changed=1`)
- **Auth-E-Mail-Vorlagen:** auf Deutsch und in der „Sie“-Form anpassen (Bestätigung, Passwort, E-Mail-Änderung).
- **E-Mail-Adresse ändern** (Details: `docs/CLOUD_ACCOUNT.md` Abschnitt 8):
  - Auth → Providers → Email: „Confirm email“ **an** (sonst ändert Supabase die Adresse sofort und versendet nichts).
  - „Secure email change“ an (empfohlen; Bestätigung über die bisherige und die neue Adresse). Wird es ausgeschaltet,
    beim Frontend-Build `VITE_SECURE_EMAIL_CHANGE=off` setzen, damit die Hinweistexte stimmen.
  - Auth → SMTP: eigener Mailserver (united-domains). Der eingebaute Supabase-Mailer versendet nur an Adressen des
    Projekt-Teams und nur wenige Mails pro Stunde.
  - Auth → Rate Limits: „Rate limit for sending emails“ ausreichend hoch (z. B. 30/h).
  - Auth → Emails → „Change Email Address“: Vorlage mit `{{ .ConfirmationURL }}`.
  - Prüfen: Auth → Logs nach `/user` bzw. `mail.send` filtern; in `auth.users` müssen `email_change` und
    `email_change_sent_at` nach einer Anforderung gesetzt sein.
- **Cron `olo-mail-jobs`:** stündlich (siehe `docs/LEGAL_OPERATIONS.md` 3.6). Er verarbeitet jetzt auch die Erinnerung und Löschung geschlossener Konten und den Nachversand von Kündigungs- und Widerrufsbestätigungen.

## 7. Was die Härtung behebt (Kurzfassung)

Die Details stehen im Abschlussbericht.

- Geschlossene Konten konnten Demo starten und kaufen. Jetzt ist beides serverseitig gesperrt, und die Oberfläche zeigt einen Hinweis.
- Test-Price-IDs konnten im Live-Betrieb verwendet werden. Jetzt ist das ausgeschlossen (fail closed).
- Kontowechsel im selben Browser: Beim Anmelden eines zweiten Kontos konnten Inhalte ins falsche Konto geschrieben werden. Jeder Schreibzugriff prüft jetzt die Sitzung.
- Abmelden wirkte auf allen Geräten. Jetzt gilt es nur für dieses Gerät.
- Kündigungsbutton:
  - Drosselung je IP und insgesamt.
  - Die automatische Kündigung bei Stripe gilt nur für den Kontoinhaber.
  - Steuerzeichen werden entfernt.
  - Bestätigungen werden nachversendet.
- Webhook:
  - Parallele Zustellung wird korrekt wiederholt.
  - Unbekannte Abos werden nicht 3 Tage lang wiederholt.
  - Der Stand wird nach dem Anwenden erneut geprüft.
  - Doppelabos werden gemeldet.
- Doppelte Checkout-Sessions aus zwei Tabs werden geschlossen.
- Der Stripe-Aufruf hat ein Zeitlimit und eine Wiederholung.
- Kontolöschung:
  - Die Frische der Anmeldung wird über `amr` geprüft; ein Token-Refresh zählt nicht als frische Anmeldung.
  - Laufende Abos werden zusätzlich direkt bei Stripe geprüft.
- Sitzungsablauf:
  - Der Entwurf wird gesichert, und die Anmeldeseite zeigt einen Hinweis.
  - Rohe technische Fehlermeldungen erscheinen nicht mehr.
- Offline: Beim Start erscheint „Keine Verbindung“ statt der Anmeldeseite. Beim Speichern wird nach dem Wiederverbinden automatisch erneut gespeichert. Ein Modul lässt sich auch offline verlassen, der Stand bleibt als Entwurf.
- Performance:
  - Der Simulator wird erst bei Bedarf geladen. Das Start-Bundle ist von 605 auf 258 kB (gzip) geschrumpft.
  - Die Bibliothek wird nicht mehr nach jedem Speichern komplett neu geladen.
  - Vorschaubilder werden nur einmal angefragt.
  - Einstellungen werden nur bei Änderung gesendet.
  - Der Server-Check ist gedrosselt.
