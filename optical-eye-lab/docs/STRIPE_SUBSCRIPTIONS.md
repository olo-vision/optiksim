# OLO-LAB3D – Stripe Payments & Subscription Management (Phase 7)

Stand: 0.7.1 (Erweiterung in 0.8.0: Jahrespreise, Zustimmungen im Checkout, Demo → [PHASE8_DEMO_LEGAL.md](PHASE8_DEMO_LEGAL.md)) · Stripe API-Version `2026-08-26.dahlia` (fest in den Edge Functions) · zuerst nur im **Testmodus**

Baut auf der SaaS-Grundstruktur auf ([SAAS_AUTH_FOUNDATION.md](SAAS_AUTH_FOUNDATION.md)). Weiterverwendet werden:

- Auth, Institutionen, Profile, Lizenzen, `subscriptions`, Pricing- und Admin-Seite
- die drei vorbereiteten Edge Functions: fachlich korrigiert, nicht neu parallel angelegt

---

## 1. Ablauf

```
Registrierung ─▶ /license oder /pricing: Tarif wählen („Jetzt buchen“)
   │                     Frontend sendet NUR { plan: 'private' | 'business' | 'education' }
   ▼
create-checkout-session (Edge Function, Benutzer-JWT)
   • Benutzer prüfen, Profil + Institution laden, Tarif validieren
   • Tarifregel: Tarif muss zum Kontotyp passen
   • Price ID serverseitig bestimmen
   • Stripe Customer der Institution wiederverwenden oder einmalig anlegen (billing_customers)
   • kein zweites Abo (Prüfung in der DB UND bei Stripe)
   • Checkout Session (mode=subscription, Metadaten institution_id/plan) → URL
   ▼
Stripe Checkout (Zahlung)
   ├─ Abbruch ─▶ /pricing?checkout=cancelled   („Bezahlvorgang abgebrochen – nichts berechnet“)
   └─ Erfolg  ─▶ /license?checkout=success    „Zahlung wird bestätigt …“
                  Die App lädt den Status gedrosselt neu (1,5 s … 18 s, max. ~1 min),
                  danach „Erneut prüfen“. Der URL-Parameter selbst schaltet nichts frei.
   ▼
stripe-webhook (ohne JWT, aber mit Stripe-Signatur)
   • Signatur prüfen → Ereignis einmalig verarbeiten (stripe_events)
   • Abo FRISCH von Stripe laden → apply_stripe_subscription()
       → subscriptions aktualisieren → Lizenz ableiten (active …) → Audit-Log
   ▼
Simulator frei (accessState = active) – erst jetzt
```

---

## 2. Dateien

| Datei | Inhalt |
|---|---|
| `supabase/migrations/20260928200000_stripe_subscriptions.sql` | **neue** Migration (Phase-6-Migration unverändert), idempotent |
| `supabase/functions/_shared/handlers.ts` | Fachlogik aller drei Functions (testbar, ohne Deno-APIs) |
| `supabase/functions/_shared/stripeConfig.ts` | API-Version, Tarif ↔ Price ID, Tarifregel, erlaubte Basis-URLs/CORS |
| `supabase/functions/_shared/stripeSignature.ts` | Signaturprüfung (HMAC-SHA256, Zeitfenster 5 min, Vergleich in konstanter Zeit) |
| `supabase/functions/_shared/stripeObjects.ts` | Abo-/Rechnungsfelder für aktuelle und ältere API-Versionen |
| `supabase/functions/_shared/deps.ts` | Identitätsprüfung (JWT) + separater Admin-Client (`@supabase/server`, Secret Key) + Stripe-REST mit fester API-Version |
| `supabase/functions/_shared/supabaseKeys.ts` | Auswahl der Schlüssel aus `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` (Legacy-Rückfall), Schutz vor falschen Schlüsseln |
| `supabase/functions/*/deno.json` | Abhängigkeiten je Function (gepinnt: `@supabase/supabase-js@2.117.1`, `@supabase/server@1.8.0`) |
| `supabase/migrations/20260929090000_service_role_grants.sql` | ausdrückliche Tabellenrechte für `service_role` (Phase 7.1) |
| `supabase/functions/_shared/licenseStatus.ts` | Status-Konstanten, TS-Spiegel der Lizenzregeln |
| `supabase/functions/{create-checkout-session,create-customer-portal,stripe-webhook}/index.ts` | Einstiegspunkte |
| `supabase/config.toml` | `verify_jwt = false` nur für `stripe-webhook` |
| `supabase/functions/.env.example` | Platzhalter für lokale Function-Secrets |
| Frontend | `src/cloud/*` (Typen, Zugang, Hinweise, Backends), `src/app/pages/cloud/Billing.tsx`, `PlanCards.tsx`, `AccountPages.tsx`, Banner in `AppLayout.tsx` |

