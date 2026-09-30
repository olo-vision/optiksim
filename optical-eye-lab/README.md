# OLO-LAB3D (Optical Eye Lab)

Interaktive 3D-Simulationsumgebung für Augenoptik – **0.10.0: Cloud-Speicherung & Kontoverwaltung** (Simulationen, Vorlagen und Einstellungen im Kundenkonto, sichere Übernahme lokaler Daten, Konto schließen/löschen, repariertes Kundenportal, durchgängige „Sie“-Ansprache, responsiver Simulator). Details: [docs/CLOUD_ACCOUNT.md](docs/CLOUD_ACCOUNT.md) · **Go-Live-Härtung und Aufbewahrung** (Stripe-Live-Absicherung, Kontolebenszyklus, Sitzungs-/Offline-Schutz, Löschfristen nur für geschlossene Konten): [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) · 0.9.0: Rechtstexte & Rechtsbetrieb (Entwürfe 1.0, Kündigungs-/Widerrufsbutton, Vertragsbestätigung, USt.-Ausweis). Details: [docs/LEGAL_OPERATIONS.md](docs/LEGAL_OPERATIONS.md) · Phase 8: [docs/PHASE8_DEMO_LEGAL.md](docs/PHASE8_DEMO_LEGAL.md) · Stripe-Abos (Phase 7): [docs/STRIPE_SUBSCRIPTIONS.md](docs/STRIPE_SUBSCRIPTIONS.md) · SaaS-Grundstruktur (Phase 6): [docs/SAAS_AUTH_FOUNDATION.md](docs/SAAS_AUTH_FOUNDATION.md).

Davor: **Phase 5: modulares Dashboard** (Skiaskopie, Refraktion, Patientensicht, Kontaktlinse und Brillenglas als eigenständige Module) und **fachlicher Physik-Review** (u. a. Glasdicke aus der Geometrie). Details: [docs/PHASE5.md](docs/PHASE5.md) · Untersuchungsmodi: [docs/PHASE4.md](docs/PHASE4.md) · Anwendung: [docs/PHASE3.md](docs/PHASE3.md) · Optik/Physik: [docs/PHASE2.md](docs/PHASE2.md).

Ein virtuelles optisches Labor mit parametrischem Modellauge (Le Grand), frei platzierbaren optischen Elementen, CAD-Bedienung, Bemaßung, optischer Achse, Inspector und lokalem Speichern. Untersuchungsmodi sind als Arbeitsbereiche über derselben Szene umgesetzt.

---

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ≥ 20.

