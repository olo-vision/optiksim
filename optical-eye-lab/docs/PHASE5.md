# Phase 5 – Modulares Dashboard und fachlicher Physik-Review

Stand: 0.5.0 · SceneDocument-Schema 3 (unverändert; alle neuen Felder optional) · Plattform-Datenversion 3

Phase 5 hat zwei Teile:

- **Module:** Die Arbeitsbereiche (Skiaskopie, Refraktion, Patientensicht, Kontaktlinse und neu Brillenglas) sind zusätzlich eigenständige, fokussierte Module, die man direkt vom Dashboard aus öffnet.
- **Physik-Review:** Die optischen Berechnungen wurden fachlich und mathematisch geprüft. Fehler sind korrigiert, allen voran die Glasdicke in Abhängigkeit vom Brechungsindex.

---

## 1. Modul-Architektur

```
src/modules/registry.ts          EINZIGE Quelle aller Module (Titel, Icon, Gruppe, Status, Arbeitsbereich, Startszene)
src/workbench/Workbench.tsx      WORKBENCH_PANELS + <WorkbenchPanel id> – dieselben Panels für Simulator-Dock und Modul
src/workbench/spectacle/         neues Panel „Brillenglas“ (Querschnitte, Dicke, Gewicht, Materialvergleich)
src/app/simulation/useSimulationSession.tsx   Laden/Speichern/Autosave/Entwurf/Verlassen-Schutz (aus SimulatorPage herausgelöst)
src/app/modules/moduleSessions.ts             Modul-Sitzung = Bibliothekssimulation mit meta.moduleId
src/app/modules/ModuleTiles.tsx               Kacheln (Dashboard + Übersicht)
src/app/pages/ModulesPage.tsx                 /modules (Übersicht) und /modules/:id (Einstieg)
src/app/pages/ModulePage.tsx                  /modules/:id/:simId (fokussierte Modulseite)
src/ui/inspector/LensThicknessFields.tsx      Dicke/Zentrierung/Gewicht – Inspector und Modul teilen sich die Oberfläche
```

**Grundprinzip – keine Dopplung:**

- Ein Modul ist eine *Sicht* auf eine normale Simulation.
- Der Modulinhalt ist exakt das Panel, das der Simulator als Dock zeigt.
- Die Physik stammt vollständig aus `engine/*`.
- Laden, Speichern, Autosave, Absturzsicherung und Verlassen-Schutz liegen in **einem** Hook, den Simulator und Module gemeinsam nutzen.

**Sitzungen:**

- Beim Öffnen eines Moduls wird die zuletzt benutzte Sitzung dieses Moduls fortgesetzt; gibt es noch keine, wird eine neue aus der Startszene des Moduls angelegt.
- Eine Sitzung ist eine Bibliothekssimulation mit `moduleId`. Damit funktionieren Export, Vorschaubild, Rechte und Gastlimit unverändert.
- In „Meine Simulationen“ tragen Sitzungen ein Modul-Etikett und öffnen sich im Modul. Das Kartenmenü bietet zusätzlich „Im vollständigen Simulator öffnen“.

**Navigation:**

- **Kopfzeile der Modulseite:** Logo → Dashboard · „Module“ → Übersicht · Modulwechsler (▾).
- **Sitzungsmenü:** Speichern, Umbenennen, neue Sitzung, frühere Sitzungen.
- **Weitere Bedienelemente in der Kopfzeile:** Speicherstatus, Standard/Experte, 3D-Ansicht ein/aus.
- **„Vollständiger Simulator“:** öffnet *dieselbe* Simulation mit dem passenden Arbeitsbereich.
- **Rückweg aus dem Simulator:** „Als Modul öffnen“ im Dock.
- Beim Verlassen eines Moduls wird ohne Rückfrage gespeichert.

**Dashboard:**

- Kachel „Vollständiger Simulator“ mit „Neue Simulation“ und „Zuletzt …“.
- Kacheln aller aktiven Module mit Sitzungszähler; geplante Module als Hinweis.
- Neuer Navigationspunkt „Module“ in der Seitenleiste.

**Neues Modul hinzufügen** (z. B. Spaltlampe, Topograf, Binokulartests – bereits als „In Entwicklung“ registriert):

1. `WorkbenchId` in `model/types.ts` ergänzen.
2. Panel in `src/workbench/<name>/` anlegen und in `WORKBENCH_PANELS` eintragen.
3. Registry-Eintrag auf `status: 'active'` setzen, mit `workbench` und `createScene`.

Dashboard, Übersicht, Simulator-Reiter, Modulwechsler und Routing folgen automatisch.

