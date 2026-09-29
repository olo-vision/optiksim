# OLO-LAB3D – Phase 8: Demo, Jahrespreise, B2C/B2B, Rechtstexte & Vertragscenter

> Fortsetzung: Rechtstexte 1.0, Kündigungs-/Widerrufsbutton, Vertragsbestätigung, USt. → [LEGAL_OPERATIONS.md](LEGAL_OPERATIONS.md)

Baut auf Phase 6 (Supabase-Auth) und Phase 7/7.1 (Stripe-Abos) auf. Bestehende Checkout-, Webhook-, Portal- und
Login-Abläufe bleiben unverändert; neu sind nur zusätzliche Parameter und Prüfungen.

## 1. Überblick

| Bereich | Umsetzung |
|---|---|
| **Demo** | 2 Stunden, voller Funktionsumfang, 0 €, ohne Stripe. Einmal je Benutzer **und** je Kundenkonto (`demo_grants`, eindeutige Schlüssel). Start nur über RPC `start_demo`; Ende = `licenses.valid_until` (Serverzeit). Nach Ablauf **nie** automatisch ein Abo. |
| **Jahrespreise** | 199 € / 399 € / 999 € pro Jahr, eigene Stripe-Preise. Umschalter *Monatlich \| Jährlich*. Monatspreise und -IDs unverändert. |
| **Preis-Whitelist** | Client sendet nur `plan` + `interval`. Server wählt die Price ID aus `private_monthly … education_yearly`. Eine `price_id` vom Client wird nie gelesen. |
| **B2C / B2B** | Privat = B2C; Unternehmen/Bildungseinrichtung = B2B (`institutions.type`). B2B: Rechnungsanschrift Pflicht, USt-IdNr./Position optional; Stripe verlangt zusätzlich Rechnungsadresse und bietet USt-IdNr.-Erfassung. |
| **Rechtstexte** | Versioniert in `legal_documents` (Entwurf → aktiv → archiviert). Genau **eine** aktive Version je Typ + Zielgruppe. Veröffentlichte Versionen sind unveränderlich (Trigger), alte bleiben abrufbar. |
| **Zustimmungen** | `legal_consents`: nur einfügen, nie ändern/löschen (Trigger). Speichert Dokument-ID, Typ, **Version**, Zielgruppe, SHA-256 des Inhalts, Anlass (Registrierung/Demo/Kauf), Paket, Intervall, Checkout-Session. |
| **Vertragscenter** | `/admin/legal` – nur Super-Admin (RPCs prüfen die Rolle serverseitig). |
| **Lizenzstatus** | Zentral in `my_billing_status()` (+ `has_access`, `server_now`, Demo-Felder). Browser rechnet mit Serverzeit + monotoner Uhr. |

## 2. Ablauf

```
Landingpage / Tarife
  └─ Paket + Intervall wählen (oder „Demo starten“)
       └─ Konto erstellen (/register?plan=…&interval=…)
            ├─ Kundentyp: Privatperson (B2C) | Unternehmen / Bildungseinrichtung (B2B)
            ├─ B2B: Firma/Einrichtung, Name, E-Mail, Rechnungsanschrift, Land, USt-IdNr. (opt.), Position (opt.)
            └─ Zustimmungen „Registrierung“: Datenschutz, Lizenzbedingungen  → Trigger prüft + protokolliert
       └─ /license?plan=…
            ├─ Paket → Dialog „Bestellung prüfen“ → Zustimmungen „Kauf“ → Stripe Checkout
            │     └─ Rückkehr → „Zahlung wird bestätigt …“ → Webhook → „Willkommen … Lizenz aktiv“ → Start
            └─ Demo → (offene Zustimmungen „Demo“) → start_demo → Dashboard mit Timer
  └─ Kurz-Onboarding im Dashboard: Willkommen · Navigation · Anwendung starten
```

Die Paketwahl übersteht Registrierung, E-Mail-Bestätigung und Login (URL + 24 h im `localStorage`). Das ist
reiner Komfort: Preis, Tarifregel, Zustimmungen und Freischaltung prüft ausschließlich der Server.

## 3. Pflicht-Dokumente je Ablauf

Die **einzige** Regel steht in `public.legal_required_documents(context, customer_type)`. Frontend, Trigger und
Edge Function fragen nur diese Funktion ab.