---

## 3. Datenmodell (neue Migration)

| Objekt | Zweck |
|---|---|
| `licenses.source` (`stripe` \| `manual`) | Manuelle Sonderlizenzen schützt der Webhook. Bestehende, in Phase 6 manuell freigeschaltete Lizenzen werden beim ersten Einspielen als `manual` markiert. |
| `licenses.grace_period_until` | Frist nach fehlgeschlagener Zahlung |
| `subscriptions.plan / cancel_at / canceled_at / ended_at / stripe_created_at / last_event_*` | vollständiger Abo-Stand + letztes Ereignis |
| `billing_customers` (`institution_id` PK, `stripe_customer_id` UNIQUE) | **genau ein** Stripe Customer pro Institution und umgekehrt |
| `stripe_events` (`id` = `evt_…`) | Idempotenz: jedes Ereignis wird höchstens einmal erfolgreich verarbeitet |
| `apply_stripe_subscription(jsonb)` | einzige Schreibstelle für Stripe-Daten (nur `service_role`) |
| `sync_license_for_institution(uuid, text)` | leitet die Lizenz aus dem aktuellen Abo ab |
| `expire_grace_periods()` | nach Fristende: `past_due` → `suspended`; stündlich per `pg_cron` |
| `stripe_event_begin/finish` | Idempotenz-Helfer (nur `service_role`) |
| `my_billing_status()` | Abo-Übersicht der eigenen Institution **ohne** Stripe-IDs |
| `admin_list_accounts()` | erweitert (Quelle, Frist, Abostatus, Price, Periodenende, Kündigung) |
| `admin_set_license_status()` | macht die Lizenz zur Sonderlizenz (`source = manual`) |
| `admin_set_license_source()` | Lizenz wieder an Stripe übergeben (übernimmt sofort den Abo-Status) |
| `has_active_license()` | berücksichtigt die Frist |

### Lizenzregeln (nur `source = 'stripe'`)

| Stripe-Abo | Lizenz | Zugriff |
|---|---|---|
| `active`, `trialing` | `active`; Frist gelöscht | ja |
| `active` + Kündigung zum Periodenende (`cancel_at_period_end` oder `cancel_at`) | `active`, `valid_until` = Periodenende | ja, bis zum Periodenende („Gekündigt – Zugriff bis …“) |
| `past_due` (Zahlung fehlgeschlagen) | `past_due`, `grace_period_until` = erste Fehlzahlung + **7 Tage** (weitere Fehlversuche verlängern nicht) | ja, mit deutlichem Hinweis |
| `past_due` nach Fristende | `suspended` | nein |
| `unpaid`, `paused` | `suspended` | nein |
| `canceled` (Abo tatsächlich beendet) | `cancelled`, `valid_until` = Endzeitpunkt | nein |
| `incomplete`, `incomplete_expired` | unverändert (neue Konten bleiben `pending`) | nein |

- **Mehrere Abos einer Institution:** Maßgeblich ist das laufende, sonst das neueste. Ein verspätetes Ereignis eines alten Abos überschreibt ein neues nicht.
- **`expired`** bleibt für manuell vergebene Lizenzen mit Ablaufdatum bzw. den Admin reserviert.

### Grace Period

