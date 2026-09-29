# OLO-LAB3D – SaaS-Grundstruktur mit Supabase (Phase 6)

> Weiterentwicklung: Stripe-Abos → [STRIPE_SUBSCRIPTIONS.md](STRIPE_SUBSCRIPTIONS.md) · Demo, Jahrespreise, B2C/B2B, Rechtstexte → [PHASE8_DEMO_LEGAL.md](PHASE8_DEMO_LEGAL.md)

Stand: 0.7.0 · Supabase Auth + Postgres (RLS) · Stripe-Abos umgesetzt in Phase 7 → [STRIPE_SUBSCRIPTIONS.md](STRIPE_SUBSCRIPTIONS.md)

Diese Phase legt eine Benutzer- und Lizenzschicht **vor** den bestehenden Simulator.

- **Unverändert:** Simulator, Module, Physik, Dashboard und die lokale Speicherung der Simulationen.
- **Neu:** Anmeldung, Registrierung mit Kundengruppe, Institutionen, Rollen, Lizenzen, Zugriffsschutz in der Datenbank und eine Lizenzsperre für alle Simulator-Bereiche.

---

## 1. Analyse des Bestands (vor der Umsetzung)

| Punkt | Befund |
|---|---|
| Framework | Vite 8 + React 19 + TypeScript, react-router 8 (Browser-Routing), zustand 5, Vitest, Playwright-Core. Umgebungsvariablen daher mit Präfix `VITE_`. |
| Auth / Supabase | Kein Supabase-Code vorhanden. Es gab eine lokale Demo-Anmeldung (`src/platform/auth.ts`, `LocalAuthProvider`) hinter der Schnittstelle `AuthProvider` – ausdrücklich keine echte Sicherheit. |
| Datenhaltung | Simulationen, Vorlagen, Einstellungen im LocalStorage (`src/platform/*`, Schlüssel `oel:v3:*`), je lokalem Benutzer. |
| Routing | `src/app/router.tsx`: `/login`, `/dashboard`, `/simulations(/:id)`, `/modules(/:id(/:simId))`, `/templates`, `/settings`, `/profile`, `/admin/*`, Schutz nur „angemeldet?“. |
| Architektur-Entscheidung | Die neue Schicht wird **neben** die Plattform gesetzt statt sie umzubauen. Nach der Supabase-Anmeldung wird ein lokaler Arbeitsbereichs-Benutzer `sb_<auth-uuid>` aktiviert; alle bestehenden Bibliotheks- und Simulatorfunktionen laufen unverändert weiter, getrennt je Supabase-Konto. |

---

## 2. Architektur

```
src/cloud/                      SaaS-Kern (ohne React)
├─ config.ts                    Betriebsart + Env-Variablen; lehnt geheime Schlüssel im Frontend ab
├─ types.ts                     Profile, Institution, Lizenz, Rollen, Status (spiegelt die Tabellen)
├─ plans.ts                     Tarife (Anzeige), Lizenz- und Statusbezeichnungen
├─ access.ts                    Lizenzprüfung accessState()/hasActiveLicense() – rein, getestet
├─ validation.ts                Registrierungsprüfung + Metadaten (nur Stammdaten)
├─ errors.ts                    verständliche deutsche Fehlermeldungen
├─ backend.ts                   Schnittstelle CloudBackend
├─ supabaseBackend.ts           Supabase-Implementierung (supabase-js, Publishable Key, RLS)
└─ mockBackend.ts               Nachbau im Browser – NUR für Tests (VITE_AUTH_MODE=mock)

src/app/cloudSession.ts         Zustand (Sitzung, Konto, Lizenz) + Brücke zum lokalen Arbeitsbereich
src/app/pages/cloud/            Startseite, Login, Registrierung, Passwort vergessen/zurücksetzen,
                                Tarife, Lizenz, Konto, Admin
src/app/router.tsx              Guards: RequireAuth · RequireLicense · RequireSuperAdmin · CloudOnly
src/app/AppLayout.tsx           Navigation abhängig von Lizenz/Rolle, Benutzermenü (Konto/Lizenz/Abmelden)

supabase/migrations/20260928120000_saas_foundation.sql   Tabellen, Trigger, Funktionen, RLS
supabase/functions/             create-checkout-session · stripe-webhook · create-customer-portal (Phase 7, siehe STRIPE_SUBSCRIPTIONS.md)
supabase/tests/auth_stub.sql    Supabase-Nachbau für lokale Datenbanktests
tests/db/rls.test.ts            RLS-/Trigger-Tests gegen echtes PostgreSQL (PGlite)
tests/saas.unit.test.ts         Unit-Tests der SaaS-Schicht
tests/e2e/saas.e2e.mjs          Browser-Tests der Abläufe (Mock-Backend)
```

