# Phase 3 – Productization / vollwertige Anwendung

Stand: 0.3.0 · Plattform-Datenversion 3 · SceneDocument-Schema 2 (unverändert)

Mit Phase 3 wird Optical Eye Lab eine vollständige Anwendung. Neu sind:

- Start und Anmeldung
- Dashboard und Simulationsbibliothek mit Vorlagen
- Einstellungen, Profil und Administration
- Import/Export und Onboarding

**Die Physik, das Raytracing, die Presets, der Inspector und die Transform-Werkzeuge sind unverändert.** Der Simulator wird als Arbeitsfläche eingebettet.

> **Wichtig:** Die Anmeldung ist eine **lokale Produkt-Demo** und keine sichere Authentifizierung.
> Alle Daten liegen unverschlüsselt im LocalStorage des Browsers. Es gibt keinen Server, keine E-Mail-Bestätigung und keine Cloud.
> Die Oberfläche sagt das an der Anmeldung, im Onboarding, im Profil und unter Einstellungen → Daten.

---

## 1. Architektur

```
src/
├─ platform/          Plattform-Kern (ohne React, vollständig unit-getestet)
│  ├─ models.ts         Datenmodelle (User, Organization, SimulationMetadata, Template, Session …)
│  ├─ permissions.ts    Rollen → Rechte, rollenabhängige Bezeichnungen je Organisationstyp
│  ├─ preferences.ts    UserPreferences (Obermenge der Simulator-Präferenzen), Normalisierung, Arbeitsbereiche
│  ├─ storage.ts        StorageProvider-Schnittstelle, LocalStorageProvider, MemoryStorageProvider, Schlüssel
│  ├─ repositories.ts   typisierter Datenzugriff, serialisierte Schreibvorgänge
│  ├─ auth.ts           AuthProvider-Schnittstelle + LocalAuthProvider
│  ├─ demoCredentials.ts  lokale Demo-Passwörter (SHA-256 + Salt, nur gegen Klartext in DevTools)
│  ├─ accounts.ts       Profil, Benutzerverwaltung, Organisation/Branding
│  ├─ library.ts        Bibliothek: anlegen, speichern, umbenennen, duplizieren, löschen, Favoriten,
│  │                    Archiv, Suche/Filter/Sortierung, Vorlagen, Import
│  ├─ templates.ts      eingebaute Vorlagen (über die Physik-Presets), leere Simulation
│  ├─ summary.ts        Kurzinfo der Karten (Rx, Elemente, Merkmale) – aus dem SceneDocument abgeleitet
│  ├─ fileFormat.ts     .opticsim / Bibliotheksdatei / alte .oel.json, robuste Prüfung
│  ├─ migration.ts      Übernahme der Phase-1/2-Daten
│  ├─ seed.ts           Demo-Daten, Entfernen, Alles-löschen
│  ├─ branding.ts       Akzentfarbe/Produktname anwenden
│  └─ platform.ts       createPlatform(storage) – bündelt alles, init() einmalig
├─ app/               Anwendung (React)
│  ├─ router.tsx        Routen, Splash, Schutz (RequireAuth / RequirePermission), 404, Fehlerseite
│  ├─ session.ts        Sitzungs-Store (Benutzer, Organisation, Bibliothek, Vorlagen)
│  ├─ AppLayout.tsx     Seitennavigation, Benutzermenü, Hinweisbanner, Onboarding
│  ├─ pages/            Login, Dashboard, Library, Templates, Settings, Profile, AdminUsers,
│  │                    AdminOrganization, SimulatorPage (+ /simulations/new)
│  └─ library/          Aktionen, Karten, Dialoge (Neue Simulation, Als Vorlage speichern)
├─ ui/ds/             Design-System (Button, Field, TextField, Select, Search, Card, EmptyState,
│                     Avatar, Pill, Tabs, Switch, SettingRow, Notice, Confirm/Prompt-Dialoge)
├─ App.tsx            SimulatorWorkspace (bisherige Simulator-Oberfläche, jetzt mit Slots)
└─ state/store.ts     Simulator-Store + injizierbare Hooks (save, writeDraft, persistPrefs)
```

**Kopplung Simulator ↔ Plattform:**