1. `invoice.payment_failed`:
   - Der Webhook lädt Abo **und Rechnung** frisch von Stripe.
   - Ist die Rechnung weiterhin `open`, gilt das Abo mindestens als `past_due`.
   - Lizenz → `past_due`, Frist = jetzt + 7 Tage.
2. Während der Frist bleibt der Simulator nutzbar. Hinweise erscheinen im Banner oben in der App, auf `/license` und auf `/account`:
   - „Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisiere dein Zahlungsmittel bis TT.MM.JJJJ …“
   - dazu der Button **Abonnement verwalten**
3. Nach Fristende:
   - Die Zugriffsprüfung sperrt sofort, auch ohne Job (Frontend `accessState`, DB `has_active_license`).
   - Der Job `expire_grace_periods()` setzt den Status auf `suspended`.
4. Spätere erfolgreiche Zahlung (`invoice.paid`): Lizenz → `active`, Frist gelöscht.
5. Stripe selbst wiederholt die Abbuchung (Smart Retries) und beendet das Abo nach seinen Einstellungen (*Billing → Revenue recovery*). Die 7-Tage-Frist ist davon unabhängig.

---

## 4. Webhook-Ereignisse

**Pflicht** (im Stripe-Dashboard auswählen):

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

**Empfohlen** (werden ebenfalls verarbeitet):

- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed` (z. B. für SEPA-Lastschrift)
- `customer.subscription.paused`
- `customer.subscription.resumed`

Hinweise zur API-Version:

- Seit `2025-03-31.basil` liegen `current_period_start/end` an den **Subscription Items** (`items.data[]`), nicht mehr am Abo.
- Die Abo-ID einer Rechnung steht unter `invoice.parent.subscription_details.subscription`, nicht mehr unter `invoice.subscription`.
- Der Code liest beide Formen. Er verlässt sich ohnehin nicht auf die Ereignis-Nutzlast, sondern lädt Abo und Rechnung mit fester Version `2026-08-26.dahlia` neu. So sind Reihenfolge, Alter und Versionsformat der Ereignisse unerheblich; Stripe garantiert keine Reihenfolge.

Antworten des Webhooks:

| Status | Bedeutung |
|---|---|
| `400` | Signatur ungültig, fehlt oder ist älter als 5 Minuten |
| `200` + `duplicate` | Ereignis wurde bereits verarbeitet |
| `200` + `ignored` | nicht benötigtes Ereignis, oder Abo ohne Bezug zu einer Institution (z. B. im Dashboard angelegt) |
| `500` | Verarbeitungsfehler. Stripe wiederholt; das Ereignis wird dann erneut verarbeitet. |

---

## 5. Sicherheit

### Supabase-Clients in den Edge Functions (Phase 7.1)

Ablauf je Anfrage in Checkout und Portal:

1. **Identität:** Der Benutzer-JWT aus `Authorization: Bearer …` wird geprüft.
   - zuerst lokal gegen die JWKS des Projekts (`verifyCredentials`, Modus `user`, aus `@supabase/server`)
   - Rückfall für ältere HS256-Token: der Auth-Server (`auth.getUser`) über einen reinen Identitäts-Client mit dem Publishable Key, der **nie** für Datenbankzugriffe genutzt wird
   - Ergebnis ist nur die User-ID (+ E-Mail). API-Schlüssel (`sb_…`) werden nicht als Benutzer-Token akzeptiert.
2. **Datenbank:** ausschließlich über einen **separaten Admin-Client**.
   - Erzeugt mit `createAdminClient()` aus `@supabase/server` und dem Secret Key aus `SUPABASE_SECRET_KEYS`, je Anfrage neu.
   - Er entfernt `Authorization`/`apikey` aus den Client-Optionen; der Benutzer-JWT kann ihn nicht überschreiben.
   - Profil, Institution, Lizenz, Abo und Stripe-Kunde werden über die geprüfte User-ID gelesen, nie aus dem Request.
3. **Schlüssel-Rückfall:** Nur wenn `SUPABASE_SECRET_KEYS` fehlt, wird ein legacy `SUPABASE_SERVICE_ROLE_KEY` genutzt (geprüft auf Rolle `service_role`). Ein Publishable/Anon-Key als Server-Schlüssel wird abgelehnt.

Der Webhook braucht keinen Benutzer-JWT. Er prüft die Stripe-Signatur und nutzt denselben Admin-Client.

**Tabellenrechte.** Supabase gibt neue Tabellen seit 30.05.2026 (neue Projekte; alle Projekte ab 30.10.2026) nicht mehr automatisch an `anon`/`authenticated`/`service_role` frei. `service_role` umgeht zwar RLS, braucht aber trotzdem GRANTs. Genau das war die Ursache von `permission denied for table profiles`.

- Die Migration `20260929090000_service_role_grants.sql` vergibt nur, was die Functions direkt brauchen:
  - Lesen: `profiles`, `institutions`, `licenses`, `subscriptions`, `plan_catalog`
  - Lesen + Einfügen: `billing_customers`
- Alle Änderungen an Abo und Lizenz laufen über die SECURITY-DEFINER-Funktionen.
- Die Rechte von `anon`/`authenticated` und die RLS-Policies bleiben unverändert; die Tests prüfen das unter beiden Standardrechte-Varianten.

| Anforderung | Umsetzung |
|---|---|
| Stripe Secret Key nie im Browser | nur `STRIPE_SECRET_KEY` als Function Secret. Das Frontend enthält keine Stripe-Werte, auch keine Price IDs (Build geprüft). |
| Webhook-Signatur zwingend | `verifyStripeSignature` (HMAC-SHA256, 5-Minuten-Fenster, mehrere `v1` bei Secret-Rotation, Vergleich in konstanter Zeit). Ohne Secret antwortet der Webhook mit 503. |
| Price IDs nicht vom Client bestimmbar | Client sendet nur den Tarif; `priceIdForPlan()` bildet serverseitig ab. `price`, `customer`, `institution_id`, `success_url` im Body werden ignoriert (getestet). |
| Tarif passend zum Kontotyp | serverseitig (422) und in der Oberfläche; siehe Abschnitt 6 |
| Keine fremde Stripe Customer ID | Customer nur aus `billing_customers` der eigenen Institution. Der Webhook ordnet über den Customer zu; widersprechende Metadaten werden abgelehnt (getestet). |
| Subscriptiondaten und Lizenz nicht manipulierbar | keine Schreibrechte für `anon`/`authenticated`: keine Policies, Guard-Trigger, Funktionen nur für `service_role` (getestet) |
| RLS | `billing_customers`, `stripe_events`: RLS an, keine Policies. `my_billing_status()` liefert nur die eigene Institution ohne IDs. |
| Service Role nur serverseitig | nur in `_shared/deps.ts`. Das Frontend lehnt `service_role`/`sb_secret_` weiterhin ab (Phase 6). |
| Keine Secrets in Logs | Logs enthalten nur Fehlermeldungen (Stripe-Fehlertyp/-code), keine Payloads, Tokens oder Schlüssel |
| Keine offenen Admin-Endpunkte | Admin nur über `admin_*`-RPCs mit `is_super_admin()`; keine Admin-Edge-Function |
| Doppelte Abos | Checkout prüft laufende Abos in der Datenbank **und** bei Stripe; Idempotenz-Schlüssel für Customer und Checkout Session |
| CORS/Weiterleitungen | nur Basis-URLs aus `SITE_URL`; fremde `Origin` erhält die konfigurierte URL |

---

## 6. Tarifregel

Buchbar ist **nur der Tarif, der zum Kontotyp aus der Registrierung passt**:

| Kontotyp | Tarif |
|---|---|
| Privatkonto | Private |
| Betrieb | Business |
| Bildungseinrichtung | Education |

- Der passende Tarif ist markiert („Passend zu deinem Konto“). Die anderen zeigen „Nur für Privatkonten / Betriebe / Bildungseinrichtungen“.
- So erhält etwa eine Schule nicht versehentlich den Privattarif.
- Bei falschem Kontotyp hilft der Support/Admin.
- Wichtig: Im Customer Portal den **Tarifwechsel deaktiviert** lassen (Abschnitt 7.6), sonst ließe sich die Regel dort umgehen.

---

## 7. Manuelle Schritte (Stripe Testmodus + Supabase)

Keine echten Werte in Git oder Frontend. Die Stripe-Werte kommen ausschließlich in die Supabase Function Secrets.

### 7.0 Migration einspielen

**Variante A: SQL-Editor** (empfohlen, wenn Phase 6 per SQL-Editor eingespielt wurde)

- Supabase → *SQL Editor* → Inhalt von `supabase/migrations/20260928200000_stripe_subscriptions.sql` einfügen → **Run**.
- Die Datei ist wiederholbar.

**Variante B: CLI**

```bash
npx supabase login
npx supabase link --project-ref mqbxzilcdeuhiapyozny
# nur falls Phase 6 per SQL-Editor eingespielt wurde, der CLI mitteilen, dass sie schon angewendet ist:
npx supabase migration repair --status applied 20260928120000
npx supabase db push
```

Prüfen:

```sql
select column_name from information_schema.columns where table_name = 'licenses' and column_name in ('source', 'grace_period_until');
select jobname, schedule from cron.job;   -- erwartet: olo-expire-grace-periods, "17 * * * *"
```

Fehlt der Cron-Job:

1. Unter *Integrations → Cron* pg_cron aktivieren.
2. Ausführen:

```sql
select cron.schedule('olo-expire-grace-periods', '17 * * * *', 'select public.expire_grace_periods()');
```

### 7.0b Rechte-Migration (Phase 7.1 – Pflicht)

Im SQL-Editor `supabase/migrations/20260929090000_service_role_grants.sql` ausführen (wiederholbar). Prüfen:

```sql
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'service_role' and table_schema = 'public' order by 1, 2;
```

### 7.1 Welche Stripe Secrets in Supabase?

| Secret | Wert | Woher |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (optional ein Restricted Key `rk_test_…`, siehe unten) | Stripe → *Workbench* bzw. *Developers → API keys*, **Testmodus/Sandbox** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | aus Schritt 7.4 |
| `SITE_URL` | `http://localhost:5173` (später zusätzlich die Produktionsdomain, kommagetrennt, z. B. `https://app.example.de,http://localhost:5173`) | – |
| `STRIPE_PRICE_PRIVATE`, `STRIPE_PRICE_BUSINESS`, `STRIPE_PRICE_EDUCATION` (+ `_YEARLY`) | **Live: Pflicht** (alle sechs, kein Rückfall). Test/Entwicklung: optional, sonst gelten die hinterlegten Standard-IDs. Modus = Präfix von `STRIPE_SECRET_KEY`. | Stripe → Produktkatalog |
| optional `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_…` einer speziellen Portal-Konfiguration | Stripe → Customer portal |