**Betriebsarten** (`VITE_AUTH_MODE`):

| Modus | Wann | Verhalten |
|---|---|---|
| `supabase` | Standard, sobald `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` gesetzt sind | Echte Anmeldung, Lizenzprüfung, RLS |
| `local` | ohne Supabase-Werte oder `npm run dev:local` | Bisherige lokale Demo-Anmeldung, **keine** Lizenzprüfung (Offline-Entwicklung, bestehende E2E-Tests) |
| `mock` | `npm run dev:e2e-cloud` | Supabase-Nachbau im Browser, deutlich gekennzeichnet („Testmodus“) – nur für automatisierte Tests |

Produktion (z. B. Netlify) setzt die beiden Supabase-Variablen → Modus `supabase`.

---

## 3. Tabellen

| Tabelle | Inhalt | Wichtig |
|---|---|---|
| `institutions` | `type` (private/business/education), `name`, `contact_name`, Adresse, `country` | Zentrale Organisationseinheit, an ihr hängt die Lizenz |
| `profiles` | `user_id` → `auth.users` (1:1, cascade), `institution_id`, Name, E-Mail, `role` | Rolle nur serverseitig änderbar |
| `licenses` | `institution_id`, `plan`, `status` (pending/active/past_due/suspended/expired/cancelled), `valid_from/until`, `max_locations` = 1 | Neue Konten: **pending** |
| `subscriptions` | Stripe `customer/subscription/price` IDs, Status, Periode, `cancel_at_period_end`, `license_id` | Wird ausschließlich vom Stripe-Webhook geschrieben (Phase 7) |
| `audit_logs` | `actor_user_id`, `institution_id`, `action`, `metadata`, `created_at` | Nur serverseitig geschrieben (Registrierung, Lizenzänderung, Stripe) |
| `plan_catalog` | Tarif, Name, Preis (Cent), Standorthinweis, `stripe_product_id`, `stripe_price_id` | Öffentlich lesbar; die Checkout-Funktion liest den Preis **serverseitig** |

**Entscheidung Privatkunden:**

- Jedes Privatkonto erhält eine eigene, minimale Institution (`type = private`, Name „Privat – Vorname Nachname“).
- Dadurch gilt ein einheitliches Modell: Lizenz, Abo und Audit hängen immer an einer Institution.
- Ein späterer Tarifwechsel (Privat → Business) ist nur ein Update, kein Umbau.
- Es gibt keine Sonderfälle in RLS und Webhook.

**Registrierung:**

- Der Trigger `on_auth_user_created` → `handle_new_user()` (SECURITY DEFINER) legt beim Anlegen des Auth-Benutzers an:
  - Institution
  - Profil (`institution_admin`)
  - Lizenz (`pending`, Tarif = Kundengruppe)
  - Audit-Eintrag
- Er übernimmt nur Stammdaten aus den Metadaten und begrenzt deren Länge.
- **Rolle und Lizenzstatus kommen nie aus dem Frontend.**

---

## 4. Rollen

| Rolle | Vergabe | Rechte |
|---|---|---|
| `super_admin` | nur serverseitig (SQL-Editor, s. u.) | `/admin`: alle Konten/Lizenzen über `admin_list_accounts()`, Status ändern über `admin_set_license_status()` |
| `institution_admin` | automatisch für den registrierenden Hauptnutzer | Stammdaten der eigenen Institution ändern, Profile/Abos/Audit der eigenen Institution lesen |
| `user` | später (Einladungen, nicht Teil dieser Phase) | eigenes Profil, Lizenz der Institution lesen |

**Schutz gegen Rechteausweitung** – drei Ebenen:

1. **Spaltenrechte:** `authenticated` darf in `profiles` nur `first_name` und `last_name` ändern.
2. **RLS:** keine Schreib-Policies auf `licenses`, `subscriptions` und `audit_logs`.
3. **Trigger `guard_profile_update` und `guard_server_only`:** Sie brechen jede Änderung von Rolle, Institution, E-Mail, Lizenz oder Abo durch die API-Rollen `anon` und `authenticated` ab.

---

## 5. Row Level Security

