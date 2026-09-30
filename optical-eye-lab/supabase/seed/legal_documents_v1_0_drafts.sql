-- =====================================================================================================
-- OLO-LAB3D – Rechtstexte Version 1.0 als ENTWÜRFE (erzeugt mit: node scripts/legal-seed.mjs)
--
-- Voraussetzung: Migration 20260930090000_legal_operations.sql (Dokumenttyp „imprint“) ist eingespielt.
-- Ausführen im Supabase SQL-Editor. Es wird NICHTS veröffentlicht und NICHTS überschrieben:
-- vorhandene Versionen (Typ + Zielgruppe + Version) werden übersprungen und als Hinweis gemeldet.
-- Danach im Vertragscenter (Admin → Rechtliches) prüfen, [Prüfhinweis]-Markierungen klären/entfernen
-- und erst dann veröffentlichen. Die Veröffentlichung lehnt Entwürfe mit [Prüfhinweis] ab.
-- =====================================================================================================
do $seed$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select * from (values
      -- 01_impressum.md (6f39c6c93b02)
      ('imprint', 'all', '1.0', $olo$Impressum$olo$, null, $olo$## Anbieter

**OLO Vision**
Inhaber: Jonas Karol Lingener
Forsthausstraße 14
66709 Weiskirchen
Deutschland

## Kontakt

E-Mail: info@olo-vision.de
Postanschrift: siehe oben

[Prüfhinweis: Neben der E-Mail-Adresse ist ein weiterer schneller, unmittelbarer Kommunikationsweg empfehlenswert (z. B. Telefonnummer oder Kontaktformular). Die Rechtsprechung verlangt nicht zwingend eine Telefonnummer; eine Ergänzung erhöht aber die Sicherheit.]

## Umsatzsteuer

Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz: DE464512585

## Angebot

OLO-LAB3D ist eine browserbasierte Simulations- und Lernsoftware für Augenoptik und optische Anwendungen, erreichbar unter https://olo-lab.de.

## Verbraucherstreitbeilegung

OLO Vision ist nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
$olo$),
      -- 02_agb.md (11feafd45185)
      ('terms', 'all', '1.0', $olo$Allgemeine Geschäftsbedingungen$olo$, $olo$Ich habe die {link} gelesen und akzeptiere sie.$olo$, $olo$## 1. Geltungsbereich und Anbieter

1.1 Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge über die Nutzung der Software OLO-LAB3D zwischen OLO Vision, Inhaber Jonas Karol Lingener, Forsthausstraße 14, 66709 Weiskirchen, E-Mail: info@olo-vision.de (nachfolgend „OLO Vision“ oder „wir“) und ihren Kundinnen und Kunden (nachfolgend „Kunde“).

1.2 Kunden können Verbraucher im Sinne des § 13 BGB (Tarif **Private**) oder Unternehmer im Sinne des § 14 BGB bzw. Bildungseinrichtungen (Tarife **Business** und **Education**) sein. Für Unternehmer und Bildungseinrichtungen gelten ergänzend die **B2B-Zusatzbedingungen**, die diesen AGB im Fall von Abweichungen vorgehen.

1.3 Der Umfang der Nutzungsrechte, die Regeln zur Demo und die Nutzungsregeln im Einzelnen ergeben sich aus den **Lizenz- und Nutzungsbedingungen**, die Bestandteil jedes Vertrags sind.

1.4 Abweichende Bedingungen des Kunden gelten nur, wenn OLO Vision ihnen ausdrücklich schriftlich zustimmt.

## 2. Leistungsgegenstand

2.1 OLO-LAB3D ist eine browserbasierte Simulations- und Lernsoftware für Augenoptik und optische Anwendungen. Sie enthält unter anderem Simulationen und Module zu Brillengläsern, Refraktion, Skiaskopie, Patientensicht und Kontaktlinsen sowie weitere optische Lern- und Simulationsfunktionen. Die Software wird als Online-Dienst über das Internet bereitgestellt (Software as a Service); eine Installation oder Überlassung der Software auf einem Datenträger findet nicht statt.

2.2 Der jeweils aktuelle Funktionsumfang ist unter https://olo-lab.de beschrieben. OLO Vision entwickelt OLO-LAB3D weiter; Änderungen richten sich nach Ziffer 11.

2.3 Voraussetzung für die Nutzung sind ein aktueller Webbrowser mit WebGL-Unterstützung, ein Endgerät mit ausreichender Grafikleistung und eine Internetverbindung. Für diese Voraussetzungen ist der Kunde selbst verantwortlich.

2.4 OLO-LAB3D dient der Simulation, Ausbildung, Schulung und Veranschaulichung. Es ist **kein Medizinprodukt** und nicht für die medizinische Diagnose, Therapieentscheidungen oder die eigenständige Versorgung von Patientinnen und Patienten bestimmt.

## 3. Kundenkonto

3.1 Die Nutzung setzt ein Kundenkonto voraus. Bei der Registrierung wählt der Kunde den Kundentyp (Privatperson, Unternehmen oder Bildungseinrichtung). Die Angaben müssen vollständig und wahrheitsgemäß sein und bei Änderungen aktualisiert werden.

3.2 Mit der Registrierung kommt ein unentgeltlicher Vertrag über die Nutzung des Kundenkontos und – einmalig – der kostenlosen Demo zustande. Ein kostenpflichtiger Vertrag entsteht dadurch nicht.

3.3 Der gebuchte Tarif muss zum Kundentyp passen (Private für Privatpersonen, Business für Unternehmen, Education für Bildungseinrichtungen).

## 4. Kostenlose Demo

4.1 Jedes Kundenkonto kann OLO-LAB3D **einmalig für 2 Stunden** kostenlos mit vollem Funktionsumfang testen. Die Demo beginnt mit dem Klick auf „Demo starten“ und endet automatisch nach 2 Stunden.

4.2 Für die Demo sind keine Zahlungsdaten erforderlich. Sie geht **nicht automatisch in ein kostenpflichtiges Abonnement über** und begründet keine Zahlungspflicht. Nach Ablauf besteht für dasselbe Kundenkonto kein erneuter Anspruch auf eine Demo.

## 5. Vertragsschluss und Bestellablauf

5.1 Die Darstellung der Tarife auf der Website und in der Anwendung ist kein rechtlich bindendes Angebot, sondern eine Aufforderung zur Bestellung.

5.2 Der Bestellablauf besteht aus folgenden Schritten:

1. Auswahl des Tarifs und des Abrechnungsintervalls (monatlich oder jährlich).
2. Anmeldung bzw. Registrierung im Kundenkonto.
3. Übersicht „Bestellung prüfen“ mit Tarif, Preis, Abrechnungsintervall und Laufzeit sowie Bestätigung der erforderlichen Vertragsdokumente.
4. Weiterleitung zum Zahlungsdienstleister Stripe mit Klick auf „Weiter zur sicheren Zahlung“. Dieser Klick löst noch keine Zahlungspflicht aus.
5. Eingabe der Zahlungs- und Rechnungsdaten auf der Bestellseite von Stripe.
6. Abgabe der verbindlichen Bestellung durch Klick auf die Schaltfläche **„Abonnieren“** auf der Stripe-Bestellseite.

5.3 Mit dem Klick auf „Abonnieren“ gibt der Kunde ein verbindliches Angebot zum Abschluss eines kostenpflichtigen Abonnements ab. Der Vertrag kommt zustande, sobald die Zahlung erfolgreich bestätigt und die Lizenz freigeschaltet ist; der Zugang steht unmittelbar danach zur Verfügung. Wird die Zahlung nicht bestätigt, kommt kein Vertrag zustande.

[Prüfhinweis: Ob die von Stripe vorgegebene Beschriftung „Abonnieren“ den Anforderungen an eine eindeutige Bestellschaltfläche (§ 312j Abs. 3 BGB) genügt, sollte anwaltlich geprüft werden. Die Anwendung weist im Bestelldialog und direkt am Stripe-Button zusätzlich auf die Zahlungspflicht hin.]

5.4 Bis zum Klick auf „Abonnieren“ kann der Kunde seine Eingaben jederzeit korrigieren: Tarif und Intervall im Dialog „Bestellung prüfen“ bzw. über „Abbrechen“, Zahlungs- und Rechnungsdaten direkt in den Eingabefeldern der Stripe-Bestellseite. Über den Zurück-Link auf der Stripe-Bestellseite gelangt der Kunde ohne Bestellung zurück zu OLO-LAB3D.

5.5 Nach Vertragsschluss erhält der Kunde eine Vertragsbestätigung per E-Mail mit den wesentlichen Vertragsdaten und den bei der Bestellung akzeptierten Vertragsdokumenten. Die Zahlungsbelege bzw. Rechnungen versendet Stripe im Auftrag von OLO Vision.

## 6. Preise und Zahlung

6.1 Es gelten die zum Zeitpunkt der Bestellung angezeigten Preise. Alle Preise sind **Endpreise inklusive 19 % Umsatzsteuer**. Derzeit gelten:

- Private: 19,90 € pro Monat oder 199,00 € für 12 Monate
- Business: 39,90 € pro Monat oder 399,00 € pro Jahr
- Education: 99,90 € pro Monat oder 999,00 € pro Jahr

6.2 Die Vergütung ist jeweils **im Voraus** zu Beginn jedes Abrechnungszeitraums fällig. Die Zahlung erfolgt über den Zahlungsdienstleister Stripe mit einer der im Stripe-Checkout angebotenen Zahlungsarten. Der Kunde ermächtigt OLO Vision bzw. Stripe, die fälligen Beträge über das hinterlegte Zahlungsmittel einzuziehen.

6.3 Preisänderungen gelten nur für neue Buchungen. Eine Preisänderung für ein laufendes Abonnement erfolgt nicht einseitig, sondern nur nach vorheriger Information und mit Zustimmung des Kunden bzw. durch eine neue Buchung.

## 7. Laufzeit, Verlängerung und Kündigung

7.1 **Monatliche Abonnements (alle Tarife)** laufen auf unbestimmte Zeit und verlängern sich jeweils um einen weiteren Monat. Sie können jederzeit zum Ende des laufenden Abrechnungsmonats gekündigt werden.

7.2 **Private – 12 Monate:** Die Laufzeit beträgt 12 Monate ab Vertragsschluss. Der Vertrag **endet automatisch** mit Ablauf der 12 Monate, ohne dass es einer Kündigung bedarf; eine automatische Verlängerung und eine erneute Abbuchung finden nicht statt. Für eine weitere Nutzung ist eine neue Buchung erforderlich. OLO Vision erinnert den Kunden vor Ablauf per E-Mail.

7.3 **Business und Education – jährlich:** Die Laufzeit beträgt 12 Monate und verlängert sich jeweils um weitere 12 Monate, wenn der Vertrag nicht bis zum Ende der laufenden Laufzeit gekündigt wird. Eine zusätzliche Kündigungsfrist besteht nicht.

7.4 Nach einer Kündigung bleibt der Zugang bis zum Ende des bereits bezahlten Abrechnungszeitraums bestehen. Eine anteilige Erstattung bereits bezahlter Zeiträume erfolgt bei einer ordentlichen Kündigung nicht, soweit gesetzlich nichts anderes bestimmt ist. Gesetzliche Rechte, insbesondere das Widerrufsrecht für Verbraucher, bleiben unberührt.

7.5 Die Kündigung kann erklärt werden
- über die Schaltfläche **„Verträge hier kündigen“** unter https://olo-lab.de/kuendigen (ohne vorherige Anmeldung erreichbar),
- im Kundenkonto über „Abonnement verwalten“,
- per E-Mail an info@olo-vision.de oder
- per Post an die oben genannte Anschrift.

Der Kunde erhält eine Bestätigung der Kündigung mit dem Zeitpunkt, zu dem der Vertrag endet, per E-Mail.

7.6 Das Recht beider Parteien zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.

## 8. Zahlungsstörungen

8.1 Schlägt eine fällige Zahlung fehl, informiert OLO Vision bzw. Stripe den Kunden. Der Zugang bleibt für eine **Frist von 7 Tagen** bestehen, in der Stripe den Einzug erneut versucht und der Kunde das Zahlungsmittel über „Abonnement verwalten“ aktualisieren kann.

8.2 Ist die Zahlung nach Ablauf dieser Frist nicht erfolgt, wird der Zugang **gesperrt**. Nach erfolgreicher Zahlung wird der Zugang automatisch wieder freigeschaltet. Zusätzliche Mahngebühren erhebt OLO Vision derzeit nicht.

8.3 Die gesetzlichen Rechte von OLO Vision bei Zahlungsverzug, einschließlich des Rechts zur Kündigung aus wichtigem Grund, bleiben unberührt.

## 9. Widerrufsrecht für Verbraucher

Verbrauchern steht ein gesetzliches Widerrufsrecht zu. Einzelheiten ergeben sich aus der **Widerrufsbelehrung**, die dem Kunden vor der Bestellung angezeigt wird. Der Widerruf kann auch über die Schaltfläche **„Vertrag widerrufen“** unter https://olo-lab.de/widerrufen erklärt werden.

## 10. Verfügbarkeit, Wartung und Support

10.1 OLO Vision bemüht sich um eine möglichst unterbrechungsfreie Verfügbarkeit von OLO-LAB3D. Eine bestimmte Verfügbarkeit wird nicht zugesagt. Wartungsarbeiten und technisch notwendige Unterbrechungen sind möglich und werden nach Möglichkeit vorab angekündigt. Die gesetzlichen Rechte des Kunden bei Mängeln bleiben unberührt.

10.2 Support erfolgt per E-Mail an info@olo-vision.de. Anfragen werden innerhalb angemessener Zeit bearbeitet; eine bestimmte Reaktionszeit wird nicht zugesagt.

## 11. Aktualisierungen und Änderungen der Software

11.1 OLO Vision stellt Aktualisierungen bereit, die für den Erhalt der Vertragsmäßigkeit erforderlich sind, insbesondere Sicherheitsaktualisierungen.

11.2 Darüber hinaus darf OLO Vision die Software aus triftigem Grund ändern, etwa zur Anpassung an eine neue technische Umgebung, an geänderte Rechtslage oder zur Weiterentwicklung, sofern dem Kunden dadurch keine zusätzlichen Kosten entstehen und er klar und verständlich über die Änderung informiert wird. Beeinträchtigt eine Änderung die Nutzbarkeit für einen Verbraucher mehr als unerheblich, wird er rechtzeitig vorab informiert und kann den Vertrag nach Maßgabe von § 327r BGB innerhalb von 30 Tagen unentgeltlich beenden.

[Prüfhinweis: Änderungsvorbehalt für digitale Produkte (§ 327r BGB) – Formulierung anwaltlich prüfen lassen.]

## 12. Mängelrechte

Es gelten die gesetzlichen Mängelrechte. Für Verbraucher gelten insbesondere die Vorschriften über Verträge über digitale Produkte (§§ 327 ff. BGB). Für Unternehmer und Bildungseinrichtungen gelten ergänzend die B2B-Zusatzbedingungen.

## 13. Haftung

13.1 OLO Vision haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei der Verletzung des Lebens, des Körpers oder der Gesundheit, bei Übernahme einer Garantie sowie nach dem Produkthaftungsgesetz.

13.2 Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht (einer Pflicht, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf deren Einhaltung der Kunde regelmäßig vertrauen darf) ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt.

13.3 Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.

13.4 Simulationen, eigene Vorlagen und Einstellungen speichert OLO-LAB3D im Kundenkonto auf Servern in der EU; sie stehen nach der Anmeldung auf jedem unterstützten Gerät zur Verfügung. Endet der Vertrag, bleiben die gespeicherten Inhalte erhalten, solange das Kundenkonto besteht (Ziffer 13 der Lizenz- und Nutzungsbedingungen), und können nach einer erneuten Buchung weiter genutzt werden; lesen und exportieren ist auch ohne aktive Lizenz möglich. OLO Vision schuldet keine gesonderte Datensicherung für den Kunden; es wird empfohlen, wichtige Arbeiten zusätzlich über die Exportfunktion zu sichern. Die Haftung nach Ziffer 13.1 bleibt unberührt.

[Prüfhinweis: Formulierung zur Datensicherung nach Umstellung auf die Cloud-Speicherung (Version 0.10) anwaltlich prüfen lassen.]

## 14. Speicherung des Vertragstexts und Vertragssprache

14.1 OLO Vision speichert den Vertragstext. Die bei der Bestellung akzeptierten Vertragsdokumente werden mit Versionsnummer gespeichert und dem Kunden mit der Vertragsbestätigung per E-Mail übersandt. Die jeweils aktuellen Fassungen sind jederzeit unter https://olo-lab.de abrufbar.

14.2 Vertragssprache ist Deutsch.

## 15. Streitbeilegung

OLO Vision ist nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.

## 16. Schlussbestimmungen

16.1 Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Gegenüber Verbrauchern gilt diese Rechtswahl nur, soweit dadurch nicht der Schutz entzogen wird, der durch zwingende Bestimmungen des Rechts des Staates gewährt wird, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat.

16.2 Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.
$olo$),
      -- 03_lizenzbedingungen.md (83c7b7827232)
      ('license_terms', 'all', '1.0', $olo$Lizenz- und Nutzungsbedingungen$olo$, $olo$Ich akzeptiere die {link} und bestätige, mindestens 18 Jahre alt zu sein oder mit Zustimmung meiner gesetzlichen Vertreter zu handeln.$olo$, $olo$Diese Bedingungen regeln, wer OLO-LAB3D wie nutzen darf. Sie gelten für jedes Kundenkonto, die kostenlose Demo und alle Tarife. Anbieter ist OLO Vision, Inhaber Jonas Karol Lingener, Forsthausstraße 14, 66709 Weiskirchen, E-Mail: info@olo-vision.de.

## 1. Kundenkonto und Zugangsdaten

1.1 Für die Nutzung ist ein Kundenkonto erforderlich. Zu jedem Kundenkonto gehört derzeit **ein Login** (E-Mail-Adresse und Passwort). Ein System für mehrere persönliche Logins je Kundenkonto besteht derzeit nicht.

1.2 Der Kunde hält seine Zugangsdaten geheim und schützt sie vor dem Zugriff unberechtigter Dritter. Eine Weitergabe ist nur in dem in Ziffer 4 und 5 ausdrücklich erlaubten Umfang zulässig. Besteht der Verdacht eines Missbrauchs, ändert der Kunde sein Passwort unverzüglich und informiert OLO Vision.

1.3 Privatkunden müssen mindestens 18 Jahre alt sein. Minderjährige dürfen ein Kundenkonto nur mit der erforderlichen Zustimmung ihrer gesetzlichen Vertreter anlegen und nutzen.

## 2. Allgemeines Nutzungsrecht

2.1 OLO Vision räumt dem Kunden für die Dauer des Vertrags ein einfaches, nicht übertragbares und nicht unterlizenzierbares Recht ein, OLO-LAB3D über den Browser im Rahmen des gebuchten Tarifs und dieser Bedingungen zu nutzen.

2.2 Alle Rechte an OLO-LAB3D, insbesondere an Software, Quellcode, Simulationsmodellen, Inhalten, Darstellungen, Marken und Designs, verbleiben bei OLO Vision bzw. den jeweiligen Rechteinhabern.

## 3. Tarif Private

3.1 Der Tarif Private erlaubt die Nutzung **ausschließlich für persönliche, nicht unternehmerische Zwecke**, insbesondere zum Lernen, zur Aus- und Weiterbildung und zur persönlichen Veranschaulichung.

3.2 Die Nutzung im Rahmen einer gewerblichen oder selbstständigen Tätigkeit, insbesondere in einem Augenoptikbetrieb, ist mit dem Tarif Private nicht erlaubt; hierfür ist der Tarif Business erforderlich.

3.3 Die Zugangsdaten sind persönlich und dürfen nicht an andere Personen weitergegeben werden.

## 4. Tarif Business

4.1 Eine Business-Lizenz gilt für **eine Betriebsstätte unter einer konkreten Geschäftsanschrift** (lizenzierter Standort). Maßgeblich ist die bei der Registrierung angegebene Anschrift.

4.2 Die Lizenz darf von den Inhabern und Mitarbeitenden des lizenzierten Standorts für betriebliche Zwecke genutzt werden, insbesondere für Beratung, Ausbildung und Schulung. Solange je Kundenkonto nur ein Login besteht, dürfen die Zugangsdaten innerhalb des lizenzierten Standorts an berechtigte Mitarbeitende weitergegeben werden.

4.3 Die Nutzung durch Mitarbeitende von außerhalb des Standorts, etwa im Homeoffice, ist zulässig, solange sie eindeutig dem lizenzierten Standort zugeordnet ist. Sie begründet keinen zusätzlichen Standort.

4.4 Nicht erlaubt sind die Nutzung und die Weitergabe der Zugangsdaten
- für weitere Filialen oder Betriebsstätten,
- für andere, rechtlich selbstständige Unternehmen, auch innerhalb einer Unternehmensgruppe,
- an externe Personen oder sonstige nicht berechtigte Dritte.

4.5 Für jeden weiteren Standort ist eine zusätzliche Lizenz erforderlich. Für mehrere Standorte erstellt OLO Vision auf Anfrage an info@olo-vision.de ein individuelles Angebot.

## 5. Tarif Education

5.1 Eine Education-Lizenz gilt für **eine Schule bzw. Bildungseinrichtung an einem Bildungsstandort** (lizenzierter Standort). Maßgeblich ist die bei der Registrierung angegebene Anschrift.

5.2 Die Lizenz darf von Lehrkräften, Ausbildenden und Mitarbeitenden der lizenzierten Einrichtung für Unterricht, Ausbildung und deren Vorbereitung genutzt werden, auch von zu Hause, soweit die Nutzung eindeutig der lizenzierten Einrichtung zugeordnet ist. Solange je Kundenkonto nur ein Login besteht, dürfen diese berechtigten Personen den Login gemeinsam nutzen.

5.3 Lernende der lizenzierten Einrichtung dürfen OLO-LAB3D im Rahmen von Unterricht und Ausbildung unter Anleitung bzw. in Verantwortung einer Lehrkraft nutzen. Die Zugangsdaten dürfen an Lernende nicht weitergegeben werden. Eine eigenständige Nutzung durch Lernende, etwa von zu Hause, ist erst mit persönlichen Zugängen möglich, sofern OLO Vision diese anbietet.

5.4 Die Einrichtung stellt sicher, dass die Zugangsdaten nur berechtigten Lehrkräften, Ausbildenden und Mitarbeitenden zugänglich sind, und ändert das Passwort, wenn eine dieser Personen nicht mehr berechtigt ist (z. B. nach dem Ausscheiden).

5.5 Nicht erlaubt sind die Nutzung für weitere Standorte, für andere Einrichtungen oder Träger sowie die Weitergabe der Zugangsdaten an externe Personen oder sonstige nicht berechtigte Dritte. Ziffer 4.5 gilt entsprechend.

## 6. Unzulässige Nutzung

Dem Kunden und allen Nutzenden ist insbesondere untersagt,
- OLO-LAB3D, den Quellcode oder wesentliche Bestandteile zu kopieren, weiterzugeben, zu vermieten, zu verkaufen oder anderweitig zu vermarkten,
- die Software zu dekompilieren, zu disassemblieren oder anderweitig zurückzuentwickeln, soweit dies nicht nach § 69e UrhG ausnahmsweise erlaubt ist,
- technische Schutz- oder Zugangsbeschränkungen (einschließlich der Begrenzung der Demo) zu umgehen,
- die Software automatisiert auszulesen oder übermäßig zu belasten,
- Zugangsdaten außerhalb des lizenzierten Nutzungsbereichs zu teilen,
- die Software für rechtswidrige Zwecke zu nutzen.

## 7. Screenshots und Arbeitsergebnisse

7.1 Screenshots, Bildschirmaufnahmen und Simulationsergebnisse aus OLO-LAB3D dürfen im Rahmen des jeweiligen Tarifs für interne Schulungen, Unterricht, Präsentationen und eigene fachliche Inhalte verwendet werden. Bei einer Veröffentlichung ist nach Möglichkeit „OLO-LAB3D“ als Quelle anzugeben.

7.2 Nicht erlaubt ist, auf diesem Weg die Software selbst oder wesentliche Teile davon nachzubilden, weiterzugeben oder zu vermarkten.

## 8. Kostenlose Demo

8.1 Jedes Kundenkonto kann OLO-LAB3D **einmalig für 2 Stunden** mit vollem Funktionsumfang kostenlos testen. Die Demo kann nur vom Kundenkonto selbst gestartet werden und läuft ab dem Start ununterbrochen; Unterbrechungen der Nutzung verlängern sie nicht.

8.2 Für die Demo sind keine Zahlungsdaten erforderlich. Sie endet automatisch und geht **nicht in ein kostenpflichtiges Abonnement über**. Eine Zahlungspflicht entsteht erst durch eine gesonderte Bestellung.

8.3 Nach Ablauf besteht für dasselbe Kundenkonto kein erneuter Demoanspruch. Das Anlegen weiterer Kundenkonten allein zu dem Zweck, die Demo mehrfach zu nutzen, ist nicht gestattet.

8.4 Während der Demo gelten die Nutzungsregeln des zum Kundentyp passenden Tarifs.

## 9. Speicherung von Simulationen im Kundenkonto

9.1 Simulationen, eigene Vorlagen und Einstellungen werden im **Kundenkonto** gespeichert (Server in der EU) und stehen nach der Anmeldung auf jedem unterstützten Gerät zur Verfügung. Nur gerätebezogene Darstellungseinstellungen (z. B. Grafikqualität, Panelbreiten) und nicht gespeicherte Zwischenstände zur Absturzsicherung verbleiben im Browser des jeweiligen Geräts.

9.2 Die Inhalte sind an das Kundenkonto gebunden, nicht an die Lizenz. Endet die Lizenz, bleiben sie erhalten; sie können weiterhin angesehen und exportiert, aber erst nach einer erneuten Buchung wieder bearbeitet werden.

9.3 Wird dieselbe Simulation gleichzeitig auf mehreren Geräten bearbeitet, weist OLO-LAB3D vor dem Überschreiben eines neueren Stands darauf hin und bietet an, den eigenen Stand als Kopie zu speichern.

9.4 Es wird empfohlen, wichtige Arbeiten zusätzlich über die Exportfunktion zu sichern.

## 10. Verfügbarkeit und Wartung

OLO Vision bemüht sich um eine möglichst unterbrechungsfreie Verfügbarkeit. Eine bestimmte Verfügbarkeit wird nicht zugesagt. Wartungsarbeiten und technisch notwendige Unterbrechungen sind möglich und werden nach Möglichkeit vorab angekündigt.

## 11. Kein Medizinprodukt

OLO-LAB3D dient der Simulation, Ausbildung, Schulung und Veranschaulichung. Die dargestellten Ergebnisse beruhen auf vereinfachten physikalischen Modellen. OLO-LAB3D ist **kein Medizinprodukt** und nicht für die medizinische Diagnose, Therapieentscheidungen oder die eigenständige Versorgung von Patientinnen und Patienten bestimmt. Fachliche Entscheidungen trifft stets die fachkundige Person in eigener Verantwortung.

## 12. Maßnahmen bei Verstößen

Verstößt der Kunde gegen diese Bedingungen, kann OLO Vision den Zugang nach vorheriger Abmahnung vorübergehend sperren, sofern dies zur Beendigung des Verstoßes angemessen ist. Bei schwerwiegenden Verstößen, insbesondere bei einer unerlaubten Weitergabe von Zugangsdaten oder der Umgehung von Schutzmaßnahmen, ist eine Sperrung auch ohne vorherige Abmahnung möglich. Das Recht zur Kündigung aus wichtigem Grund bleibt unberührt.

[Prüfhinweis: Die Voraussetzungen der Sperrung ohne Abmahnung sollten insbesondere gegenüber Verbrauchern anwaltlich geprüft werden.]

## 13. Ende der Nutzung

13.1 Mit Ende des Vertrags bzw. der Demo endet das Nutzungsrecht. Das Ende des Vertrags ist **kein Löschgrund**: Das Kundenkonto und die gespeicherten Inhalte bleiben bestehen, bis der Kunde das Konto schließt oder löscht. Eine erneute Buchung stellt die gespeicherten Inhalte wieder zur Bearbeitung bereit.

13.2 Der Kunde kann sein Konto in der Kontoverwaltung **schließen**: Die Nutzung ruht, die Inhalte bleiben 12 Monate ab der Schließung erhalten und das Konto kann in dieser Zeit wieder geöffnet werden. Etwa 30 Tage vor Ablauf erhält der Kunde eine Erinnerung per E-Mail; danach wird das Konto mit allen Inhalten automatisch gelöscht, frühestens 14 Tage nach der Erinnerung.

13.3 Der Kunde kann sein Konto in der Kontoverwaltung jederzeit **endgültig löschen**. Konto, Simulationen, Vorlagen und Einstellungen werden dabei sofort und unwiderruflich gelöscht; gesetzlich aufzubewahrende Rechnungs- und Vertragsnachweise bleiben bis zum Ende der Aufbewahrungsfrist gespeichert. Ein laufendes, nicht gekündigtes Abonnement ist vorher zu kündigen.
$olo$),
      -- 04_b2b_bedingungen.md (2243c1b7e891)
      ('b2b_terms', 'b2b', '1.0', $olo$B2B-Zusatzbedingungen$olo$, $olo$Ich bestelle für ein Unternehmen bzw. eine Bildungseinrichtung und akzeptiere die {link}.$olo$, $olo$## 1. Geltungsbereich

1.1 Diese Zusatzbedingungen gelten für Verträge über die Tarife **Business** und **Education** mit Unternehmern im Sinne des § 14 BGB, juristischen Personen des öffentlichen Rechts und öffentlich-rechtlichen Sondervermögen sowie mit Schulen und sonstigen Bildungseinrichtungen, die den Vertrag in Ausübung ihrer beruflichen, gewerblichen oder öffentlichen Tätigkeit schließen (nachfolgend „B2B-Kunde“).

1.2 Sie ergänzen die AGB sowie die Lizenz- und Nutzungsbedingungen von OLO Vision. Bei Widersprüchen gehen diese Zusatzbedingungen vor.

1.3 Mit der Bestellung bestätigt der B2B-Kunde, nicht als Verbraucher zu handeln. Die für Verbraucher geltenden Regelungen der AGB, insbesondere zum Widerrufsrecht, finden keine Anwendung.

1.4 Die für den B2B-Kunden handelnde Person versichert, zur Bestellung berechtigt zu sein.

## 2. Standort und Nutzungsumfang

2.1 Jede Lizenz gilt für **einen Standort**: bei Business für eine Betriebsstätte unter einer konkreten Geschäftsanschrift, bei Education für eine Schule bzw. Bildungseinrichtung an einem Bildungsstandort. Maßgeblich ist die bei der Registrierung angegebene Anschrift. Änderungen teilt der B2B-Kunde OLO Vision unverzüglich mit.

2.2 Die Einzelheiten zur Nutzung durch Mitarbeitende, Lehrkräfte und Lernende sowie zur Weitergabe von Zugangsdaten regeln die Lizenz- und Nutzungsbedingungen.

2.3 Weitere Standorte, Filialen oder rechtlich selbstständige Unternehmen bzw. Einrichtungen benötigen jeweils eine eigene Lizenz. Für mehrere Standorte erstellt OLO Vision auf Anfrage an info@olo-vision.de ein individuelles Angebot.

2.4 Der B2B-Kunde stellt sicher, dass alle Personen, denen er den Zugang ermöglicht, die Lizenz- und Nutzungsbedingungen einhalten. Er haftet für deren Verstöße wie für eigenes Handeln, soweit er diese zu vertreten hat.

## 3. Buchung, Rechnung und Umsatzsteuer

3.1 Buchungen über die Anwendung sind derzeit nur mit einer **Rechnungsanschrift in Deutschland** möglich. B2B-Kunden mit Sitz außerhalb Deutschlands wenden sich bitte an info@olo-vision.de.

3.2 Alle Preise verstehen sich einschließlich 19 % deutscher Umsatzsteuer. Die Rechnung wird über den Zahlungsdienstleister Stripe erstellt und per E-Mail übermittelt. Der B2B-Kunde ist mit der elektronischen Übermittlung von Rechnungen einverstanden.

3.3 Der B2B-Kunde ist für die Richtigkeit der Rechnungsangaben (Name, Anschrift, gegebenenfalls USt-IdNr.) verantwortlich.

## 4. Laufzeit und Kündigung

4.1 Monatliche Abonnements können jederzeit zum Ende des laufenden Abrechnungsmonats gekündigt werden.

4.2 Jährliche Abonnements verlängern sich jeweils um weitere 12 Monate, wenn sie nicht bis zum Ende der laufenden Laufzeit gekündigt werden. Eine zusätzliche Kündigungsfrist besteht nicht.

4.3 Eine Erstattung bereits bezahlter Zeiträume erfolgt bei einer ordentlichen Kündigung nicht.

## 5. Mängel

5.1 Der B2B-Kunde teilt erkennbare Mängel möglichst genau beschrieben per E-Mail an info@olo-vision.de mit.

5.2 Eine verschuldensunabhängige Haftung von OLO Vision für Mängel, die bereits bei Vertragsschluss vorhanden waren (§ 536a Abs. 1 Alt. 1 BGB), ist ausgeschlossen. Die Haftung nach Ziffer 6 bleibt unberührt.

[Prüfhinweis: Ausschluss der verschuldensunabhängigen Anfangshaftung ist im B2B-Bereich üblich; die Wirksamkeit für die konkrete Vertragsgestaltung (Einordnung SaaS als Miet- oder Dienstvertrag) anwaltlich prüfen lassen.]

## 6. Haftung

6.1 OLO Vision haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei der Verletzung des Lebens, des Körpers oder der Gesundheit, bei Übernahme einer Garantie sowie nach dem Produkthaftungsgesetz.

6.2 Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht ist die Haftung auf den vertragstypischen, bei Vertragsschluss vorhersehbaren Schaden begrenzt. Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.

6.3 Für den Verlust von Daten haftet OLO Vision im Rahmen der vorstehenden Regelungen nur in dem Umfang, der auch bei ordnungsgemäßer Datensicherung durch den B2B-Kunden eingetreten wäre. Simulationen werden im Kundenkonto gespeichert (Ziffer 9 der Lizenzbedingungen); eine gesonderte Datensicherung für den B2B-Kunden schuldet OLO Vision nicht.

[Prüfhinweis: Eine zusätzliche summenmäßige Haftungshöchstgrenze (z. B. auf die Vergütung der letzten 12 Monate) wurde bewusst nicht aufgenommen, weil pauschale Höchstbeträge in AGB auch gegenüber Unternehmern häufig unwirksam sind. Ob und in welcher Höhe eine Höchstgrenze angemessen ist, sollte anwaltlich geprüft werden.]

## 7. Datenschutz

7.1 OLO Vision verarbeitet die Daten des Kundenkontos (insbesondere Name und E-Mail-Adresse der registrierenden Person, Einrichtungs- und Rechnungsdaten) als Verantwortlicher; Einzelheiten ergeben sich aus der Datenschutzerklärung.

7.2 Simulationen, Vorlagen und Einstellungen werden im Kundenkonto gespeichert. Sie sollen keine personenbezogenen Daten Dritter (z. B. Namen von Kundinnen, Patienten oder Lernenden) enthalten. Soweit OLO Vision im Auftrag des B2B-Kunden personenbezogene Daten verarbeitet, schließen die Parteien auf Anfrage einen Vertrag über die Auftragsverarbeitung nach Art. 28 DSGVO.

[Prüfhinweis: Mit der Cloud-Speicherung (Version 0.10) können Kunden frei benannte Inhalte ablegen. Prüfen lassen, ob ein AV-Vertrag standardmäßig angeboten werden sollte.]

[Prüfhinweis: Die Rollenverteilung (Verantwortlicher / Auftragsverarbeiter), insbesondere bei öffentlichen Schulen und bei gemeinsamer Nutzung eines Logins, anwaltlich bzw. datenschutzrechtlich prüfen lassen.]

## 8. Schlussbestimmungen

Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.
$olo$),
      -- 05_datenschutz.md (0db59d62cc49)
      ('privacy', 'all', '1.0', $olo$Datenschutzerklärung$olo$, $olo$Ich habe die {link} zur Kenntnis genommen.$olo$, $olo$## 1. Verantwortlicher

Verantwortlich für die Verarbeitung personenbezogener Daten im Zusammenhang mit OLO-LAB3D und der Website https://olo-lab.de ist:

**OLO Vision**
Inhaber: Jonas Karol Lingener
Forsthausstraße 14
66709 Weiskirchen
E-Mail: info@olo-vision.de

Ein Datenschutzbeauftragter ist nicht bestellt, da hierzu keine gesetzliche Pflicht besteht. Anfragen zum Datenschutz richten Sie bitte an info@olo-vision.de.

## 2. Überblick

OLO-LAB3D ist eine browserbasierte Simulations- und Lernsoftware. Wir verarbeiten nur die Daten, die für Kundenkonto, Lizenz, Zahlung, Nachweise und den sicheren Betrieb erforderlich sind. Wir setzen **keine Analyse-, Tracking-, Werbe- oder Chatdienste** ein und binden keine externen Schriftarten oder Inhalte Dritter ein.

Ihre **Simulationen, Vorlagen und Einstellungen** werden in Ihrem Kundenkonto gespeichert, damit sie Ihnen auf jedem Gerät zur Verfügung stehen (siehe Ziffer 9).

## 3. Aufruf der Website und Hosting

3.1 Beim Aufruf von OLO-LAB3D verarbeiten unsere Hosting-Dienstleister technisch notwendige Verbindungsdaten, insbesondere IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, übertragene Datenmenge, Browser- und Betriebssysteminformationen sowie die zuvor besuchte Seite (Server-Logdaten). Diese Daten sind erforderlich, um die Anwendung auszuliefern und ihre Sicherheit zu gewährleisten.

3.2 Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der sicheren und stabilen Bereitstellung der Anwendung. Die Logdaten werden von den Dienstleistern nach deren Vorgaben automatisch gelöscht.

3.3 Die Oberfläche von OLO-LAB3D wird über **Netlify** (Netlify, Inc., USA) ausgeliefert. Dabei kann eine Übermittlung von Daten in die USA stattfinden (siehe Ziffer 11).

## 4. Kundenkonto, Lizenz und Anmeldung

4.1 Für die Registrierung und Nutzung verarbeiten wir:
- Vorname, Nachname, E-Mail-Adresse und Passwort (nur verschlüsselt als Hashwert gespeichert),
- den Kundentyp (Privatperson, Unternehmen, Bildungseinrichtung),
- bei Unternehmen und Bildungseinrichtungen: Name der Einrichtung, Rechnungsanschrift, Land, gegebenenfalls USt-IdNr. und Position der registrierenden Person,
- Rolle im Konto, Lizenz- und Abonnementstatus, Demo-Status (Beginn und Ende),
- Zeitpunkte der Registrierung und Anmeldung.

4.2 Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Durchführung des Nutzungsvertrags bzw. vorvertragliche Maßnahmen). Ohne diese Daten ist die Nutzung nicht möglich.

4.3 Kundenkonto, Anmeldung und Datenbank betreiben wir bei **Supabase** (Supabase, Inc., USA). Die Daten werden in einem Rechenzentrum in der EU (Region Irland, eu-west-1) gespeichert. Grundlage ist ein Vertrag über die Auftragsverarbeitung (Data Processing Addendum) nach Art. 28 DSGVO. Ein Zugriff aus den USA, etwa für Support oder Wartung, kann nicht ausgeschlossen werden (siehe Ziffer 11).

[Prüfhinweis: Konkrete Fassung des Supabase-DPA prüfen und archivieren.]

## 5. Bestellung und Zahlung über Stripe

5.1 Die Zahlungsabwicklung, die Verwaltung der Abonnements, das Kundenportal („Abonnement verwalten“) und die Rechnungsstellung erfolgen über **Stripe** (Stripe Payments Europe, Ltd., Irland; Konzernmutter Stripe, Inc., USA). Auf der Bestellseite von Stripe geben Sie Ihre Zahlungs- und Rechnungsdaten direkt bei Stripe ein; wir erhalten keine vollständigen Karten- oder Kontodaten.

5.2 Wir übermitteln an Stripe bzw. erhalten von Stripe: Name, E-Mail-Adresse, Rechnungsanschrift, gegebenenfalls USt-IdNr., gebuchten Tarif und Intervall, Kunden-, Abonnement- und Zahlungskennungen, Zahlungsstatus sowie Rechnungsdaten.

5.3 Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) und Art. 6 Abs. 1 lit. c DSGVO (steuer- und handelsrechtliche Pflichten). Stripe verarbeitet Daten auch in eigener Verantwortung, etwa zur Betrugsprävention und zur Erfüllung eigener gesetzlicher Pflichten. Weitere Informationen: https://stripe.com/de/privacy.