Setzen im Dashboard: *Supabase → Edge Functions → Secrets*. Alternativ per CLI:

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... SITE_URL=http://localhost:5173
npx supabase secrets list
```

`SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS` und `SUPABASE_JWKS` stellt Supabase automatisch bereit; nicht selbst setzen (Namen mit `SUPABASE_` sind reserviert). Voraussetzung: Im Projekt existiert unter *Project Settings → API Keys* ein **Secret Key** (Name `default`).

**Restricted Key (optional, empfohlen für Live).** Benötigte Rechte:

- *Customers*: Write
- *Checkout Sessions*: Write
- *Subscriptions*: Read
- *Invoices*: Read
- *Customer portal*: Write

**Price IDs prüfen.** Hinterlegt sind (Tarif → Price ID):

- Private → `price_1UKgZZDi0mx4WWPoSxzWozbG`
- Business → `price_1UKgaqDi0mx4WWPo9VeQhU6Y`
- Education → `price_1UKgdWDi0mx4WWPoJaiYfQqu`

Jährlich (Phase 8; überschreibbar mit `STRIPE_PRICE_*_YEARLY`):

- Private → `price_1UKwPqDi0mx4WWPo6wJiRryZ`
- Business → `price_1UKwPZDi0mx4WWPoWV5rgRuI`
- Education → `price_1UKwP0Di0mx4WWPoJiOu2iDW`

Sie müssen zu dem Stripe-Modus gehören, dessen Secret Key du einträgst. Testmodus-Keys finden keine Live-Preise („No such price“).

### 7.2 Edge Functions deployen

```bash
npx supabase login
npx supabase link --project-ref mqbxzilcdeuhiapyozny
npm run supabase:deploy-functions
# entspricht:
#   npx supabase functions deploy create-checkout-session
#   npx supabase functions deploy create-customer-portal
#   npx supabase functions deploy stripe-webhook --no-verify-jwt
```

`supabase/config.toml` setzt `verify_jwt = false` nur für `stripe-webhook`. Checkout und Portal verlangen weiterhin ein gültiges Benutzer-JWT.

### 7.3 Webhook-URL

```
https://mqbxzilcdeuhiapyozny.supabase.co/functions/v1/stripe-webhook
```

### 7.4 Webhook in Stripe anlegen, Ereignisse wählen, Signing Secret finden

1. Stripe-Dashboard im **Testmodus / Sandbox** → *Workbench* → Tab **Webhooks** → **Create an event destination**.
2. **Your account** wählen.
3. API-Version: `2026-08-26.dahlia` (oder die Standardversion des Kontos; der Code verarbeitet beide).
4. Die Ereignisse aus Abschnitt 4 auswählen (mindestens die sechs Pflicht-Ereignisse).
5. **Continue** → **Webhook endpoint** → **Continue** → *Endpoint URL* aus 7.3 → anlegen.
6. **Signing Secret:** Auf der Einstellungsseite des Endpoints erscheint das Secret `whsec_…`. **Reveal secret** klicken, Wert kopieren und als `STRIPE_WEBHOOK_SECRET` in Supabase setzen (7.1).

Test- und Live-Modus haben unterschiedliche Signing Secrets.

### 7.5 Supabase-Auth-URLs

Bereits aus Phase 6: Unter *Authentication → URL Configuration* müssen `http://localhost:5173/**` und später die Produktionsdomain erlaubt sein. Checkout und Portal springen auf `/license`, `/pricing` und `/account` zurück.