- Der Simulator kennt weder Benutzer noch Bibliothek.
- `SimulatorPage` lädt einen Bibliothekseintrag mit `openSimulation(simId, doc)`.
- Speichern, Entwurfssicherung und Einstellungen injiziert sie über `configureStoreHooks`.
- Menüaktionen (Speichern unter, Duplizieren, Export …) setzt sie über `store.shell`.
- Breadcrumb und Benutzermenü kommen als `leading`/`trailing` in die Werkzeugleiste.

## 2. Datenmodelle

| Modell | Wichtigste Felder |
|---|---|
| `User` | id, firstName, lastName, displayName, email, role, organizationId?, avatarDataUrl?, avatarColor, language, jobTitle?, trainingStatus?, department?, active, isDemo?, createdAt, lastLoginAt? |
| `Organization` | id, name, type, defaultRole, featuredTemplateIds, branding{productName, accentColor, logoDataUrl?, companyName?}, createdAt, plan? (vorbereitet, ohne Wirkung) |
| `UserPreferences` | alle Simulator-Präferenzen aus Phase 2 + Allgemein, Darstellung, Grafik, Simulation, Bedienung, Augenoptik, Personalisierung, onboardingDone |
| `SimulationMetadata` | id, name, description, ownerId (`legacy` = aus der Vorversion), organizationId?, createdAt, updatedAt, lastOpenedAt?, tags, category, favorite, archived, templateId?, summary, hasThumbnail, schemaVersion |
| `SimulationRecord` | meta + doc (SceneDocument, unverändert Schema 2) |
| `Template` | id, name, description, category, tags, visibility builtin/private/organization, createdBy?, organizationId?, presetId? oder doc? |
| `Session` | userId, provider, issuedAt |

- **Rollen** (technisch neutral): `admin`, `trainer`, `member`, `guest`.
  - Die angezeigte Bezeichnung richtet sich nach dem Organisationstyp, z. B. Schule: Lehrkraft / Schüler/in, Meisterschule: Dozent/in / Meisterschüler/in, Betrieb: Ausbilder/in / Mitarbeiter/in.
- **Rechte** (`permissions.ts`):

  | Rolle | Rechte |
  |---|---|
  | admin | alles |
  | trainer | Simulationen, Export, eigene Vorlagen und Organisationsvorlagen |
  | member | Simulationen und Export |
  | guest | höchstens 5 Simulationen |

- **Kategorien:** Refraktion, Brillenglas, Kontaktlinse, Astigmatismus, Tränenlinse, Demonstration, Training, Eigene, Sonstige.
- **Organisationstypen:** Schule, Meisterschule, Betrieb, Hochschule, Schulungszentrum, Industrie, Forschung, Sonstige.

## 3. Auth-Struktur

```ts
interface AuthProvider {
  kind; label; capabilities { secure, emailVerification, passwordReset, sso }
  restore(); signIn(email, pw); signUp(input); signInAsGuest(); signOut();
  knownAccounts(); changePassword(userId, current, next)
}
```

- **`LocalAuthProvider`:** `capabilities.secure = false`.
  - Das Passwort wird mit SHA-256 und Salt (`crypto.subtle`) abgelegt, nur damit es nicht im Klartext in den Entwicklerwerkzeugen steht.
  - Die Sitzung liegt unter `oel:v3:session`.
- **Erstes echtes Konto:** Es legt die Organisation der Installation an und wird **Administrator/in**. Weitere Konten erhalten die Standardrolle der Organisation.
- **Deaktivierte Konten** können sich nicht anmelden. Die letzte aktive Administration kann weder deaktiviert noch herabgestuft werden.
- **„Demo starten“:** gemeinsamer Gastzugang ohne Konto.
- **Demo-Trainer:** `demo@opticaleyelab.local` / `demo` (Max Mustermann, Organisation „Optical Eye Lab Demo“), entfernbar.

## 4. Persistenz

`StorageProvider` ist asynchron: `get`, `set`, `remove`, `keys` und `usage`. Er wirft `StorageQuotaError`, wenn der Speicher voll ist.

- `LocalStorageProvider`: Browser. Ist LocalStorage gesperrt, weicht er auf den Arbeitsspeicher aus und die Oberfläche zeigt einen Hinweis.
- `MemoryStorageProvider`: für Tests, optional mit Limit.