5.4 Wählen Sie im Stripe-Checkout einen weiteren Zahlungsdienst (z. B. Klarna, Amazon Pay, Apple Pay, Google Pay oder Link), werden die für die Zahlung erforderlichen Daten auch an diesen Anbieter übermittelt, der sie in eigener Verantwortung nach seinen Datenschutzhinweisen verarbeitet.

## 6. Vertragsdokumente und Zustimmungen

6.1 Wenn Sie bei Registrierung, Demo-Start oder Bestellung Vertragsdokumente akzeptieren oder zur Kenntnis nehmen, speichern wir als Nachweis: welches Dokument (Typ, Version, Prüfsumme des Inhalts), Art und Zeitpunkt der Bestätigung, Anlass, Tarif, Abrechnungsintervall und gegebenenfalls die Kennung der Stripe-Bestellung, jeweils zugeordnet zu Ihrem Konto.

6.2 Rechtsgrundlage ist Art. 6 Abs. 1 lit. c DSGVO (Nachweispflichten) sowie Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am Nachweis des Vertragsschlusses und zur Abwehr von Ansprüchen).

## 7. Kündigung und Widerruf über die Website

Wenn Sie über „Verträge hier kündigen“ oder „Vertrag widerrufen“ eine Erklärung abgeben, verarbeiten wir Ihren Namen, Ihre E-Mail-Adresse, die Art der Erklärung, gegebenenfalls Angaben zum Vertrag, den Zeitpunkt des Eingangs sowie den Bearbeitungsstatus. Die Daten dienen der Bearbeitung und dem Nachweis der Erklärung (Art. 6 Abs. 1 lit. b und c DSGVO).