```bash
npm install      # einmalig
npm run dev      # startet http://localhost:5173 und öffnet den Browser
```

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm run build` | Typprüfung + Produktions-Build nach `dist/` |
| `npm run preview` | Produktions-Build lokal ansehen |
| `npm run typecheck` | Nur TypeScript prüfen |
| `npm test` | Unit-Tests (Optik, Raytracing, Plattform: Konten, Bibliothek, Migration …) |
| `npm run test:e2e` | Browser-Tests Phase 1–5 (vorher `npm run dev:e2e` = lokaler Modus auf Port 5173; einmalig `npx playwright install chromium`) |

**Supabase (Standard ab Phase 6):** `.env.example` nach `.env.local` kopieren und `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` eintragen (nur der *publishable*/anon-Schlüssel – niemals Service-Role- oder Secret-Keys). Die Datenbank wird mit `supabase/migrations/20260928120000_saas_foundation.sql` eingerichtet. Simulator, Dashboard und Module sind nur mit **aktiver Lizenz** erreichbar. Vollständige Anleitung: [docs/SAAS_AUTH_FOUNDATION.md](docs/SAAS_AUTH_FOUNDATION.md).

| Befehl | Modus |
|---|---|
| `npm run dev` | Supabase (aus `.env.local`) |
| `npm run dev:local` | lokale Demo wie Phase 3–5, ohne Backend und ohne Lizenzprüfung |
| `npm run dev:e2e-cloud` | Mock-Backend im Browser (für SaaS-E2E, Port 5174) |
| `npm run test:db` | RLS-/Trigger-Tests der Migration gegen echtes Postgres (PGlite) |
| `npm run test:e2e:cloud` | Cloud-Speicherung, zweites Gerät, Übernahme lokaler Daten, Lizenzende/Neukauf, Konto schließen/löschen, 5 Viewports (Mock-Modus, Port 5174) |
| `npm run test:e2e:saas` | Browser-Tests Registrierung → Tarif → Checkout → Freischaltung → Frist/Kündigung, Demo, Jahrespreise, Rechtstexte, Kündigungs-/Widerrufsbutton (Mock-Modus) |
| `npm run legal:seed` | SQL-Import der Rechtstext-Entwürfe aus `docs/legal/` neu erzeugen |
| `npm run test:stripe` | Stripe-Handler, Abo-Logik, Demo, Zustimmungen, Rechte und Webhook Ende-zu-Ende gegen PostgreSQL |
| `npm run test:edge` | echte Edge Functions unter Deno gegen einen Supabase-Nachbau (JWT-Prüfung, Admin-Client) – benötigt Deno |
| `npm run supabase:deploy-functions` | Edge Functions deployen (Webhook ohne JWT-Prüfung) |

Simulationen werden weiterhin lokal im Browser gespeichert (je Konto getrennt).

**Lokaler Demo-Modus** (`npm run dev:local`): kein Backend, keine externen Dienste. Die Anmeldung ist eine **lokale Produkt-Demo ohne echte Kontosicherheit**; Konten und Simulationen liegen nur im Browser.

**Erster Start (lokaler Demo-Modus):** „Konto erstellen“ (das erste Konto wird Administrator/in), „Demo starten“ (Gastzugang) oder Demo-Trainer `demo@opticaleyelab.local` / `demo`. Daten aus Phase 1/2 werden automatisch übernommen (Tag „Übernommen“).

**Netlify:** `public/_redirects` sorgt dafür, dass alle Adressen (`/dashboard`, `/simulations/…`) neu geladen werden können.

---

## Bedienung

**Maus**

| Aktion | Eingabe |
|---|---|
| Objekt auswählen | Linksklick |
| Kamera drehen | rechte Maustaste · oder `Alt` + links (Trackpad) |
| Kamera verschieben | mittlere Maustaste · oder `⇧` + links |
| Zoom (zum Mauszeiger) | Mausrad |
| Werte fein einstellen | Feldbezeichnung im Inspector nach links/rechts ziehen (`⇧` ×10, `Alt` ×0,1) |

**Wichtige Tasten** (vollständige Liste über das Tastatur-Symbol oben rechts oder `?`)

`Q` Auswahl · `W` Verschieben · `E` Drehen · `S` Einrasten · `L` Welt/Lokal · `A` Element hinzufügen · `F` Auswahl fokussieren · `G` Auge fokussieren · `H` Szene fokussieren · `1`/`3`/`7` Front/Seite/Oben · `5` Perspektive ↔ Ortho · `X` Normal ↔ Schnitt · `M` Bemaßung · `T` Strahlengang · `Leertaste` Strahlengang live/pausiert · `⌘/Strg+Z` Rückgängig · `⌘/Strg+S` Speichern · `⌘/Strg+⇧+S` Speichern unter · `⌘/Strg+O` Meine Simulationen · `Entf` Löschen

---

## Funktionsumfang Phase 1

- **Laborraum**: reflektierender Boden, Podest, Studio-Licht, optische Bank mit Millimeterskala (Nullpunkt = Hornhautscheitel), Halter für Auge und Elemente
- **Modellauge** (Le Grand, homogene Linse): Hornhaut, Sklera, Iris (prozedurale Textur), Pupille, Vorderkammer, Augenlinse, Glaskörper, Retina – alle Maße im Inspector einstellbar; Ansicht *Normal* / *Schnitt* (Halbschnitt öffnet sich automatisch zur Kamera hin, mit Beschriftung)
- **15 optische Elemente**: Sammel-/Zerstreuungslinse, plan-konvex/-konkav, bi-konvex/-konkav, frei definierbare Linse, Brillenglas (rund/oval/rechteckig), Kontaktlinse (allgemein/formstabil/weich), Prisma (brechender Winkel, Basislage), planparallele Platte, Lupe (mit Fassung/Griff), frei definierbares Medium (Quader/Zylinder/Kugel)
- **Analytische Linsengeometrie**: exakte Kugelflächen aus Radien, Mittendicke, Durchmesser; Warnung bei negativer Randdicke
- **Medien-Presets** (Luft, Wasser, Tränenflüssigkeit, Hornhaut, Gläser, Kunststoffe, KL-Materialien) + frei eingebbarer Brechungsindex
- **Berechnete Werte** (paraxial, deutlich als „berechnet“ gekennzeichnet): Flächenbrechwerte, äquivalente Brechkraft, Scheitelbrechwert, Brennweite, Randdicke, Lupenvergrößerung, Prismenablenkung und prismatische Wirkung, Plattenversatz; beim Auge Hornhaut-, Linsen- und Gesamtbrechwert, Bildlage und Fernpunktrefraktion
- **Scheitelbrechwert vorgeben**: berechnet den benötigten Vorder- oder Rückflächenradius
- **Transform-Gizmo** (Verschieben/Drehen, Welt/Lokal, Einrasten) – Inspector und 3D-Szene sind bidirektional live gekoppelt; jede Ziehbewegung = ein Undo-Schritt
- **Szenenbaum**: Raum, Auge, Elemente, Lichtquellen, Messpunkte – Auswahl, Sichtbarkeit, Sperre, Duplizieren, Löschen, Umbenennen (Doppelklick)
- **Bemaßung**: HSA / Abstand Hornhautscheitel → augenseitiger Scheitel (auch direkt eingebbar), Luftabstände zwischen Elementen, Dezentration, Neigung zur Achse, Maßkette in der Szene und als Leiste unten, Messpunkte
- **Optische Achse** (ein-/ausblendbar)
- **Strahlengang (Vorschau)**: echte Strahlverfolgung mit vektoriellem Snellius-Gesetz durch alle Elemente und das Auge, Totalreflexion, Iris als Blende, Fokusanalyse (achsnah und Bündel) relativ zur Retina; live oder pausiert
- **Info bei Hover/Klick** für Elemente und Augenteile; „Mathematisch erklären“ vorbereitet (als *In Entwicklung* gekennzeichnet)
- **Demo-Szenen**: Normales Auge · Auge + Brillenglas (Myopie-Korrektion, HSA 12 mm) · Auge + Kontaktlinse · Auge + zwei Linsen (Kepler-System)
- **Speichern/Laden** (LocalStorage, mehrere Szenen), automatische Sicherung des Arbeitsstands, Neu, Zurücksetzen, Export/Import als JSON-Datei
- **Einstellungen**: Qualitätsstufe (Hoch/Ausgewogen/Leistung), Nachkommastellen, Raster, Gizmo-Größe, Hover-Info
- **Performance**: Rendern nur bei Änderungen (*on demand*), eigenes leichtgewichtiges Label-System, Geometrie-Caching

Funktionen, die noch nicht umgesetzt sind, erscheinen ausschließlich deaktiviert mit dem Hinweis *In Entwicklung* (Untersuchungsgeräte, Lernmodus).

---

## Neu in 0.9.0 – Rechtstexte und Rechtsbetrieb

- **Rechtstexte 1.0 als Entwürfe** (Impressum, AGB, Lizenz- und Nutzungsbedingungen, B2B-Zusatzbedingungen, Datenschutz, Widerrufsbelehrung, Muster-Formular, Verlangen des sofortigen Beginns, Hinweis zum Wertersatz) in `docs/legal/`, Import per `supabase/seed/legal_documents_v1_0_drafts.sql`. Offene Punkte sind mit `[Prüfhinweis]` markiert; veröffentlicht wird erst ohne Markierung.
- **„Verträge hier kündigen“ und „Vertrag widerrufen“** ohne Login (§ 312k / § 356a BGB), mit automatischer Kündigung zum Periodenende und Eingangsbestätigung per E-Mail.
- **Vertragsbestätigung** nach dem Kauf mit allen akzeptierten Texten; **19 % USt.** auf Stripe-Rechnungen; private Jahreslizenz **endet automatisch**; B2B vorerst nur Deutschland.
- E-Mail über SMTP (austauschbar), Edge Functions `consumer-request` und `mail-jobs`, Migration `20260930090000_legal_operations.sql`.

## Neu in Phase 8

- **Demo:** 2 Stunden kostenlos mit vollem Funktionsumfang, ohne Zahlungsdaten, einmal je Kundenkonto – serverseitig geprüft (`start_demo`, `demo_grants`). Timer „Demo – verbleibende Zeit“, nach Ablauf Seite „Deine OLO-LAB Demo ist beendet.“ Danach beginnt nie automatisch ein Abo.
- **Jahrespreise:** 199 € / 399 € / 999 € pro Jahr mit Umschalter *Monatlich | Jährlich*. Die Price ID wählt der Server aus einer Whitelist (`private_monthly … education_yearly`).
- **B2C/B2B:** Privatperson vs. Unternehmen/Bildungseinrichtung; B2B mit Rechnungsanschrift, USt-IdNr. und Position.
- **Rechtstexte & Zustimmungen:** Vertragscenter unter *Admin → Rechtstexte* (versioniert, genau eine aktive Version je Typ/Zielgruppe). Registrierung, Demo und Kauf fragen die aktiven Versionen ab; jede Zustimmung wird unveränderlich mit Version, Hash und Checkout-Session protokolliert.
- **Ablauf:** Paket → Konto → Zustimmungen → Stripe oder Demo → Bestätigung → Kurz-Onboarding.
- Neue Migration `20260929120000_demo_billing_legal.sql`. Details, manuelle Schritte und Tests: [`docs/PHASE8_DEMO_LEGAL.md`](docs/PHASE8_DEMO_LEGAL.md).

## Neu in Phase 7

- **Echter Kaufprozess:** Tarif wählen → Stripe Checkout → Webhook → Abo in Supabase → Lizenz automatisch aktiv → Simulator frei. Das Frontend übergibt nur den Tarif; die Price ID wählt der Server.
- **Tarifregel:** Buchbar ist nur der Tarif passend zum Kontotyp aus der Registrierung.
- **Webhook** (`stripe-webhook`): Signaturprüfung, idempotent (`stripe_events`), lädt Abo und Rechnung frisch von Stripe (API `2026-08-26.dahlia`). Verarbeitet `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
- **Zahlungsausfall:** `past_due` mit 7 Tagen Frist und klarem Hinweis; danach `suspended` (pg_cron); nach Zahlung wieder `active`.
- **Kündigung:** Zugriff bis zum Periodenende („Gekündigt – Zugriff bis …“), danach `cancelled`.
- **Abonnement verwalten:** Stripe Customer Portal (nur eigener Kunde).
- **Konto und Lizenz:** Tarif, Lizenz-/Abostatus, nächste Abrechnung, Kündigungs- und Fristhinweis.
- **Admin:** Tarif, Status, Quelle (Stripe/Manuell), Abostatus, Customer-/Subscription-ID, Periodenende, Kündigung. Manuelle Sonderlizenzen bleiben von Stripe unberührt.
- Neue Migration `20260928200000_stripe_subscriptions.sql`; die Phase-6-Migration ist unverändert.
- **7.1:** Edge Functions prüfen den Benutzer-JWT und greifen über einen separaten Admin-Client (`@supabase/server`, `SUPABASE_SECRET_KEYS`) auf die Datenbank zu. Die Migration `20260929090000_service_role_grants.sql` vergibt die seit der Supabase-Umstellung nötigen Tabellenrechte für `service_role`; das behebt „permission denied for table profiles“.