- **Aktivierung:** Alle sechs Tabellen haben RLS.
- **Standardrechte:** Die Supabase-Standardrechte für `anon`/`authenticated` auf diesen Tabellen werden zurückgenommen und gezielt neu vergeben.
- **Keine Freigabe-für-alle:** Es gibt keine „allow all“-Policies; einzige öffentliche Ausnahme ist der Tarifkatalog (nur lesen, nur aktive Tarife).

| Tabelle | Lesen | Schreiben |
|---|---|---|
| institutions | eigene Institution | Stammdaten nur `institution_admin` (Typ unveränderlich) |
| profiles | eigenes Profil; `institution_admin` zusätzlich die seiner Institution | nur eigener Name |
| licenses | Lizenz der eigenen Institution | – (nur serverseitig) |
| subscriptions | `institution_admin` der eigenen Institution | – |
| audit_logs | `institution_admin` der eigenen Institution | – |
| plan_catalog | alle (auch nicht angemeldet) | – |

**Hilfsfunktionen:**

- `my_institution_id()`, `is_super_admin()` und `is_institution_admin()` sind SECURITY DEFINER mit `search_path = ''`, um RLS-Rekursion zu vermeiden.
- `has_active_license()` steht für spätere serverseitige Prüfungen bereit.

**Super-Admin:**

- Er hat **keine** pauschalen Leserechte per Policy.
- Stattdessen nutzt er einen gesonderten Weg: geprüfte Funktionen (`admin_list_accounts`, `admin_set_license_status`), die intern `is_super_admin()` verlangen.

**Getestet** (`npm run test:db`, 12 Tests gegen PostgreSQL):

- Registrierung legt Institution, Profil und Lizenz `pending` an.
- Privat hat eine eigene Institution; Rolle und Status aus den Metadaten werden ignoriert.
- Fremde Profile, Institutionen, Lizenzen und Audit-Logs sind unsichtbar; `anon` sieht nur den Tarifkatalog.
- Man kann sich nicht selbst auf `active` setzen, keine Lizenz einfügen oder löschen, nicht `super_admin` werden und die Institution nicht wechseln.
- Stripe-Felder und der Institutionstyp sind schreibgeschützt; die Audit-Log-Fälschung ist blockiert.
- Admin-Funktionen sind für normale Nutzer gesperrt; ein Super-Admin kann eine Lizenz aktivieren.
- Institution-Admin und normaler Benutzer sehen jeweils nur das Vorgesehene.

---

## 6. Environment-Variablen

| Variable | Wo | Wert |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend (`.env.local`, Hosting) | `https://mqbxzilcdeuhiapyozny.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Publishable Key (`sb_publishable_…`) – öffentlich, durch RLS abgesichert |
| `VITE_AUTH_MODE` | optional | `supabase` \| `local` \| `mock` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` | **nur** Supabase Function Secrets (Phase 7, siehe STRIPE_SUBSCRIPTIONS.md) | nie im Frontend |

**Dateien:**

- `.env.local` ist lokal angelegt und steht in `.gitignore`.
- `.env.example` enthält keine echten Werte.
- `.env.e2e` und `.env.e2e-cloud` legen nur den Testmodus fest.
- Ein `sb_secret_…`- oder `service_role`-Schlüssel im Frontend wird beim Start abgewiesen.

---

## 7. Auth-Ablauf

1. **Registrierung** (`/register`)
   - **Eingaben:** Kundengruppe (Privat / Betrieb / Schule), Vorname, Nachname, E-Mail, Passwort + Bestätigung (≥ 8 Zeichen, Buchstaben und Ziffern).
   - **Business/Education:** zusätzlich Name (Pflicht), Ansprechpartner und Adresse (optional) sowie der Standorthinweis.
   - **Ablauf:** `supabase.auth.signUp({ options: { data } })` → der Trigger legt Institution, Profil und Lizenz an.
2. **E-Mail-Bestätigung**, falls in Supabase aktiv: Hinweis „Bitte E-Mail bestätigen“. Der Link führt auf `/login?confirmed=1`.
3. **Anmeldung** (`/login`): `signInWithPassword`. Danach werden Profil, Institution und Lizenz über RLS geladen.
   - Ist die Lizenz aktiv, geht es zum Dashboard (bzw. zur gewählten Startansicht).
   - Sonst geht es zu `/license`.