## 8. E-Mail-Kommunikation

8.1 Wir versenden ausschließlich E-Mails, die für Konto und Vertrag erforderlich sind, insbesondere zur Bestätigung der E-Mail-Adresse, zum Zurücksetzen des Passworts, Vertrags-, Kündigungs- und Widerrufsbestätigungen, Hinweise zum Ablauf eines Abonnements, die Erinnerung vor der automatischen Löschung eines geschlossenen Kontos sowie die Bestätigung einer Kontolöschung. Wir versenden keine Werbe-E-Mails oder Newsletter.

8.2 Wenn Sie uns per E-Mail kontaktieren, verarbeiten wir Ihre Angaben zur Bearbeitung der Anfrage (Art. 6 Abs. 1 lit. b bzw. f DSGVO).

8.3 Unser E-Mail-Postfach und der Versand dieser E-Mails laufen über **united-domains** (Deutschland) als E-Mail-Dienstleister.

[Prüfhinweis: Genaue Firmierung und Auftragsverarbeitungsvertrag von united-domains prüfen und ergänzen.]

## 9. Gespeicherte Inhalte und Speicherung im Browser

9.1 **Inhalte im Kundenkonto:** Ihre Simulationen (einschließlich Vorschaubild), eigenen Vorlagen und kontobezogenen Einstellungen speichern wir bei Supabase (Ziffer 4.3) und ordnen sie Ihrem Konto zu. Zugriff hat nur Ihr Konto; technisch ist dies durch Zugriffsregeln der Datenbank abgesichert. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Bitte legen Sie in Simulationen keine personenbezogenen Daten Dritter ab.

