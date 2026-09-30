# OLO-LAB3D 0.10.0 – Cloud-Speicherung und Kontoverwaltung

## 1. Was wo gespeichert wird

| Daten | Bis 0.9 | Ab 0.10 |
|---|---|---|
| Simulationen (Dokument, Metadaten, Vorschaubild) | LocalStorage | `public.user_simulations` |
| Eigene Vorlagen | LocalStorage | `public.user_templates` |
| Einstellungen (Darstellung, Bedienung, Optik, Favoriten, Onboarding …) | LocalStorage | `public.user_preferences` |
| Geräte-Einstellungen (Grafikqualität, Pixelrate, Schatten, Panelbreiten/-offen, Panel-Deckkraft, Patientensicht-Qualität) | LocalStorage | bleibt lokal (`DEVICE_PREF_KEYS`) |
| Entwürfe der Absturzsicherung | LocalStorage | bleibt lokal (je Simulation) |
| Ansichtswahl der Bibliothek, Paketwahl (24 h) | LocalStorage | bleibt lokal |
| Lokale Kopien übernommener Altdaten | – | 30 Tage lokal, dann entfernt |

Tests, Übungen und Trainingsfälle sind heute Teil des Simulationsdokuments (Modul-Sitzungen = Simulationen mit `module_id`). Sie werden also mitgespeichert. Eine eigene Tabelle ist erst nötig, wenn Ergebnisse unabhängig von Simulationen gespeichert werden sollen.

## 2. Datenmodell (Migration `20261001090000_cloud_content_accounts.sql`)

- Jede Zeile hat `owner_user_id`, `institution_id` und `visibility` (`private` | `institution`).
  - Heute gilt: ein Login je Kundenkonto, nur der Besitzer sieht seine Inhalte.
  - Später kommen persönliche Mitarbeiter-, Lehrkräfte- oder Lernenden-Konten hinzu. Dann reichen weitere Benutzer derselben Institution bzw. `visibility = 'institution'`. Bestehende Zeilen müssen nicht migriert werden.
- `id` ist die Client-ID (`sim_…`). Dadurch entstehen bei der Übernahme lokaler Daten keine Duplikate.
- `doc_revision` wird bei jeder Dokumentänderung vom Trigger erhöht und dient der optimistischen Nebenläufigkeit.
  - Gespeichert wird nur mit `doc_revision = <geladene Revision>`.
  - Andernfalls sieht der Nutzer den Dialog „Als Kopie speichern / Überschreiben“.
  - Hier kann später eine Versionshistorie ansetzen (z. B. `user_simulation_versions`).
- Trigger `guard_user_content()` legt fest:
  - Besitzer und Institution setzt der Server.
  - Zeitstempel können nicht in der Zukunft liegen.
  - Anlegen und Ändern erfordert `content_write_allowed()`, also ein aktives Konto und eine aktive Lizenz (Demo und Zahlungsfrist eingeschlossen). Andernfalls meldet der Server den Fehler `OLL01`.
  - Lesen und Löschen eigener Inhalte ist immer erlaubt.
- RLS:
  - Lesen: eigene Inhalte oder für die Institution freigegebene Inhalte.
  - Anlegen, Ändern und Löschen: nur eigene Inhalte.
  - Explizite GRANTs; `anon` hat keinen Zugriff.

## 3. Ablauf im Browser

- `src/platform/content.ts` definiert die Schnittstelle `ContentRepository`.
  - Lokal setzt `Repositories` sie um, in der Cloud `CloudContentStore` (`src/app/cloudContent.ts`).
  - `platform.useContent()` tauscht den Speicher nach der Anmeldung aus. Die Bibliothek, der Simulator und die Module bleiben dabei unverändert.