### 7.6 Stripe Customer Portal aktivieren

1. Stripe (Testmodus) → *Settings → Billing → Customer portal* (`dashboard.stripe.com/test/settings/billing/portal`).
2. Einstellen:
   - **Payment methods:** Kunden dürfen Zahlungsmittel aktualisieren → **an**
   - **Invoice history:** Rechnungen anzeigen → **an**
   - **Customer information:** nach Wunsch (z. B. Rechnungsadresse, USt-ID)
   - **Cancel subscriptions:** **an**, Modus **„At end of billing period“** (Zugriff bis Periodenende)
   - **Subscriptions → Switch plans / Update subscriptions:** **aus** (Tarifregel, Abschnitt 6)
   - Business information: Datenschutz-/AGB-Links
3. **Save** klicken. Im Testmodus lässt Stripe erst nach dem Speichern Portal-Sessions zu.
4. Optional: Branding unter *Settings → Branding*.

---

## 8. Testen (Stripe-Testmodus, kein Echtgeld)

Voraussetzungen:

- 7.0–7.6 erledigt
- `npm install`
- `npm run dev` → `http://localhost:5173`

Testkarten (beliebiges zukünftiges Ablaufdatum, beliebige CVC):

| Karte | Wirkung |
|---|---|
| `4242 4242 4242 4242` | erfolgreich |
| `4000 0025 0000 3155` | verlangt 3-D-Secure |
| `4000 0000 0000 0341` | lässt sich hinterlegen, **Abbuchungen schlagen fehl** (für Zahlungsausfall) |

Optional Stripe CLI (`stripe login`), um Ereignisse zu sehen:

```bash
stripe listen --print-json --events invoice.payment_failed,invoice.paid
```

Die Zustellungen stehen außerdem in Workbench → Webhooks → Endpoint → *Event deliveries*.