9.2 **Im Browser** (Local Storage) speichert OLO-LAB3D:
- die Anmeldesitzung,
- gerätebezogene Darstellungseinstellungen (z. B. Grafikqualität, Panelbreiten),
- nicht gespeicherte Zwischenstände zur Absturzsicherung,
- übergangsweise Inhalte aus früheren Versionen von OLO-LAB3D, die nach der Übernahme in Ihr Konto höchstens 30 Tage als Sicherung auf dem Gerät verbleiben,
- vorübergehend (höchstens 24 Stunden) den auf der Preisseite gewählten Tarif, damit er nach der Registrierung übernommen werden kann.

9.3 Diese Speicherung im Browser ist unbedingt erforderlich, um die von Ihnen ausdrücklich gewünschte Anwendung bereitzustellen (§ 25 Abs. 2 Nr. 2 TDDDG). Eine Einwilligung ist dafür nicht erforderlich. Wir setzen keine Cookies zu Analyse- oder Werbezwecken ein.

## 10. Speicherdauer und Löschung

10.1 **Kundenkonto und gespeicherte Inhalte** (Profil- und Einrichtungsdaten, Simulationen, Vorlagen, Einstellungen): Wir speichern sie, solange Ihr Kundenkonto besteht. Grundlage ist der mit der Registrierung geschlossene Nutzungsvertrag über das Kundenkonto (Art. 6 Abs. 1 lit. b DSGVO), der unabhängig von einer Lizenz besteht. Das **Ende einer Lizenz, eine Kündigung oder das Ende der Demo führt nicht zur Löschung**: Ihr Konto bleibt bestehen, damit Sie Ihre Inhalte bei einer späteren Buchung wieder vorfinden. Wenn Sie das nicht wünschen, können Sie Ihr Konto jederzeit schließen oder löschen (Ziffern 10.2 und 10.3).