## Neu in Phase 6

- **Kundengruppen und Tarife:** Private (19,90 €), Business (39,90 €, 1 Betriebsstandort), Education (99,90 €, 1 Bildungsstandort) – Seite `/pricing`.
- **Konten über Supabase Auth:** Registrierung mit Kontotyp und Organisationsdaten, Anmeldung, Abmeldung, Passwort vergessen/zurücksetzen, Sitzungswiederherstellung, verständliche deutsche Fehlermeldungen.
- **Datenbank:** `profiles`, `institutions`, `licenses` (Status standardmäßig `pending`), `subscriptions` (Stripe-Felder vorbereitet), `audit_logs`, `plan_catalog` – mit Row Level Security, Spaltenrechten und Schutz-Triggern (keine Selbst-Freischaltung, keine Rollen-Eskalation, keine Stripe-Manipulation).
- **Lizenzprüfung:** Dashboard, Simulator, Module und Simulationen nur mit aktiver Lizenz; sonst Weiterleitung auf `/license`.
- **Konto-Seite** (`/account`) mit Lizenzart und Status, **Admin-Übersicht** (`/admin`, nur `super_admin`) mit Lizenzstatus-Änderung per geprüfter Datenbankfunktion.
- **Stripe vorbereitet:** Edge Functions `create-checkout-session`, `stripe-webhook`, `create-customer-portal` (ohne Secrets inaktiv; Buttons zeigen „Online-Zahlung folgt“).
- Produktname **OLO-LAB3D**.