### 8.1 Vollständiger Testkauf

1. Neues Konto registrieren, z. B. Typ **Business**, und anmelden. `/license` zeigt „Deine Lizenz ist noch nicht aktiv“; der Business-Tarif ist markiert, die anderen sind gesperrt.
2. **Jetzt buchen** → Stripe Checkout → Karte `4242 4242 4242 4242` → bezahlen.
3. Rücksprung auf `/license?checkout=success`:
   - Kurz erscheint „Zahlung wird bestätigt …“.
   - Dann folgt „Zahlung bestätigt – deine Lizenz ist aktiv“ und **Zum Dashboard**.
4. `/account` zeigt:
   - Tarif „Business-Lizenz – 1 Betriebsstandort“
   - Lizenzstatus „Aktiv“, Abostatus „Aktiv“
   - „Nächste Abrechnung“ mit Datum
   - Button **Abonnement verwalten** (öffnet das Stripe-Portal)
5. Supabase prüfen:

```sql
select * from public.billing_customers;
select stripe_subscription_id, status, plan, current_period_end, cancel_at_period_end from public.subscriptions;
select plan, status, source, grace_period_until, valid_until from public.licenses;
select id, type, status, attempts, error from public.stripe_events order by received_at desc limit 10;
```

6. Abbruch testen: auf `/pricing` bzw. `/license` buchen und im Checkout **Zurück** wählen. Es erscheint `/pricing?checkout=cancelled` mit Hinweis; die Lizenz bleibt `pending`.

### 8.2 Fehlgeschlagene Zahlung

1. Im laufenden Test-Abo: `/account` → **Abonnement verwalten** → im Portal die Zahlungsmethode auf `4000 0000 0000 0341` ändern (als Standard).
2. Sofortige Abrechnung auslösen. Das setzt den Abrechnungszeitraum auf jetzt; Stripe erstellt direkt eine Rechnung und bucht ab:

```bash
stripe subscriptions update sub_... -d billing_cycle_anchor=now -d proration_behavior=none
```

   Die `sub_…`-ID steht in `/admin` oder in `public.subscriptions`.

3. Erwartet:
   - `invoice.payment_failed` → Lizenz `past_due`, `grace_period_until` ≈ jetzt + 7 Tage
   - In der App: gelbes Banner „Die letzte Zahlung ist fehlgeschlagen …“; der Simulator bleibt nutzbar.
4. Fristende simulieren (statt 7 Tage zu warten):

```sql
update public.licenses set grace_period_until = now() - interval '1 minute'
where institution_id = (select institution_id from public.profiles where email = 'kunde@adresse.de');
select public.expire_grace_periods();   -- → 1; Lizenz = suspended, Simulator gesperrt
```

5. Wiederherstellen:
   - Im Portal wieder `4242 4242 4242 4242` hinterlegen.
   - Die offene Rechnung bezahlen: im Stripe-Dashboard bei der Rechnung **Charge customer**, oder `stripe invoices pay in_...`.
   - → `invoice.paid` → Lizenz `active`, Frist gelöscht.

### 8.3 Kündigung

1. `/account` → **Abonnement verwalten** → **Abo kündigen** (zum Periodenende).
2. Erwartet: `customer.subscription.updated` mit Kündigung zum Periodenende.
   - Lizenz bleibt `active`, `valid_until` = Periodenende.
   - Anzeige: **„Gekündigt – Zugriff bis TT.MM.JJJJ“**; Simulator weiterhin nutzbar.
3. Tatsächliches Ende simulieren: im Stripe-Dashboard beim Abo **Cancel subscription → Immediately**, oder `stripe subscriptions cancel sub_...`.
   - → `customer.subscription.deleted` → Lizenz `cancelled`, Simulator gesperrt, Tarif wieder buchbar.
4. Kündigung zurücknehmen (vor dem Ende): im Portal **Renew**. Die Lizenz ist dann wieder unbefristet.

### 8.4 Sonderlizenz (Admin)