4. **Sitzung:** supabase-js hält sie im localStorage (`olo-lab3d-auth`) und erneuert sie automatisch; beim Neuladen wird sie wiederhergestellt. Während des Ladens erscheint ein Ladebildschirm.
5. **Passwort vergessen** (`/forgot-password`): `resetPasswordForEmail` mit `redirectTo = /reset-password`.
   - Es gibt aus Datenschutzgründen keine Auskunft, ob die Adresse existiert.
   - Der Link öffnet `/reset-password`, dort wird das neue Passwort gesetzt; danach folgt die Abmeldung und die Anmeldung mit dem neuen Passwort.
6. **Abmelden** über das Benutzermenü oder die Kontoseite. Sitzung und Arbeitsbereich werden geschlossen.

---

## 8. Lizenzlogik und geschützte Routen

- **Freischaltung:** Der Simulator ist nur zugänglich bei `angemeldet ∧ Profil ∧ Institution ∧ Lizenz ∧ status = 'active'`.
  - Seit Phase 7 zusätzlich: `status = 'past_due'` mit laufender Frist (`grace_period_until > jetzt`, 7 Tage nach fehlgeschlagener Zahlung).
  - Falls gesetzt, gilt zusätzlich `valid_from ≤ jetzt < valid_until`.
  - Umgesetzt in `accessState()` (Frontend) und `has_active_license()` (Datenbank).

| Bereich | Routen |
|---|---|
| Öffentlich | `/` (Startseite), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/pricing` |
| Angemeldet (auch ohne Lizenz) | `/account`, `/license` (Lizenzstatus + Tarife), `/profile` → `/account` |
| Nur mit aktiver Lizenz | `/dashboard`, `/modules…`, `/simulations…` (inkl. Simulator), `/templates`, `/settings` |
| Nur super_admin | `/admin` (Kunden, E-Mail, Typ, Lizenz, Status, Stripe Customer/Subscription ID, Registrierungsdatum) |

- **Weiterleitungen:**
  - Ohne aktive Lizenz führt jede geschützte Route auf `/license` („Deine Lizenz ist noch nicht aktiv.“, Tarife, „Status erneut prüfen“).
  - Ohne Anmeldung führt sie auf `/login?next=…`.

> **Ehrlicher Hinweis zur Reichweite:** Die Lizenzsperre im Browser steuert die Oberfläche. Die Daten in Supabase sind durch RLS geschützt.
>
> Der Simulator selbst ist clientseitiger Code und liegt im ausgelieferten Bundle. Eine technisch versierte Person könnte die Oberflächensperre lokal umgehen.
>
> Ein serverseitiger Schutz entsteht, sobald wertvolle Inhalte (z. B. Cloud-Simulationen, Lernfälle) aus Supabase geladen und per RLS an `has_active_license()` gebunden werden. Das ist als nächster Schritt vorgesehen.

---

## 9. Was bereits funktioniert

- **Migration:** vollständig und lokal gegen PostgreSQL getestet (12 Datenbanktests).
- **Kontofunktionen:** Registrierung (drei Kundengruppen, dynamische Felder), Login, Logout, Sitzung wiederherstellen, Passwort vergessen/zurücksetzen, E-Mail-Bestätigung, verständliche Fehlermeldungen.
- **Oberfläche und Sperre:** Lizenzseite mit Tarifen, Kontoseite (Name, E-Mail, Typ, Institution, Lizenztyp, Status, Name ändern), Tarifseite, Startseite, Admin-Seite, Navigation nach Lizenz und Rolle.
- **Bestehende Funktionen:** Simulator, Module, Simulationen und Dashboard laufen unverändert, pro Supabase-Konto getrennt.
- **Tests:** Unit-Tests (16 SaaS + alle bisherigen), Browser-Tests der Abläufe (Mock-Modus); alle bisherigen E2E-Tests laufen im lokalen Modus weiter.

**Nicht geprüft werden konnte die Verbindung zu deinem Supabase-Projekt selbst:**

- Aus der Entwicklungsumgebung war `*.supabase.co` gesperrt (Proxy 403).
- Die Migration ist deshalb **noch nicht eingespielt** (siehe 10).

---

## 10. Manuell in Supabase einzurichten

1. **Migration einspielen** – eine von zwei Varianten:
   - **SQL-Editor:** Dashboard → SQL Editor → Inhalt von `supabase/migrations/20260928120000_saas_foundation.sql` einfügen → *Run*.
   - **CLI:**

     ```bash
     npx supabase login
     npx supabase link --project-ref mqbxzilcdeuhiapyozny
     npx supabase db push
     ```

2. **Authentication → URL Configuration:**
   - *Site URL* lokal: `http://localhost:5173`, später die Produktiv-Domain.
   - *Redirect URLs*: `http://localhost:5173/**` und später `https://<domain>/**` (für `/login?confirmed=1` und `/reset-password`).