## Neu in Phase 5

- **Module direkt vom Dashboard:** Skiaskopie, Refraktion, Patientensicht, Kontaktlinse und das neue Modul **Brillenglas** öffnen sich als eigenständige, fokussierte Bereiche.
  - Sie teilen Panels, Physik und Datenmodell mit dem vollständigen Simulator.
  - Die Modulseite hat eine eigene Kopfzeile: Dashboard · Module · Modulwechsel · Sitzung · „Vollständiger Simulator“.
  - Sitzungen werden fortgesetzt und in „Meine Simulationen“ gespeichert.
  - Spaltlampe, Topograf, Binokulartests und Ophthalmoskop sind vorbereitet („In Entwicklung“).
- **Glasdicke aus der Geometrie:** t = max(t_min, e_min + max(s₁ − s₂)) entlang der echten Kontur.
  - Bei höherem Index werden Plusgläser in der Mitte dünner und Minusgläser am Rand.
  - Weitere Einflussgrößen: Formscheibe, Zentrierung, Mindestdicken.
  - Das Gewicht folgt aus Volumen und Dichte.
- **Physik-Review:**
  - gewendete Gläser
  - Dispersion des Auges (≈ 0,9 dpt F→C)
  - Rot-Grün-Test bei Akkommodation
  - Konkavspiegel-Hauptschnitte
  - Konsistenz Wirkung ↔ Darstellung
  - Details und Befundliste in [docs/PHASE5.md](docs/PHASE5.md).