[Prüfhinweis: Konten ohne Lizenz werden bewusst nicht automatisch gelöscht (Betreiberentscheidung). Prüfen lassen, ob für dauerhaft inaktive Konten eine zusätzliche Regel erforderlich ist, z. B. eine Nachfrage per E-Mail nach mehrjähriger Inaktivität.]

10.2 **Konto schließen:** Sie können Ihr Konto in der Kontoverwaltung schließen. Ein geschlossenes Konto bewahren wir **12 Monate ab der Schließung** auf; in dieser Zeit können Sie es jederzeit wieder öffnen und Ihre Inhalte exportieren. Etwa 30 Tage vor Ablauf der Frist erinnern wir Sie per E-Mail; die Löschung erfolgt frühestens 14 Tage nach dieser Erinnerung. Danach werden Konto, Profil, Simulationen, Vorlagen und Einstellungen **automatisch gelöscht** und Einrichtungsdaten anonymisiert, soweit sie nicht nach Ziffer 10.4 aufbewahrt werden müssen.

10.3 **Endgültige Löschung auf Ihren Wunsch:** Sie können Ihr Konto in der Kontoverwaltung jederzeit endgültig löschen oder die Löschung per E-Mail an info@olo-vision.de verlangen. Die Löschung erfolgt in der Kontoverwaltung sofort, bei einem Antrag per E-Mail unverzüglich, spätestens innerhalb eines Monats. Läuft noch ein Abonnement, benötigen wir die Vertragsdaten bis zu dessen Ende; die Löschung erfolgt dann mit Vertragsende.