| Schlüssel | Inhalt |
|---|---|
| `oel:v3:meta` | Installationsdaten, Migration, Demo-Status, primäre Organisation |
| `oel:v3:users`, `oel:v3:credentials`, `oel:v3:session`, `oel:v3:recent-users` | Konten, Demo-Passwörter, Sitzung, zuletzt genutzte Konten |
| `oel:v3:orgs` | Organisationen |
| `oel:v3:prefs:<userId>` | Einstellungen je Benutzer |
| `oel:v3:sims:index` | Metadaten aller Simulationen |
| `oel:v3:sim:<id>` | SceneDocument |
| `oel:v3:thumb:<id>` | Vorschaubild (JPEG 320×200, ca. 10–25 KB) |
| `oel:v3:draft:<id>` | Absturzsicherung (ungespeicherter Stand) |
| `oel:v3:templates` | eigene und Organisationsvorlagen |

- **Schreibvorgänge nach dem Muster Lesen → Ändern → Schreiben** laufen serialisiert. Parallele Aktionen, etwa das automatische Speichern und das Setzen eines Favoriten, überschreiben sich dadurch nicht.
- **Speichern:** Zuerst wird das Dokument geschrieben, danach der Index.
- **Automatisches Speichern:** Es ist einstellbar (1–30 s nach der letzten Änderung) und wartet, bis eine Geste abgeschlossen ist. Die Statusleiste zeigt „Gespeichert · vor X s“ oder „Ungespeichert“.
- **Absturzsicherung:** Ungespeicherte Stände werden als Entwurf gesichert. Beim nächsten Öffnen erscheint „Wiederherstellen / Verwerfen“.
- **Verlassen-Schutz:** Er greift beim Navigieren innerhalb der App (`useBlocker`) und beim Schließen des Tabs (`beforeunload`). Das Verhalten ist einstellbar: nachfragen, speichern oder verwerfen.
- **Dateiformat `.opticsim`:**
  - `{ format: 'optical-eye-lab/simulation', version: 1, exportedAt, meta, doc }`
  - Die Bibliothek wird als `{ format: 'optical-eye-lab/library', … simulations: [] }` exportiert.
  - Importierbar sind auch alte `.oel.json`-Szenen.
  - Ungültige Dateien führen zu einer verständlichen Meldung, nie zu einem Absturz.

## 5. Routing

Das Routing nutzt `react-router` 8 mit `createBrowserRouter`. Alle Adressen lassen sich neu laden:

- **Netlify:** `public/_redirects` (`/* /index.html 200`).
- **Vite dev/preview:** SPA-Fallback.

| Route | Seite |
|---|---|
| `/` | Weiterleitung zur Startansicht (Einstellung) oder zu `/login` |
| `/login` | Anmelden · Konto erstellen · Demo starten · bekannte Konten (`?switch=1`, `?mode=signup`, `?next=`) |
| `/dashboard` | Begrüßung, Schnellaktionen, zuletzt verwendet, Favoriten, Vorlagen & Lernszenarien |
| `/simulations` | Bibliothek (`?q`, `?cat`, `?scope`, `?sort`, `?tag` in der URL) |
| `/simulations/new?template=<id>&name=` | legt eine Simulation aus einer Vorlage an und öffnet sie |
| `/simulations/:id` | Simulator (Vollbild, Breadcrumb „Optical Eye Lab › Meine Simulationen › Name“) |
| `/templates` | Vorlagen |
| `/settings`, `/settings/:section` | Einstellungen (general, appearance, graphics, simulation, controls, optics, workspace, data) |
| `/profile` | Profil |
| `/admin/users`, `/admin/organization` | Administration (nur mit Recht) |
| `*` | 404 |

Geschützte Routen leiten mit `?next=` zur Anmeldung und nach dem Login zurück.

## 6. Migration

`migrateLegacyData` läuft genau einmal, wenn `oel:v3:meta` fehlt:

1. **`optical-eye-lab.scenes.v1`:**
   - Jede Szene wird ein Bibliothekseintrag mit Besitzer `legacy` und Tag „Übernommen“.
   - Übernommene Szenen sind für alle Konten sichtbar.
   - Der Speicherzeitpunkt bleibt erhalten, die Kategorie wird geschätzt.
   - Dokumente laufen durch `migrateDocument` (v1 → v2).
   - Beschädigte Einträge werden gezählt und übersprungen.