## Neu in Phase 4

Arbeitsbereiche (Reiter über der Szene), jeweils aus der Geometrie berechnet – Details, Formeln und Grenzen in [docs/PHASE4.md](docs/PHASE4.md):

- **Skiaskopie**:
  - Strichskiaskop als Instrument in der Szene.
  - Der Pupillenreflex folgt aus der Vergenzrechnung: Mit-/Gegenbewegung, neutral, Geschwindigkeit, Breite, Helligkeit, Break/Skew.
  - Plan- und Konkavspiegel, Neutralisation mit Messglas, Arbeitsabstandskorrektur.
  - Training mit unbekanntem Patienten.
- **Refraktion**:
  - Messglas Sph/Cyl/Achse, Nebeln, Kreuzzylinder, Lochblende, Rot-Grün, Fächer, Prisma.
  - Akkommodation nach Alter, Visus-Schätzung, Vorher/Nachher.
- **Patientensicht**: Netzhautbild durch Faltung mit der Punktbildfunktion (FFT im Web Worker), optional chromatisch.
- **Kontaktlinse**:
  - Fluoreszeinbild aus der Tränenfilmdicke (BC, OZ, periphere Kurven, Dezentration, Hornhaut-Q).
  - Klick zeigt Messwert und Interpretation getrennt.
  - Sitzanalyse, 3D-Fluo-Ansicht.