10.4 **Getrennt aufbewahrt** – nach ihren jeweils eigenen Fristen und unabhängig vom Kundenkonto:
- **Rechnungs-, Buchungs- und Steuerunterlagen:** nach den gesetzlichen Aufbewahrungsfristen, insbesondere § 147 AO. Rechnungen und die dafür nötigen Daten liegen bei Stripe.
- **Zustimmungs- und Vertragsnachweise, Kündigungs- und Widerrufserklärungen, Versandnachweise vertragsbezogener E-Mails:** 3 Jahre nach Ende des Vertrags (Ende des Kalenderjahres, regelmäßige Verjährungsfrist), soweit keine längeren gesetzlichen Pflichten bestehen (Art. 6 Abs. 1 lit. c und f DSGVO).
- **Nachweis einer Kontolöschung:** Kennung des gelöschten Kontos, Zeitpunkt, Auslöser und ein nicht umkehrbarer Hashwert der E-Mail-Adresse für 3 Jahre (Art. 6 Abs. 1 lit. c und f DSGVO, Nachweis der Erfüllung Ihres Löschverlangens).
- **Server-Logdaten:** nach den Vorgaben der Hosting-Dienstleister.

## 11. Übermittlung in Drittländer

Netlify, Supabase und Stripe gehören zu Unternehmensgruppen mit Sitz in den USA. Soweit Daten in die USA übermittelt werden, erfolgt dies auf Grundlage eines Angemessenheitsbeschlusses der EU-Kommission (EU-US Data Privacy Framework), soweit der jeweilige Anbieter zertifiziert ist, und im Übrigen auf Grundlage von EU-Standardvertragsklauseln.