1. `/admin` (Super-Admin): Beim Kunden den Lizenzstatus auf „Aktiv“ setzen. Die Quelle zeigt dann **Manuell**; Stripe-Ereignisse ändern diese Lizenz nicht mehr.
2. „an Stripe zurückgeben“: Die Lizenz übernimmt sofort den Status des aktuellen Stripe-Abos.

---

## 9. Automatisierte Tests

```bash
npm test                      # alles (Unit + Datenbank)
npm run test:stripe           # nur Phase 7
npm run dev:e2e-cloud         # Port 5174 (Mock-Backend mit Stripe-Nachbau), dann:
npm run test:e2e:saas         # SaaS + Stripe im Browser
```

| Test | Inhalt |
|---|---|
| `tests/stripe.handlers.test.ts` | Price IDs je Tarif, unbekannter Tarif, nicht angemeldet (401), Body-Manipulation (price/customer/institution) ignoriert, Tarifregel (422), zweites Abo (409, auch wenn nur Stripe es kennt), Sonderlizenz (409), Portal nur eigener Customer, Signaturprüfung, Duplikate, frisches Laden des Abos, API-Versions-Felder |
| `tests/db/stripe.test.ts` | echte Handler + echte Migrationen in PostgreSQL (PGlite) + Stripe-Nachbau: Customer einmalig, Success-URL schaltet nicht frei, Webhook aktiviert, ungültige Signatur, doppelter Webhook, `payment_failed` → `past_due` + Frist, Frist → `suspended`, spätere Zahlung → `active`, Kündigung (`cancel_at_period_end` und `cancel_at`), Abo-Ende → `cancelled`, veraltete Ereignisse, Sonderlizenz + Rückgabe, fremde Customer ID, RLS/Rechte, Migration wiederholbar |
| `tests/db/grants.test.ts` | unter aktuellen **und** früheren Supabase-Standardrechten: Checkout für die eigene Institution, fremde Institution nicht erreichbar, Portal nur eigener Kunde, Webhook-DB-Operationen, keine erweiterten Rechte für `anon`/`authenticated`, minimale Rechte für `service_role` |
| `tests/edge/edge-auth.smoke.mjs` (`npm run test:edge`, benötigt Deno) | echte Functions unter Deno gegen einen Supabase-Nachbau: JWT-Prüfung (ES256/JWKS, HS256-Rückfall, gefälscht/abgelaufen → 401), DB-Anfragen nur mit Secret Key und nie mit Benutzer-JWT, falscher Schlüssel wird abgelehnt, Portal und Webhook |
| `tests/billing.unit.test.ts` | Zugang in/nach der Frist, Kündigungsanzeige, gedrosselte Bestätigung, Tarifregel, Mock-Ablauf |
| `tests/e2e/stripe.e2e.mjs` | kompletter Ablauf im Browser (Mock): Tarifregel, Abbruch, „Zahlung wird bestätigt …“, Freischaltung, Abo-Übersicht, Portal, Frist, Sperre, Nachzahlung, Kündigung, Ende, Admin |

Nicht automatisiert prüfbar war der Aufruf gegen den echten Stripe-Testmodus und das echte Supabase-Projekt, weil beide aus der Entwicklungsumgebung nicht erreichbar waren. Die Edge Functions wurden unter Deno typgeprüft und lokal gestartet (Signatur-/Ignorier-Pfad). Den echten Durchlauf beschreibt Abschnitt 8.

---

## 10. Später (Live-Betrieb)

- Live-Keys und Live-Price-IDs: `STRIPE_SECRET_KEY=sk_live_…` bzw. `rk_live_…`, `STRIPE_PRICE_*` per Secret setzen.
- Eigenen Live-Webhook mit eigenem `whsec_…` anlegen; `SITE_URL` auf die Produktionsdomain setzen.
- Rechtliches klären: Preisangaben inkl./zzgl. MwSt., Stripe Tax/USt-ID, AGB, Widerruf, Rechnungsangaben.
- Stripe-Einstellungen für Fehlzahlungen prüfen (*Billing → Revenue recovery*: Smart Retries, Aktion nach letztem Versuch, E-Mails an Kunden).