| Anlass | B2C (Privat) | B2B (Unternehmen / Bildung) |
|---|---|---|
| Registrierung | Datenschutz, Lizenzbedingungen | Datenschutz, Lizenzbedingungen |
| Demo | Datenschutz, Lizenzbedingungen (bereits bei der Registrierung zugestimmt → keine erneute Abfrage) | wie B2C |
| Kauf | AGB, Datenschutz, Widerrufsbelehrung, Lizenzbedingungen, Zustimmung sofortige Ausführung, Kenntnisnahme Erlöschen des Widerrufsrechts; Muster-Widerrufsformular nur als Link | AGB, B2B-Bedingungen, Datenschutz, Lizenzbedingungen |

- Zielgruppe `b2c`/`b2b` schlägt `all`, falls für denselben Typ beides aktiv ist.
- **Nicht veröffentlichte** Dokumente werden nicht abgefragt (Hinweis „Noch nicht veröffentlicht“ im Vertragscenter).
  Vor dem Live-Betrieb müssen alle Texte aktiv sein.
- Beim Kauf prüft die Edge Function **vor** jedem Stripe-Aufruf, ob genau die aktuell aktiven Versionen bestätigt wurden
  (`422 consents_missing`, `409 consents_outdated`). Nach dem Anlegen der Session werden die Zustimmungen mit der
  Session-ID protokolliert; schlägt das fehl, wird die Session sofort bei Stripe beendet (`expire`) → kein Kauf ohne Nachweis.
- Checkbox-Texte kommen aus dem Vertragscenter (Feld „Text der Checkbox“, `{link}` = verlinkter Titel). Im Code stehen
  nur neutrale Oberflächen-Vorlagen – **keine Rechtstexte**.

## 4. Demo – Regeln

- Start: `start_demo(consent_ids)` (nur Administration des Kundenkontos). Fehler: `OLD01` bereits genutzt, `OLD02` Lizenz/Abo vorhanden, `OLD03` keine Berechtigung, `OLC01/02` Zustimmungen.
- Sperre gilt je Benutzer **und** je Kundenkonto, in der Datenbank. Abmelden, anderer Browser/Gerät, Cookies oder `localStorage` ändern nichts.
- Zugriff endet exakt bei `valid_until` (`has_active_license()` vergleicht mit `now()` der Datenbank). Der Job `olo-expire-demos` (alle 5 min) setzt danach nur noch den Status auf `expired`.
- Browser: Timer „Demo – verbleibende Zeit: hh:mm:ss“ (nur Anzeige, Serverzeit). Nach Ablauf → `/license?demo=ended` mit „Deine OLO-LAB Demo ist beendet.“; spätere Logins landen auf der Paketseite.
- Kauf während der Demo: Der Webhook übernimmt die Lizenz als Stripe-Lizenz (`sync_license_for_institution`), `demo_grants.converted_at` wird gesetzt.

## 5. Datenmodell (Migration `20260929120000_demo_billing_legal.sql`)

Neue Tabellen: `demo_grants`, `legal_documents`, `legal_consents`.
Neue Felder: `institutions.vat_id`, `institutions.contact_position`, `subscriptions.billing_interval`,
`subscriptions.checkout_session_id`, `plan_catalog.yearly_price_cents`; Enum `license_source` + `demo`.

Rechte: Die API-Rollen haben auf die neuen Tabellen **keine** direkten Rechte außer `SELECT` auf die eigenen
Zustimmungen. Alles andere läuft über `security definer`-Funktionen mit Rollenprüfung. Der Service-Role-Zugriff der
Edge Function beschränkt sich auf `checkout_consent_check` und `record_checkout_consents`.

## 6. Manuelle Schritte

1. **Migrationen** im SQL-Editor, in dieser Reihenfolge (falls noch nicht geschehen):
   `20260929090000_service_role_grants.sql` (7.1), dann `20260929120000_demo_billing_legal.sql`.
2. **Edge Functions neu deployen:** `npm run supabase:deploy-functions` (alle drei).
3. **Secrets:** keine neuen Pflicht-Secrets. Optional `STRIPE_PRICE_PRIVATE_YEARLY`, `STRIPE_PRICE_BUSINESS_YEARLY`,
   `STRIPE_PRICE_EDUCATION_YEARLY`, nur für abweichende Jahres-IDs (z. B. Live-Modus).