[Prüfhinweis: Zertifizierung der Anbieter unter dem EU-US Data Privacy Framework und die vereinbarten Standardvertragsklauseln prüfen; Netlify-DPA abschließen bzw. archivieren.]

## 12. Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und auf Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (Art. 21 DSGVO). Wenden Sie sich dazu an info@olo-vision.de.

Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns zuständig ist das **Unabhängige Datenschutzzentrum Saarland** (https://www.datenschutz.saarland.de).

## 13. Keine automatisierte Entscheidung

Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt.

## 14. Änderungen

Wir passen diese Datenschutzerklärung an, wenn sich die Verarbeitung ändert. Maßgeblich ist die jeweils unter https://olo-lab.de veröffentlichte Fassung.
$olo$),
      -- 06_widerrufsbelehrung.md (93f027a10f89)
      ('withdrawal', 'b2c', '1.0', $olo$Widerrufsbelehrung$olo$, $olo$Ich habe die {link} zur Kenntnis genommen.$olo$, $olo$Die folgende Belehrung gilt für Verbraucher (Tarif Private).

## Widerrufsrecht

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.

Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns

OLO Vision, Inhaber Jonas Karol Lingener
Forsthausstraße 14
66709 Weiskirchen
E-Mail: info@olo-vision.de

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.

Sie können den Widerruf auch über die Schaltfläche **„Vertrag widerrufen“** auf unserer Website unter https://olo-lab.de/widerrufen erklären. Machen Sie von dieser Möglichkeit Gebrauch, so übermitteln wir Ihnen unverzüglich per E-Mail eine Bestätigung über den Eingang Ihres Widerrufs.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

## Folgen des Widerrufs

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.

Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.

## Hinweise zur Berechnung des Wertersatzes

Der Wertersatz wird zeitanteilig nach Tagen berechnet: Vergütung des laufenden Abrechnungszeitraums geteilt durch die Anzahl seiner Tage, multipliziert mit der Anzahl der Tage ab Vertragsschluss bis zum Eingang des Widerrufs. Der Differenzbetrag wird erstattet.

Beispiel: Monatstarif Private (19,90 €, 30-tägiger Abrechnungszeitraum), Widerruf am 5. Tag: Wertersatz 5 × 19,90 € / 30 = 3,32 €, Erstattung 16,58 €.

Mit dem Widerruf endet der Vertrag; der Zugang wird beendet.

[Prüfhinweis: Die Belehrung folgt dem gesetzlichen Muster (Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB) für Dienstleistungen. Bitte anwaltlich prüfen lassen, (1) ob OLO-LAB3D als digitale Dienstleistung einzuordnen ist, (2) ob das Muster in der seit dem 19.06.2026 geltenden Fassung (Widerrufsfunktion nach § 356a BGB) vollständig übernommen ist und (3) ob die Erläuterung zur Berechnung des Wertersatzes neben dem Muster zulässig ist.]
$olo$),
      -- 07_widerrufsformular.md (9c5be04bbc13)
      ('withdrawal_form', 'b2c', '1.0', $olo$Muster-Widerrufsformular$olo$, null, $olo$(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück. Einfacher geht es über die Schaltfläche „Vertrag widerrufen“ unter https://olo-lab.de/widerrufen.)

An
OLO Vision, Inhaber Jonas Karol Lingener
Forsthausstraße 14
66709 Weiskirchen
E-Mail: info@olo-vision.de

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*):

OLO-LAB3D, Tarif: ______________________

Bestellt am (*)/erhalten am (*): ______________________

Name des/der Verbraucher(s): ______________________

Anschrift des/der Verbraucher(s): ______________________

E-Mail-Adresse des Kundenkontos: ______________________

Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): ______________________