- **Materialsystem**: Brillenglas- und KL-Materialien mit Abbe-Zahl, Dichte, Dk, Dk/t, Wassergehalt; **Dispersion** im Raytracing.
- **Inspector**: Reiter Fachinfo und Werkzeuge (HSA, Brille→KL, Prentice, Keratometer, Tränenlinse …, mit Rechenweg); Standard-/Expertenmodus.

## Neu in Phase 2

- **Refraktionsstatus des Auges**:
  - Eingabe von Sph / Cyl / A.
  - Art der Fehlsichtigkeit wählbar: automatisch, Achsenametropie oder Brechungsametropie.
  - Das Auge wird dafür exakt umgerechnet (Baulänge bzw. torische Hornhaut).
- **Optische Werte ↔ Geometrie**:
  - Linsen, Brillengläser und Kontaktlinsen lassen sich wahlweise über Sph/Cyl/A oder über Radien je Hauptschnitt einstellen.
  - Beide Modi bearbeiten dasselbe Objekt.
  - Plus- und Minuszylinder sind gleichwertig, die Transposition wird angezeigt.
- **Torische Flächen** in Geometrie, Darstellung und Raytracing.
- **Korrektion live**: Wirkung am Hornhautscheitel (HSA), Restrefraktion und Fokuslage, jeweils mit Info-Erklärung (Formel mit eingesetzten Werten).
- **Tränenfilm und Tränenlinse**:
  - Echtes Medium mit n = 1,336 zwischen Kontaktlinse und Hornhaut.
  - Anzeige von Sitzklasse, Tränenraumprofil und Auflage.
  - Weiche Linsen schmiegen sich an (vereinfacht).
- **Astigmatismus sichtbar**: zwei Brennlinien, Sturmsches Intervall und Strahlenfächer entlang der Hauptschnitte.
- **Demo-Szenen**:
  - Emmetropes Auge, Myopie, Hyperopie, Astigmatismus
  - Myopie mit Brillenkorrektion, mit Kontaktlinse und mit formstabiler KL samt Tränenlinse
  - Geänderter HSA, torisches Glas, Kepler-System

## Konventionen

- **1 Three.js-Einheit = 1 mm.** Winkel im Datenmodell in Grad, Brechkraft in dpt.
- **Licht läuft in +Z.** Das Auge schaut nach −Z; sein lokaler Ursprung ist der **Hornhautscheitel**, +Z zeigt ins Auge.
- **Radien-Vorzeichen:** r > 0 → Krümmungsmittelpunkt liegt in Lichtrichtung hinter dem Scheitel. `0` = plan.
- **Element-Ursprung** = Mitte zwischen Vorder- und Rückscheitel; lokale +Z-Achse = optische Achse des Elements.
- **Prisma-Basislage** (Frontansicht auf das Auge): 0° rechts · 90° oben · 180° links · 270° unten.
- **Zylinderachsen (TABO)**: Blick auf das Auge, 0° rechts, gegen den Uhrzeigersinn, Wertebereich (0°, 180°].
- **Refraktion des Auges** bezieht sich auf den **Hornhautscheitel**. Brillenwerte werden über F/(1 − d·F) umgerechnet.
- **Source of Truth** ist die Geometrie; Sph/Cyl/A werden immer daraus berechnet.

---

## Architektur