**Responsiv:**

- Ab 900 px Breite steht die 3D-Ansicht links neben dem Panel.
- Darunter steht sie oben (34 % der Höhe), und die Panelspalten brechen um.
- Die Kopfzeile verdichtet sich stufenweise: Beschriftungen werden zu Symbolen mit Tooltip.

---

## 2. Physik-Review: Befunde und Korrekturen

| # | Bereich | Befund | Korrektur |
|---|---|---|---|
| 1 | **Glasdicke** | Beim Wechsel von Material oder Wirkung blieb die Mittendicke fest (3,5 mm); sie wurde nur erhöht, nie verringert. Plusgläser erschienen dadurch bei höherem Index **dicker** (dicker Rand bei fester Mitte). Minusgläser hatten unrealistische 3,5 mm Mitte. | Dickenmodus „automatisch“ (Standard für neue Brillengläser): t aus Mindest-Mitten- und Mindest-Randdicke entlang der echten Kontur (s. u.). Iterativ mit der Wirkung, in beide Richtungen, ohne Hysterese. |
| 2 | Wirkung ↔ Darstellung | `lensOptics` rechnete mit der gespeicherten Mittendicke. Darstellung und Raytracing verwendeten die ggf. erhöhte (negative Randdicke). | Alle Module verwenden dieselbe aufgelöste Dicke (`resolveLensShape`). |
| 3 | HSA bei Dickenänderung | Änderte sich die Dicke, verschob sich der augenseitige Scheitel um Δt/2, der HSA also unbemerkt. | `replaceLensKeepingBackVertex`: Der Rückscheitel bleibt ortsfest. |
| 4 | Ovale/rechteckige Gläser im Raytracing | Die Randbegrenzung nutzte Halbräume mit radialer Normale im Abstand r(φ); bei Nicht-Kreisformen schneidet das die Kontur an. | Halbräume im Abstand der **Stützfunktion** h(φ) = max(p·u) – exakt für konvexe (auch dezentrierte) Konturen. |
| 5 | **Gewendetes Glas** (180° gedreht) | Die Rezeptrechnung wendete immer erst F₁, dann F₂ an; die Achse wurde nicht gespiegelt. Beispiel: +10/−2 × 30 gewendet ergab weiter × 30, das Raytracing zeigt aber 150°/60°. | Zuerst die Fläche, die zum Licht zeigt. Rahmen-Transformation T (Drehung **oder Spiegelung**): M' = T·M·Tᵀ. Die Vorderscheitelwirkung gilt. Unit-Test gegen Raytracing. |
| 6 | Weiche KL, Materialwechsel | Der Cache der angeschmiegten Vorderfläche ignorierte den Brechungsindex; die Wirkung blieb veraltet (≈ 0,004 dpt). | Das Medium ist Teil des Cache-Schlüssels (Rechnung und 3D-Geometrie). |
| 7 | Torische Linsen im Inspector | S'∞, F und f' kamen aus `thickLens(r₁, r₂)`, also aus Radien verschiedener Meridiane. | Für torische Linsen: Hauptschnittwirkungen aus der Matrixrechnung. |
| 8 | **Rot-Grün-Test mit Akkommodation** | Der Patient akkommodierte exakt auf die d-Linie. Ein übermintes, akkommodierendes Auge antwortete dadurch immer „Rot“, die Anleitung sagte also „mehr Minus“. | Die Akkommodation zielt auf den Rot-Grün-Schwerpunkt (≈ 565 nm) mit Lag: α = clamp(M_ref − min(0,2; 0,15·M_ref), 0, AB). Übermint → Grün, untermint → Rot (Tests). |
| 9 | Chromatische Aberration des Auges | Einheitlich ν = 55,8 für alle Augenmedien ergab F→C nur 0,75 dpt (dokumentiert war ≈ 1 dpt). | Abbe-Zahl je Medium: Hornhaut 56, Kammerwasser 53, Linse 49, Glaskörper 53. Ergebnis: **F→C 0,91 dpt**; 620 nm +0,14, 535 nm −0,28 dpt (Thibos „Chromatic Eye“: 0,90 / +0,12 / −0,29). |
| 10 | Skiaskopie, Konkavspiegel | Die Hauptschnitt-Anzeige kehrte die Bewegung beim Konkavspiegel immer um, die Hauptanzeige nur bei s = w − d > 0. Bei w < 30 cm widersprachen sich beide. | Gleiches Vorzeichen wie die Reflexgeschwindigkeit: sign((s − w)/s). |
| 11 | Arbeitsabstand (Text) | Die Erklärung nannte „+1,50 dpt bei 66,7 cm“, die Formel rechnet aber exakt 1/(w − HSA) = +1,53 dpt. | Text korrigiert (exakt vs. Faustregel). |