2. **`optical-eye-lab.autosave.v1`:** Unterscheidet sich die Auto-Sicherung inhaltlich von allen gespeicherten Szenen, wird sie zu „Wiederhergestellter Arbeitsstand – Name“.
3. **`optical-eye-lab.prefs.v1`:** Die Einstellungen werden Vorgabe für Konten ohne eigene Einstellungen.
4. **Altdaten werden nicht gelöscht.** Ausnahme ist „Alle lokalen Daten löschen“, das sie mit entfernt.

Nach der Übernahme zeigt das Dashboard einmalig einen Hinweis mit Link auf die übernommenen Szenen.

## 7. UI-Bereiche

- **Start:** Splash-Screen, danach die Anmeldung. Bekannte Konten, Registrierung (das erste Konto mit Organisation), „Demo starten“ und der Demo-Trainer-Hinweis sind sichtbar.
- **Dashboard:**
  - „Guten Morgen / Willkommen / Guten Abend, Name“ mit Rolle und Organisation
  - 5 Schnellaktionen, zuletzt verwendet, Favoriten
  - Vorlagen, die die Organisation empfiehlt
- **Bibliothek:**
  - Suche über Name, Rezept, Tags und Elemente, Kategorie- und Sortierfilter
  - Tabs Alle, Favoriten, Zuletzt geöffnet, Archiv sowie „Nur meine“ für Admins
  - Kachel- und Listenansicht, Import per Dateiwahl oder Drag & Drop, Export der Bibliothek
  - Kartenaktionen: Öffnen, Duplizieren, Umbenennen, Exportieren, Als Vorlage speichern, Favorit, Archivieren, Löschen (mit Bestätigung)
- **Neue Simulation:** leer (mit den Standardwerten des Benutzers) oder aus 12 Vorlagen:
  - Emmetrop, Myopie, Hyperopie, Astigmatismus
  - Brillenkorrektion, torisches Brillenglas
  - sphärische KL, **torische KL (neu)**, RGP + Tränenlinse
  - HSA-Änderung, **freie optische Bank (neu)**, Kepler-System
  - Eigene und Organisationsvorlagen kommen hinzu.
- **Simulator:**
  - Breadcrumb mit Simulationsmenü: Speichern, Speichern unter, Umbenennen, Duplizieren, Als Vorlage, Zurücksetzen, Export, Import, Meine Simulationen, Schließen
  - Benutzermenü, Speicherstatus
  - Tastenkürzel ⌘/Strg+S, ⌘/Strg+⇧+S und ⌘/Strg+O
  - Die Schnelleinstellungen verlinken zu allen Einstellungen.
  - Lieblingselemente sind im Dialog „Optisches Element“ markierbar.
- **Einstellungen:** Jede Option wirkt sofort.

  | Bereich | Inhalt |
  |---|---|
  | Allgemein | Startansicht, Sprache (Englisch in Vorbereitung), automatisches Speichern, Verhalten beim Schließen, Löschbestätigung, Einführung, Zurücksetzen |
  | Darstellung | Dunkel/Hell/System, Schriftgröße, reduzierte Bewegung, Panel-Deckkraft und -Breiten, Panels, Hover-Infos |
  | 3D & Grafik | Qualitätsstufe, Schatten, Reflexion, Antialiasing, Pixeldichte (Nachbearbeitung „In Entwicklung“) |
  | Simulation | Live-Berechnung; Achse, Bemaßung, Bank und Ametropie-Modell für leere Simulationen |
  | Bedienung | Kamera-Dreh- und Zoomgeschwindigkeit, Standardprojektion, Standardwerkzeug, Gizmo, Raster |
  | Augenoptik | Zylinderschreibweise, Parametermodus, dpt-Schrittweite, Nachkommastellen |
  | Arbeitsbereich | Standard, Refraktion, Kontaktlinse, Unterricht, Präsentation; Lieblingselemente |
  | Daten | Speicherort, Belegung, Export/Import, Demo-Daten entfernen, alles löschen |

- **Profil:** Name, Anzeigename, Avatar (Bild oder Farbe) und optionale Angaben (Tätigkeit, Ausbildungsstand, Abteilung). Das Passwort lässt sich ändern.
- **Administration:**
  - **Benutzer:** anlegen, bearbeiten, Rolle ändern, deaktivieren/aktivieren, Passwort zurücksetzen.
  - **Organisation:** Name, Art, Standardrolle, empfohlene Vorlagen.
  - **Branding:** Produktname, Firmenname, Akzentfarbe mit Live-Vorschau, Logo.