4. **Stripe:** Die drei Jahrespreise müssen im selben Modus wie der Secret Key existieren (recurring, interval = year):
   - Private `price_1UKwPqDi0mx4WWPo6wJiRryZ`
   - Business `price_1UKwPZDi0mx4WWPoWV5rgRuI`
   - Education `price_1UKwP0Di0mx4WWPoJiOu2iDW`

   Webhook-Ereignisse unverändert. Im Customer Portal **Tarifwechsel aus** lassen. Unter *Settings → Tax* ggf.
   Steuererhebung und im Portal „Customer information“ (Adresse, USt-IdNr.) aktivieren.
5. **Vertragscenter befüllen** (als Super-Admin unter *Admin → Rechtstexte*): AGB, Datenschutzerklärung,
   Widerrufsbelehrung (B2C), Muster-Widerrufsformular (B2C), Lizenzbedingungen, B2B-Bedingungen (B2B),
   Zustimmung zur sofortigen Ausführung (B2C) und Kenntnisnahme zum Erlöschen des Widerrufsrechts (B2C).
   Je Dokument: Entwurf → Vorschau → Veröffentlichen.
6. Prüfen, dass `olo-expire-demos` angelegt ist: `select jobname, schedule from cron.job;`

## 7. Tests

- `npm test`: u. a. `tests/db/phase8.test.ts` (PGlite: Versionierung, Unveränderlichkeit, Zustimmungen, Demo, Admin-Rechte, Checkout-Handler + Webhook End-to-End), `tests/phase8.unit.test.ts` (Demo-Zustände, Serveruhr, Preise, Paketwahl, Markdown, Mock-Abläufe), `tests/stripe.handlers.test.ts` (Whitelist, Intervall, Zustimmungsprüfung vor Stripe, Session-Abbruch).
- `npm run test:edge`: Edge Functions im Deno-Runtime (Auth, Admin-Client, Signaturen).
- `node tests/e2e/phase8.e2e.mjs` (mit `npm run dev:e2e-cloud`): Paketauswahl, B2B-Kauf jährlich, Demo bis Ablauf, Vertragscenter, Zustimmungsprotokoll, Mobilansicht.

### Manuell (Stripe-Testmodus)

1. Ohne Konto: *Tarife* → *Jährlich* → Business → registrieren (B2B) → Dialog → Stripe (`4242 4242 4242 4242`) → Bestätigung → Start.
2. Konto → Abrechnung „Jährlich“; Admin → Intervall, Zustimmungen (Version + `cs_…`).
3. Privatkonto → Demo → Timer → in SQL `update licenses set valid_until = now() + interval '1 minute' where source = 'demo';` → nach Ablauf Seite „Demo beendet“, erneuter Start verweigert, kein Abo in Stripe.
4. Neue Version eines Rechtstexts veröffentlichen, während der Kauf-Dialog offen ist → Hinweis „Die Rechtstexte wurden inzwischen aktualisiert …“, erneute Bestätigung nötig.
5. Kauf abbrechen, Browser während der Zahlung schließen und später anmelden → Lizenz aktiv, sobald der Webhook da war.

## 8. Bekannte Grenzen / offene Punkte

- **Rechtliche Prüfung nötig:** Preisangaben (brutto/netto, „inkl. MwSt.“ für B2C), Button-Beschriftung nach § 312j BGB auf der Stripe-Seite, alle Texte und Checkbox-Formulierungen.
- `legal_consents.user_id` wird beim Löschen eines Kontos auf `NULL` gesetzt (E-Mail/Institution bleiben im Snapshot) – Aufbewahrung vs. Löschpflicht mit Datenschutz klären.
- Die Demo-Sperre gilt je Konto; mit einer neuen E-Mail-Adresse – oder nach Löschen des Kontos – entsteht ein neues Konto mit neuer Demo (keine Geräte-/IP-Erkennung).
- „Gültig ab“ kann nicht in der Zukunft liegen (Veröffentlichung am Stichtag).
- Nach Phase 8 ist nur die neueste Migration wiederholbar ausführbar.