### Geprüft und korrekt

- **Grundgesetze:**
  - Snellius in Vektorform inkl. Totalreflexion.
  - Flächenbrechwert (n' − n)/r mit Vorzeichen.
  - Dicke Linse: S'∞ = F₁/(1 − d/n·F₁) + F₂, F = F₁ + F₂ − d/n·F₁F₂, Vorderscheitelbrechwert.
  - Radien-Löser für Vorder- und Rückfläche.
- **Rechenmethoden:**
  - Keating-Matrizen: Rx ↔ Matrix, Transposition, Drehung, Effektivität; alle Produkte kommutieren, die Rechnung ist also exakt.
  - y-nu-Durchrechnung. Le-Grand-Auge: 59,94 dpt, Bild bei 24,197 mm.
- **Korrektion und Abstand:**
  - Vergenzübertragung und HSA: −4 → −3,82, +4 → +4,20 dpt bei 12 mm.
  - Raytracing ↔ Paraxial: stimmen bei kleinem Bündel auf 10⁻⁴ mm überein.
  - Torische Achsen in Rechnung, Geometrie und Raytracing identisch.
- **Prisma:** 10°, n 1,5: Rechnung 5,02°, Raytracing 5,03°. Basislage stimmt.
- **Kontaktlinse:** Tränenlinse (Zerlegung KL in Luft + Tränenlinse + Hornhaut) und Fluoreszein-Geometrie.
- **Skiaskopie:** mit/gegen/neutral, Neutralisationsglas.
- **Patientensicht:**
  - PSF: Durchmesser = Pupille × |Defokus|.
  - Orientierung und Spiegelung der Patientensicht.
  - Kreuzzylinder-Logik und Fächer.
- **Werkzeuge:**
  - Prentice (Basis zum/vom optischen Mittelpunkt), Keratometer 337,5/r, Abbildung β = L/L'.
  - Sauerstoff: Dk/t = Dk/(10·t_mm), Hydrogel-Dk nach Fatt.

---

## 3. Glasdicke – Berechnung

Die Randdicke an einem Konturpunkt (Pfeilhöhen s₁, s₂ relativ zum jeweiligen Scheitel, positiv in Lichtrichtung):

```
e(x, y) = t − s₁(x, y) + s₂(x, y)
```

Fertigungsbedingungen entlang der gesamten (ggf. dezentrierten) Kontur:

```
e ≥ e_min   und   t ≥ t_min     ⇒     t = max( t_min ,  e_min + max_Kontur [ s₁ − s₂ ] )
```

- **Plusglas:** Die Mindestranddicke bestimmt t; die dünnste Randstelle liegt am weitesten vom optischen Mittelpunkt entfernt.
- **Minusglas:** t = t_min; die Randdicke folgt aus der Geometrie (dickster Rand außen).
- **Wirkung und Dicke:** Da S'∞ selbst von t abhängt, wird im Optik-Modus iteriert (Fixpunkt, wenige Schritte).
- **Einflussgrößen:**
  - Wirkung (Sph, Cyl, Achse – torische Rückfläche)
  - Basiskurve r₁
  - Material (n, Richtwert t_min)
  - Formscheibe (rund, oval, rechteckig; Maße)
  - Lage des optischen Mittelpunkts in der Formscheibe
  - Mindestranddicke (Fassungsart: Vollrand 1,0 · Nylor 1,8 · Randlos 2,0 mm)
- **Index-Effekt:**
  - Bei gleicher Wirkung und Basiskurve braucht höheres n eine flachere Rückfläche, weil |r₂| = (n − 1)/|F₂| wächst.
  - Dadurch wird |s₁ − s₂| kleiner: Plusgläser werden in der Mitte dünner, Minusgläser am Rand.
  - Beispiel (Oval 52×40, r₁ = 87 mm, t_min 1,5, e_min 1,0):

| Glas | n = 1,50 | n = 1,60 | n = 1,67 | n = 1,74 |
|---|---|---|---|---|
| +4,00 dpt, Mittendicke | 3,74 mm | 3,28 mm | 3,04 mm | 2,85 mm |
| −6,00 dpt, max. Randdicke (Mitte 1,50 mm) | 6,42 mm | 5,50 mm | 5,04 mm | 4,68 mm |

- **Gewicht:** V = ∬ e(x, y) dA (Polarraster über die Kontur), m = V·ρ.
- **Basiskurve nach Vogel** (Richtwert, Knopf im Inspector):
  - Plus: F_B ≈ SÄ + 6 dpt, Minus: F_B ≈ SÄ/2 + 6 dpt.
  - r₁ = (n − 1)/F_B, d. h. bei höherem n ist derselbe Flächenbrechwert flacher.
- **Keine optische Skalierung:**
  - 3D-Darstellung, Raytracing, Wirkung und Querschnitte (Modul „Brillenglas“, maßstabsgetreu) verwenden dieselbe Geometrie.
  - Ältere Szenen behalten ihre Dicke (Feld fehlt → „manuell“) und lassen sich im Inspector auf „automatisch“ umstellen.

**Datenmodell:**

- `LensParams`: `thicknessMode?: 'auto' | 'manual'`, `minCenterThickness?`, `minEdgeThickness?`, `opticalCenterOffset?: {x, y}` (TABO).
- `OpticalMaterial`: `minCenterThickness?` (Richtwert je Brillenglasmaterial).
- `SimulationMetadata.moduleId?`.

---

## 4. Akkommodation und Rot-Grün-Test

```
M_ref = M_d + Δ_Schwerpunkt              Δ_Schwerpunkt = (Δ_rot + Δ_grün)/2 ≈ −0,07 dpt
α     = clamp(M_ref − lag, 0, AB)        lag = min(0,20 dpt; 0,15·M_ref)
Rot-Grün:  E_rot = E + Δ_rot,  E_grün = E + Δ_grün  → deutlicher = kleinere Blurstärke (Toleranz 0,04 dpt)
```

- **Folgen:**
  - Ein übermintes, akkommodierendes Auge bleibt leicht hyperop, antwortet also „Grün“.
  - Untermint antwortet es „Rot“.
  - Die Vollkorrektion auf der d-Linie antwortet schwach „Rot“; das entspricht der Praxisregel, im Zweifel das Glas mit „Rot“ zu wählen.
- **Emmetrope in 6 m:** Sie akkommodieren ≈ 0,08 dpt statt 0,17 dpt (Schwerpunkt und Lag).
- **Tests:** Die Phase-4-Tests wurden an das neue Modell angepasst.

---

## 5. Tests

| Datei | Inhalt |
|---|---|
| `tests/phase5.physics.test.ts` (22) | Dicke ↔ Index (Plus/Minus, monoton, ohne Hysterese), Dickenformel, Durchmesser/Zentrierung, Materialrichtwerte, Vogel, Volumen/Gewicht, HSA fest, Dicke Wirkung=Darstellung, dezentrierte Kontur, torische Kennwerte, Snellius/Totalreflexion, Frame-Transformation, gewendetes Glas (Rechnung + Raytracing), LCA ≈ 0,9 dpt, Rot-Grün (unter-/übermint mit Akkommodation), Konkavspiegel-Hauptschnitte, weiche KL Cache |
| `tests/phase5.modules.test.ts` (4) | Registry: eindeutige IDs/Arbeitsbereiche, Startszenen speicher-/ladbar, geplante Module deaktiviert, Brillenglas-Startszene mit Auto-Dicke |
| `tests/e2e/phase5.e2e.mjs` (31) | Dashboard-Kacheln, Modulübersicht, Modul öffnen (fokussiert, Sitzung mit moduleId), Modulwechsel, Dashboard zurück, Sitzung fortsetzen, Brillenglas (Minus: Rand, Plus: Mitte sinken mit n), Simulator ↔ Modul (gleiche Simulation), Deep-Link neu laden, geplantes Modul, Responsiv 1180/900/700 px, Konsole |

---

## 6. Grenzen und Vereinfachungen (neu/geändert)

- **Glasdicke:**
  - Die Mindestdicken sind Richtwerte, keine Herstellertabellen.
  - Nicht berücksichtigt: Fassungsnut/Facette, Prismendünnung, Asphären/Atorien.
  - Die Basiskurve ist frei (Vogel nur als Vorschlag).
- **Dezentration:** Der optische Mittelpunkt muss innerhalb der Formscheibe liegen (±15 mm).
- **Akkommodation:** Lag und Schwerpunkt sind vereinfachte, dokumentierte Modelle ohne Schärfentiefe-Modell. Der Visus bleibt eine Schätzung.
- **Augendispersion:** Die Abbe-Zahlen je Medium sind Literatur-Richtwerte. Die Hornhaut-Asphärizität Q wirkt weiterhin auf Sitz und Fluoreszein, nicht im Raytracing.
- **Module:** Geplante Module (Spaltlampe, Topograf, Binokulartests, Ophthalmoskop) sind nur registriert und deaktiviert.