3. **Authentication → Sign In / Providers → Email:**
   - Aktiviert lassen.
   - Die „Confirm email“-Einstellung nach Wunsch: an = Bestätigungsmail vor dem ersten Login, aus = sofortiger Login nach der Registrierung.
   - Die Mindestpasswortlänge auf 8 setzen (passt zur Oberfläche).
4. **E-Mail-Versand:** Der eingebaute Supabase-Mailversand ist stark limitiert (wenige Mails pro Stunde). Für echte Nutzer unter *Auth → SMTP Settings* einen eigenen SMTP-Dienst eintragen.
5. **Eigenen Super-Admin anlegen:** Zuerst normal über `/register` registrieren, dann im SQL-Editor:

   ```sql
   update public.profiles set role = 'super_admin' where email = 'deine@adresse.de';
   ```

6. **Lizenz testweise freischalten:**
   - Über `/admin` (als Super-Admin).
   - Oder im SQL-Editor:

     ```sql
     update public.licenses set status = 'active', valid_from = now()
     where institution_id = (select institution_id from public.profiles where email = 'kunde@adresse.de');
     ```

   Danach auf `/license` „Status erneut prüfen“ (oder neu anmelden).

---

## 11. Stripe (Phase 7 – umgesetzt)

Checkout, Webhook, Customer Portal, Grace Period, Kündigung und Sonderlizenzen sind umgesetzt.

- Beschreibung, Sicherheitskonzept und alle manuellen Schritte in Stripe und Supabase: **[STRIPE_SUBSCRIPTIONS.md](STRIPE_SUBSCRIPTIONS.md)**
- Migration: `supabase/migrations/20260928200000_stripe_subscriptions.sql`. Die Phase-6-Migration bleibt unverändert.
- Die Price IDs (`price_…`) liegen serverseitig in `supabase/functions/_shared/stripeConfig.ts`. Für einen anderen Modus lassen sie sich per Secret überschreiben. `plan_catalog.stripe_price_id` wird nicht mehr verwendet.

---

## 12. Lokal testen

```bash
npm install
# .env.local enthält URL + Publishable Key (bereits angelegt)
npm run dev                  # http://localhost:5173 – Modus supabase

npm test                     # alle Unit-Tests inkl. SaaS + Datenbank/RLS (PGlite)
npm run test:db              # nur Datenbank/RLS

npm run dev:e2e              # Port 5173, lokaler Modus → bestehende E2E-Tests
npm run test:e2e
npm run dev:e2e-cloud        # Port 5174, Mock-Modus → SaaS-E2E
npm run test:e2e:saas        # SaaS + Stripe-Ablauf (Mock)
```

Die Playwright-Tests brauchen einen Chromium-Browser. Beispiel: `CHROMIUM_PATH=/Pfad/zu/chromium` setzen oder `npx playwright install chromium`.

**Manueller Ablauf gegen Supabase** (nach Schritt 10.1–10.3):

1. `npm run dev` starten und `http://localhost:5173` öffnen.
2. Die Startseite erscheint; weiter über **Registrieren**.
3. Kundengruppe wählen und die Felder ausfüllen.
4. In Supabase unter *Table Editor* prüfen: `institutions`, `profiles` (Rolle `institution_admin`), `licenses` (`pending`).
5. Anmelden (ggf. vorher die E-Mail bestätigen). Die Lizenzseite zeigt „Deine Lizenz ist noch nicht aktiv“ mit den drei Tarifen.
6. `/dashboard` oder `/simulations/…` aufrufen: Es folgt die Weiterleitung zur Lizenzseite.
7. Tarif buchen (Stripe-Testmodus, siehe STRIPE_SUBSCRIPTIONS.md) **oder** die Lizenz als Sonderlizenz in `/admin` bzw. per SQL (10.6) auf `active` setzen, dann „Status erneut prüfen“: Dashboard, Simulator und Module sind frei.
8. Abmelden und wieder anmelden: Die Sitzung und die Freischaltung bleiben bestehen.
9. Simulator, Module, Speichern und Neuladen funktionieren wie gewohnt.