- Einstellungen: `src/app/cloudPrefs.ts` teilt sie in Konto- und Geräteanteil. Das Konto-Speichern ist um 1 s entprellt; vor dem Abmelden wird sofort gespeichert.
- Konflikt: Wurde die Simulation auf einem anderen Gerät neuer gespeichert, erscheint ein Dialog mit „Als Kopie speichern“ oder „Überschreiben“. Wurde sie anderswo gelöscht, wird „Als neue Simulation speichern“ angeboten.
- Keine Verbindung:
  - Der Stand liegt als Entwurf auf dem Gerät.
  - Nach 20 s wird automatisch erneut gespeichert.
  - Der Nutzer erhält einen Hinweis, eine Fehlermeldung beim Laden hat die Schaltfläche „Erneut versuchen“.
- Beim Zurückkehren in den Tab wird die Liste neu geladen, damit Änderungen anderer Geräte erscheinen.
- Super-Admins erhalten im Arbeitsbereich keine lokale Admin-Rolle mehr. Bis 0.9 sahen sie im selben Browser lokale Simulationen anderer Konten.

## 4. Übernahme vorhandener LocalStorage-Daten (`src/app/cloudMigration.ts`)

Die Übernahme läuft automatisch nach der Anmeldung und nur mit aktiver Lizenz. Sie ist wiederholbar.

1. Übernommen werden nur Inhalte dieses Kontos (`ownerId = sb_<uuid>`). Inhalte anderer Konten im selben Browser bleiben unangetastet.
2. Existiert dieselbe ID schon in der Cloud, wird nie überschrieben. Ist der lokale Stand neuer und inhaltlich anders, entsteht zusätzlich „… (von diesem Gerät)“.
3. Ist die ID in einem fremden Konto vergeben, wird eine neue ID vergeben.
4. Ohne Lizenz wird nichts geschrieben. Die lokalen Daten bleiben und werden nach dem Kauf übernommen.
5. Ergebnis je Konto: Marker `oel:v3:cloud-migrated:<uuid>`. Die lokalen Kopien werden nach 30 Tagen entfernt, Entwürfe bleiben erhalten.
6. Altbestand aus Versionen vor den Benutzerkonten (Besitzer `legacy`):
   - Er wird nur nach Klick auf „In mein Konto übernehmen“ übernommen, und zwar mit neuen IDs.
   - Danach ist er für dieses Gerät vergeben (`oel:v3:cloud-legacy-claim`) und wird keinem zweiten Konto mehr angeboten.

## 5. Lizenz ≠ Daten

- Endet die Lizenz (Kündigung, Ablauf, Demo-Ende), bleiben alle Inhalte erhalten.
  - Die Bibliothek ist nicht zugänglich (lizenzpflichtig).
  - In der Kontoverwaltung sind die Anzahl der Inhalte und „Alle exportieren“ verfügbar.
- Nach einer Neubuchung ist alles sofort wieder da. Das deckt der Test „Lizenzende → Neukauf“ in DB-, Unit- und E2E-Tests ab.

## 6. Abonnement kündigen – Lizenzende – Konto schließen – Konto löschen

| Aktion | Wo | Wirkung |
|---|---|---|
| Abonnement kündigen | „Abonnement verwalten“ (Stripe-Portal) oder `/kuendigen` | Zugriff bis Laufzeitende, danach Lizenzende |
| Lizenzende | automatisch | Kein Simulatorzugriff. Konto und Inhalte bleiben. |
| Konto schließen | Konto → Daten und Datenschutz | Umkehrbar: `account_status = closed`, Nutzung gesperrt, Anmeldung, Export und Wiederöffnen möglich. `deletion_due_at = +12 Monate`. Nur ohne laufendes, ungekündigtes Abo. |
| Konto endgültig löschen | Konto → Daten und Datenschutz (Passwort + „LÖSCHEN“), Admin → Kontoschließung & Löschung | Sofort (siehe unten) |

Ablauf der endgültigen Löschung (Edge Function `delete-account`):