```
src/
├─ core/                 Framework-unabhängige Grundlagen
│  ├─ units.ts           Einheiten, Umrechnung, deutsche Zahlformatierung/-eingabe
│  └─ math/              Vektoren & Rotationen, Pfeilhöhen/Randdicken, Linsenkonturen
├─ model/                Datenmodell (reines JSON, versioniert)
│  ├─ types.ts           SceneDocument, Auge, Elemente, Lichtquellen, Messpunkte
│  ├─ elementRegistry.ts ★ Registry aller Elementarten (Stammdaten, Standardwerte, Inspector-Felder)
│  ├─ fieldSchema.ts     Deklarative Inspector-Felder
│  ├─ media.ts           Brechungsindex-Presets
│  ├─ sceneFactory.ts    Erzeugen/Platzieren (HSA, auf Hornhaut setzen, zentrieren)
│  └─ derived/           Abgeleitete Geometrie (Auge, Linse, Prisma), Messungen, Info-Karten
├─ engine/
│  ├─ physics/           Paraxiale Optik: Formeln, y-nu-Durchrechnung, Modellauge, Element-Kennwerte
│  └─ raytracing/        Strahlverfolgung: CSG-Körper, Snellius, sequentielles Auge, Fokusanalyse
├─ state/                zustand-Store (Undo/Redo, Gesten), Persistenz & Migration, Demo-Szenen
├─ scene/                3D-Darstellung (React Three Fiber)
│  ├─ camera/            CAD-Kamera, Perspektive/Ortho, panel-bewusstes Einpassen
│  ├─ environment/       Licht, Raum, optische Bank
│  ├─ eye/               Parametrisches Auge, Texturen, Beschriftung
│  ├─ elements/          Elementdarstellung + Geometrie-Builder
│  ├─ interaction/       Auswahl, Hover, Transform-Gizmo, Objekt-Registry
│  ├─ labels/            Performantes HTML-Label-System
│  └─ overlays/          Achse, Bemaßung, Strahlengang, Lichtquellen, Messpunkte
├─ modules/registry.ts   Modul-Registry (Phase 5): Module für Dashboard, Modulseiten und Arbeitsbereiche
└─ ui/                   Oberfläche: Toolbar, Szenenbaum, Inspector, Dialoge, HUD
```

**Datenfluss:** UI und Gizmo ändern das `SceneDocument` ausschließlich über Store-Actions → Szene, Messungen, Physik und Raytracing leiten alles daraus ab (keine doppelte Wahrheit). Physik und Raytracing sind rein funktional und ohne Three.js/React testbar.

### Erweitern

- **Neues optisches Element:** Eintrag in `model/elementRegistry.ts` (Standardwerte + Felder). Passt es zu einer vorhandenen Familie (`lens`, `prism`, `plate`, `medium`), sind Darstellung, Raytracing und Inspector automatisch vorhanden. Für eine neue Familie: Typ in `model/types.ts`, Geometrie in `scene/elements/`, Körper in `engine/raytracing/solids.ts`.
- **Neues Medium:** Eintrag in `model/media.ts`.
- **Neues Fachmodul:** Beschreibung in `modules/registry.ts`; Schnittstelle für Inspector-Abschnitte, Szenen-Overlays und Berechnungen ist dort definiert.
- **Schema-Änderung:** `SCHEMA_VERSION` erhöhen und Migration in `state/persistence.ts → migrateDocument` ergänzen.

---

## Bekannte Grenzen

- Strahlengang: sphärische, plane und torische (bikonische) Flächen; Dispersion per Cauchy-Näherung; keine Fresnel-Verluste, homogene Augenlinse.
- Siehe [docs/PHASE2.md](docs/PHASE2.md) → „Vereinfachungen“.
- Skiaskopie, Refraktion, Patientensicht und Fluoreszein: paraxiale Modelle ohne Aberrationen höherer Ordnung – siehe [docs/PHASE4.md](docs/PHASE4.md) → „Vereinfachungen“ und „Grenzen“.
- Spaltlampe, Topograf: in Entwicklung.
- Die Szene ist für Desktop, Notebook und Tablet im Querformat ausgelegt.