Datum: ______________________

(*) Unzutreffendes streichen.
$olo$),
      -- 08_zustimmung_sofortiger_beginn.md (b2be1a314fa6)
      ('consent_immediate_performance', 'b2c', '1.0', $olo$Verlangen des sofortigen Leistungsbeginns$olo$, $olo$Ich verlange ausdrücklich, dass OLO Vision mit der Leistung (Freischaltung von OLO-LAB3D) sofort nach Vertragsschluss und damit vor Ablauf der Widerrufsfrist beginnt. ({link})$olo$, $olo$Als Verbraucher haben Sie ein vierzehntägiges Widerrufsrecht. OLO-LAB3D wird unmittelbar nach dem Vertragsschluss freigeschaltet. Damit wir mit der Leistung vor Ablauf der Widerrufsfrist beginnen dürfen, benötigen wir Ihr ausdrückliches Verlangen.

Mit dem Setzen des Häkchens bei der Bestellung erklären Sie:

**„Ich verlange ausdrücklich, dass OLO Vision mit der Leistung (Freischaltung von OLO-LAB3D) sofort nach Vertragsschluss und damit vor Ablauf der Widerrufsfrist beginnt.“**

Ohne dieses Verlangen ist eine Bestellung über die Anwendung nicht möglich, weil der Zugang technisch sofort freigeschaltet wird. Ihr Widerrufsrecht bleibt davon unberührt; die Folgen eines Widerrufs ergeben sich aus der Widerrufsbelehrung und dem Hinweis zum Wertersatz.

[Prüfhinweis: Ob die Bestellung vom sofortigen Leistungsbeginn abhängig gemacht werden darf (statt eines späteren Starts nach Ablauf der Widerrufsfrist), anwaltlich prüfen lassen.]
$olo$),
      -- 09_hinweis_wertersatz.md (b34cd0366ad1)
      ('consent_withdrawal_loss', 'b2c', '1.0', $olo$Hinweis zum Wertersatz bei Widerruf$olo$, $olo$Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachte Leistung einen anteiligen Betrag (Wertersatz) zahlen muss und dass mein Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist. ({link})$olo$, $olo$Wenn Sie den sofortigen Beginn der Leistung verlangen und den Vertrag anschließend fristgerecht widerrufen, erhalten Sie Ihre Zahlung zurück – abzüglich eines Betrags für die Zeit, in der OLO-LAB3D bis zum Widerruf für Sie freigeschaltet war (Wertersatz). Der Betrag wird zeitanteilig nach Tagen berechnet (Einzelheiten und Beispiel in der Widerrufsbelehrung).

Ihr Widerrufsrecht erlischt, wenn die Leistung vollständig erbracht ist. Bei den Abonnements von OLO-LAB3D ist das innerhalb der vierzehntägigen Widerrufsfrist regelmäßig nicht der Fall.

Mit dem Setzen des Häkchens bei der Bestellung bestätigen Sie:

**„Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachte Leistung einen anteiligen Betrag (Wertersatz) zahlen muss und dass mein Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist.“**

[Prüfhinweis: Dieser Text ersetzt die frühere Formulierung zum sofortigen Erlöschen des Widerrufsrechts, die auf digitale Inhalte zugeschnitten ist. Die Einordnung von OLO-LAB3D als digitale Dienstleistung mit Wertersatz (§§ 356 Abs. 4, 357a Abs. 2 BGB) anwaltlich bestätigen lassen.]
$olo$)
    ) as t(type, audience, version, title, checkbox_label, content)
  loop
    if exists (select 1 from public.legal_documents d where d.type::text = r.type and d.audience::text = r.audience and d.version = r.version) then
      raise notice 'Übersprungen (existiert bereits): % / % / Version %', r.type, r.audience, r.version;
    else
      insert into public.legal_documents (type, audience, version, title, checkbox_label, content, status)
      values (r.type::public.legal_document_type, r.audience::public.legal_audience, r.version, r.title, r.checkbox_label, r.content, 'draft');
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice '% Entwürfe angelegt.', v_count;
end;
$seed$;