1. Der Benutzer-JWT muss frisch sein (höchstens 10 Minuten). Der Browser meldet sich dafür mit dem Passwort erneut an.
2. Es darf kein laufendes, ungekündigtes Abo bestehen (`OLA01`, Antwort 409).
3. `delete_account_data()` löscht Simulationen, Vorlagen, Einstellungen und das Profil.
   - Die Institution wird anonymisiert, sofern ihr kein weiterer Benutzer angehört.
   - Als Nachweis bleibt ein Eintrag in `deleted_accounts` (sha256 der E-Mail-Adresse, 3 Jahre). Die Klartext-Adresse wird dort nicht gespeichert.
4. Der Stripe-Kunde bleibt wegen der Rechnungs-Aufbewahrungspflicht bestehen und erhält nur die Markierung `metadata.account_deleted`.
5. Der Auth-Benutzer wird gelöscht und eine Bestätigungs-E-Mail an die bisherige Adresse gesendet.
6. Der Ablauf ist wiederholbar: Bricht ein Schritt ab, setzt ein erneuter Aufruf richtig fort.

**Aufbewahrung (Betreiberentscheidung vom 30.09.2026, Migration `20261002090000_account_retention.sql`):**
- Lizenzende und Kündigung sind **kein Löschwunsch**. Konto und Simulationen bleiben unbefristet erhalten, bis der Kunde schließt oder löscht.
- Die 12-Monats-Frist gilt nur für **ausdrücklich geschlossene** Konten.
  - `mail-jobs` erinnert 30 Tage vor Fristende per E-Mail (`account_deletion_reminder`).
  - Gelöscht wird frühestens 14 Tage nach erfolgreich versendeter Erinnerung, dann automatisch mit Auslöser `retention`.
  - Ohne funktionierenden E-Mail-Versand wird nie automatisch gelöscht.
  - Abschaltbar mit `ACCOUNT_AUTO_DELETE=off`.
- Das Admin-Center („Kontoschließung & Löschung“) zeigt drei getrennte Listen:
  - Lizenz abgelaufen
  - Konto geschlossen – Löschung fällig am [Datum], mit Erinnerungsstatus
  - Löschung beantragt (Anträge per E-Mail erfassen, zurücknehmen, ausführen)
- Rechnungen (Stripe), Zustimmungs-, Kündigungs- und Widerrufsnachweise und der Löschnachweis haben eigene Fristen. Siehe Datenschutzerklärung Ziffer 10.4.

## 7. „Abonnement verwalten“ (Customer Portal)

Wahrscheinliche Ursache des Fehlers:
- Stripe lehnt die Portal-Session ab, wenn im jeweiligen Modus (Test/Live) keine Portal-Konfiguration gespeichert ist: „No configuration provided and your test mode default configuration has not been created“.
- Ein weiterer möglicher Grund: Der gespeicherte Kunde existiert im aktuellen Modus nicht, z. B. ein Testkunde bei einem Live-Schlüssel.
- Die Function meldete das bisher pauschal mit 502.

Umsetzung jetzt:
1. Ohne Stripe-Kunde gibt die Function `404 no_customer` zurück, mit einem verständlichen Text. Der Button erscheint nur, wenn ein Kunde existiert und die Rolle `institution_admin` bzw. `super_admin` ist. Ohne Kunde erklärt ein Hinweis, wo Rechnungen und Kündigung zu finden sind.
2. Der Kunde wird per `GET customers/{id}` geprüft. Fehlt er oder ist er gelöscht, folgt `404 customer_missing`, und im Log steht der Hinweis auf eine Test/Live-Verwechslung.
3. Die Session wird mit `return_url = SITE_URL/account` und `locale = de` erstellt, optional mit `STRIPE_PORTAL_CONFIGURATION_ID`.
4. Fehlt die Portal-Konfiguration, legt `ensurePortalConfiguration()` einmalig eine an (Metadaten `olo=olo-lab3d-default`) und versucht es erneut. Die Konfiguration enthält Rechnungen, Zahlungsmittel, Rechnungsdaten und Kündigung zum Periodenende; ein Tarifwechsel im Portal ist aus.
5. Die Meldungen: `503 portal_not_configured` bzw. `502 stripe_error` mit verständlichem Text. Die Seite zeigt sie direkt unter dem Button an.