- **Onboarding:** 4 Schritte, jederzeit überspringbar und in den Einstellungen erneut startbar.
- **Leere Zustände, Toasts und Fehlerseiten:** Keine Seite stürzt bei fehlenden Daten, unbekannten IDs oder kaputten Dateien ab.
- **Responsiv:**
  - Unter 1100 px wird die Seitennavigation schmal.
  - Unter 1280 px kürzt der Simulator den Breadcrumb.
  - Getestet: 1440, 1366, 1180 und 1024 px.

## 8. Bekannte Grenzen

- **Keine echte Kontosicherheit:** Wer Zugriff auf den Browser hat, sieht alle Daten. Es gibt keine E-Mail-Bestätigung und keinen Passwort-Reset per E-Mail.
- **Daten existieren nur in diesem Browser auf diesem Gerät.** Browserdaten löschen heißt Daten weg; Export ist die Sicherung.
- **LocalStorage hat meist 5–10 MB:** grob 150–300 Simulationen mit Vorschaubild. Ist der Speicher voll, erscheint eine klare Meldung. Vorschaubilder sind optional und verhindern das Speichern nie.
- **Mehrere Tabs:** Gleichzeitiges Bearbeiten derselben Simulation in zwei Tabs wird nicht synchronisiert; der zuletzt gespeicherte Stand gewinnt.
- **Helles Design:** Es betrifft die Oberfläche. Der 3D-Laborraum bleibt bewusst dunkel (Kontrast für Glas und Strahlen).
- **Nicht umgesetzt** (gekennzeichnet oder bewusst weggelassen):
  - Englische Oberfläche und Nachbearbeitung (Bloom, Tiefenschärfe)
  - Lizenzen und Benutzerlimits
  - Cloud-Sync, SSO, Zahlungen
  - Live-Collaboration, LMS
- **Branding gilt je Organisation.** Auf der Anmeldeseite (noch keine Sitzung) erscheint der Standard-Produktname.

## 9. Vorbereitung Cloud

- **Neuer `StorageProvider`:** z. B. IndexedDB, REST oder Supabase-Tabellen. Die Repositories bleiben unverändert, da die Schnittstelle schon asynchron ist.
- **Neuer `AuthProvider`:** `SupabaseAuthProvider`, `ClerkAuthProvider` oder `EnterpriseSSOProvider` mit derselben Schnittstelle. `capabilities.secure = true` schaltet in der Oberfläche die Demo-Hinweise ab. Das ist vorbereitet über `capabilities`.
- **Mandantenfähigkeit:** `organizationId` steckt bereits in User, Simulation und Template. Sichtbarkeitsregeln liegen zentral in `library.ts` und `permissions.ts` und können serverseitig gespiegelt werden.
- **Lizenzierung:** `Organization.plan { name, seatLimit }` ist angelegt, derzeit ohne Wirkung.
- **Sync-Konflikte:** `updatedAt` und `schemaVersion` je Simulation, Entwurf getrennt vom gespeicherten Stand. Das ist die Grundlage für „last write wins“ oder einen Merge-Dialog.
- **Datei-Envelope** mit `format` und `version` für stabile Austauschformate.

## Tests

- **Unit** (`npm test`): 109 Tests, davon 30 in `tests/phase3.platform.test.ts`. Sie decken ab:
  - Konten, Rollen, Admin, Profil
  - Bibliothek (anlegen, umbenennen, duplizieren, löschen, Favoriten, Archiv, Filter, Sortierung, Parallelität, Speicher voll)
  - Vorlagen, Import/Export, Einstellungen je Benutzer, Migration, Demo-Daten
- **E2E** (Dev-Server starten, dann `npm run test:e2e`):
  - `phase1`, `phase2` und `smoke` laufen jetzt über den Demo-Login und `/simulations/new?template=…`.
  - `phase3.e2e.mjs` prüft:
    - Erststart, Registrierung, Onboarding und Dashboard
    - neue Simulation, Speichern mit Vorschaubild, Bibliothek, Suche und Favoriten, Wiederöffnen
    - Verlassen-Schutz, automatisches Speichern, Einstellungen (Theme bleibt nach Neuladen), Import gültiger und ungültiger Dateien
    - Admin legt Benutzer an, Benutzerwechsel und Datentrennung, Sitzung bleibt nach Neuladen
    - Gastzugang, geschützte Routen, 404, Responsivität, Konsole
