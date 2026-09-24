# Phase 4 – Fachlicher Ausbau / Untersuchungsmodi / realistische Optik

Stand: 0.4.0 · SceneDocument-Schema **3** (Migration v2 → v3 automatisch) · Plattform-Datenversion 3 (unverändert)

Phase 4 macht aus dem Simulator ein Untersuchungs- und Lernwerkzeug. Die Architektur aus Phase 1–3 bleibt:

- Die Geometrie ist die einzige Quelle der Wahrheit.
- Alle neuen Funktionen sind **Arbeitsbereiche** (Workbenches) über derselben Szene.
- Rechenkerne sind reine, unit-getestete Funktionen ohne React/Three.js.

Umgesetzt in vier Teilschritten:

| Teil | Inhalt |
|---|---|
| 4A | Instrument-Architektur, Skiaskopie mit Training, Arbeitsbereiche, Schema v3 |
| 4B | Refraktionsmodus, Patientensicht (PSF/FFT im Web Worker), Dispersion, Rot-Grün |
| 4C | Fluoreszeinbild, Material-/Medienbibliothek, Fachinfo, optische Werkzeuge, Standard/Experte |
| 4D | E2E-Tests, Layout-Feinschliff, Dokumentation |

---

## 1. Neue Module

```
src/engine/optics/            reine Rechenkerne (unit-getestet)
├─ retinoscopy.ts   Reflexmodell der Strichskiaskopie, Neutralisation, Arbeitsabstandskorrektur
├─ vision.ts        Defokus, Akkommodation, PSF-Kernel, Visus-Schätzung, JCC, Nebeln, chromatische Verschiebung
├─ fft.ts           2D-Radix-2-FFT, Faltung (für die Patientensicht)
├─ dispersion.ts    n(λ) aus n_d und Abbe-Zahl, Spektrallinien, Wellenlänge → Farbe
├─ fluorescein.ts   Fluoreszenzintensität, Sitzklassifikation, Sitzanalyse, Klick-Sonde
├─ calculators.ts   HSA-Umrechnung, Brille→KL, Prentice, Scheitelbrechwert, Abbildung, Keratometer,
│                   Tränenlinse, Vergenz, Lupe – jeweils Wert + Rechenweg
└─ training.ts      Fallgenerator (reproduzierbar per Seed), Fall anwenden, Auswertung

src/model/
├─ media.ts         strukturierte Materialbibliothek (Auge, Brillenglas, RGP, Hydrogel, SiHy, Sonstige)
├─ instruments.ts   Instrument-Registry, Skiaskop anlegen/platzieren, Messglas anlegen/setzen
└─ derived/contactSeat.ts   jetzt zonale KL-Rückfläche (OZ + periphere Kurven) und konische Hornhaut (Q)

src/workbench/                Arbeitsbereiche (lazy geladen)
├─ Workbench.tsx    WorkbenchBar (Reiter, Training-Badge, Standard/Experte), WorkbenchDock
├─ common.tsx       useTrialLens, useRetinoscope, Stepper, Messglas-Bedienung, Readout
├─ retinoscopy/     Pupillenreflex-Ansicht (Canvas), Skiaskopie-Panel
├─ refraction/      Refraktionsmodus (Messglas, Nebeln, JCC, Lochblende, Rot-Grün, Fächer, Prisma)
├─ patient/         Sehzeichen-Generator, PSF-Worker, Patientenbild, Patientensicht-Panel
├─ contact/         Fluoreszeinbild mit Sonde, Kontaktlinsen-Panel
└─ training/        TrainingBox (Fall starten, Ergebnis eingeben, Auswertung mit Rechenweg)

src/ui/inspector/
├─ MaterialFields.tsx  Materialauswahl je Elementart + Kennwerte (Abbe, Dk, Dk/t, Wassergehalt …)
├─ FachPanel.tsx       Reiter „Fachinfo“: Kennwerte und Erklärungen zur Auswahl
└─ ToolsPanel.tsx      Reiter „Werkzeuge“: Rechner, mit der Auswahl verknüpft

src/scene/instruments/RetinoscopeView.tsx   3D-Skiaskop mit Lichtstrich (Strichlage, Schwenk)
```

**Instrument-Architektur:** Instrumente sind Lichtquellen mit `deviceRole` und Parametersatz, z. B. `retinoscope: RetinoscopeParams`. Sie erscheinen im Szenenbaum, lassen sich wie jedes Objekt bewegen und werden vom Raytracing der Szene ausgenommen. Das Messglas ist ein normales Brillenglas mit `role: 'trial'`, also wirken HSA, Vergenzrechnung und Raytracing unverändert. Neue Instrumente registriert man in `model/instruments.ts → INSTRUMENTS`.

---

## 2. Formeln

Einheiten: Längen in m (in der Oberfläche mm/cm), Brechwerte in dpt, Matrizen 2×2 (Keating).

**Gemeinsame Basis – Fehlermatrix am Hornhautscheitel**

```
E = A_Auge − L_HS(Objekt)        (computeCorrection(doc, form, { objectZ }))
```

- `L_HS` ist die Vergenz, die ein Objektpunkt im Abstand d nach allen Gläsern (inkl. HSA, KL, Tränenlinse) am Hornhautscheitel erzeugt.
- Ohne Gläser gilt `E = A + I/d`.
- E = 0 heißt scharf bzw. neutral.

**Skiaskopie** (`retinoscopy.ts`)

| Größe | Formel |
|---|---|
| Neutralisation | E = 0 (Guckloch im Fernpunkt des Systems) |
| Virtuelle Quelle | Planspiegel s = w + d, Konkavspiegel s = w − d |
| Reflexband | Normale g = E·m; Halbbreite h = P·\|(I/s + R)·m\| + W_Q/(2s) |
| Geschwindigkeit | k = (g·m)(s − w) / (w·s·\|g\|²); skalar k = (d/s)/(1 + wR) |
| Bewegung | k > 0 Mit-, k < 0 Gegenbewegung, \|k\| → ∞ neutral |
| Break/Skew | Winkel zwischen g und m (≠ 0, wenn der Strich nicht im Hauptschnitt liegt) |
| Helligkeit | B = I₀·min(1, a/(wP\|λ₁\|))·min(1, a/(wP\|λ₂\|)) |
| Arbeitsabstand | Netto = Brutto − 1/(w − HSA) |

**Patientensicht / Refraktion** (`vision.ts`)

- **Akkommodation:** AB = 18,5 − 0,3·Alter (Hofstetter). Der Patient akkommodiert α = clamp(M, 0, AB); E' = E − α·I.
- **Geometrische PSF:** Δθ = E·x über der Pupillenscheibe (Spot-Diagramm). Beugung wird als Gauß mit σ = 0,42·λ/D ergänzt.
- **Bild:** Faltung des Sehzeichens mit der PSF per FFT (N = 512, Feld 128′), getrennt für R/G/B.
- **Visus-Schätzung (Smith 1991):** MAR = √(MAR₀² + (0,65·p·B)²) mit MAR₀ = √(1 + (1,2/p)²) und B = √(M² + J²).
- **Kreuzzylinder** ±p: +p sph / −2p cyl, Achse je nach Wendestellung. **Nebeln:** +0,75 dpt sph auf das Messglas.
- **Prisma:** Bildverschiebung 1 cm/m = 0,573° = 34,4′ in Richtung der Spitze.
- **Rot-Grün:** Refraktion des „chromatischen Auges“ bei 620 nm bzw. 535 nm.

**Dispersion** (`dispersion.ts`)

```
n(λ) = A + B/λ²,  B = (n_d − 1)/ν_d / (1/λ_F² − 1/λ_C²),  A = n_d − B/λ_d²
```

Augenmedien rechnen mit ν = 55,8 (Wasser). Die chromatische Längsaberration F–C beträgt dann ≈ 1 dpt.

**Fluoreszein** (`fluorescein.ts`)

- Intensität: I(t) = 1 − exp(−max(0, t − 10 µm)/35 µm).
- Klassen nach Tränenfilmdicke:

| Dicke | Klasse |
|---|---|
| < 15 µm | Auflage |
| < 25 µm | dünn |
| < 40 µm | parallel |
| < 100 µm | Pooling |
| sonst | Randabstand |

- Die Dicke t(x, y) ist der Abstand zwischen zonaler KL-Rückfläche und Hornhaut.
- Die Hornhaut ist konisch (Scheitelradius, Torizität, Q): z = r·ρ²/(R + √(R² − (1+Q)·ρ²)), je Meridian.

**Material** (`media.ts`)

- Dk/t = Dk / (10·t[mm]) in 10⁻⁹ (cm/s)(ml O₂/ml·mmHg).
- Hydrogel: Dk ≈ 2,0·e^(0,0411·Wassergehalt) (Fatt).
- Holden-Mertz: 24 (Tagestragen) bzw. 87 (Dauertragen).

**Werkzeuge** (`calculators.ts`)

| Werkzeug | Formel |
|---|---|
| HSA | F' = F/(1 − Δd·F) je Hauptschnitt (Matrixform) |
| Prentice | P = −F·c (Vektor, cm/m) |
| Keratometer | K = 337,5/r |
| Abbildung | 1/a' = 1/a + F |
| Lupe | Γ = F/4 |
| Tränenlinse | F = (n_T − 1)(1/r_BC − 1/r_HH) mit n_T = 1,336 |

---

## 3. Vereinfachungen

- **Skiaskopie:** paraxial. Die Pupille liegt in der Hornhautscheitelebene. Gläser gelten für die Reflexgeometrie als dünn am Scheitel; die Neutralisationsbedingung ist dagegen exakt über HSA und Vergenz gerechnet. Nicht modelliert: seitliche Beobachtung, höhere Aberrationen, Streuung, Scherenphänomen, Fundusfarbe. Der Fundus ist eine Lambert-Fläche.
- **Patientensicht:**
  - Nur Defokus und Astigmatismus.
  - Beugung als Gauß-Näherung.
  - Kein Stiles-Crawford-Effekt, keine Kontrastempfindlichkeit.
  - Das Akkommodationsverhalten ist idealisiert (Kreis kleinster Verwirrung).
  - Der Visus ist ausdrücklich eine **Schätzung**.
- **Chromatik:** zweigliedrige Cauchy-Näherung (±0,002). Alle Augenmedien haben dieselbe Abbe-Zahl. Das Raytracing rechnet je Wellenlänge, nicht spektral gemittelt.
- **Fluoreszein:** statisches Bild ohne Lidschlag, Linsenbewegung oder Tränenaustausch. Die Randhöhe ergibt sich aus der Geometrie; die Deutungstexte sind didaktische Faustregeln.
- **Material:**
  - Die Kennwerte sind typische Werte je Materialklasse und keine Herstellerdaten.
  - Handelsnamen werden bewusst nicht verwendet.
  - Dk/t wird zentral mit der Mittendicke gerechnet.
- **Training:** Die wahre Refraktion ist die Geometrie des Auges. Ausgeblendet werden nur die Anzeigen (Maßkette, Fokus, Fachinfo); über „Frei“ und den Inspector ist sie weiterhin ermittelbar. Das ist Lernmodus, keine Prüfungssicherheit.

---

## 4. Datenmodelle (Schema v3)

```ts
DisplaySettings.workbench?: 'free' | 'retinoscopy' | 'refraction' | 'patient-view' | 'contact-lens'
LightSourceEntity.retinoscope?: { streakAxis, streakWidth, sleeve: 'plane'|'concave', sourceDistance, sweep, peephole, intensity }
LensElement.role?: 'trial'                     // Messglas
LensElement.trialPrism?: { amount, base }      // cm/m, TABO-Basislage
EyeEntity.patient?: { age, accommodates, amplitude? }
EyeAnatomy.corneaAsphericity?: number          // Q (Standard 0 = sphärisch, typisch −0,26)
EyeViewMode += 'fluorescein'
MediumRef.abbe?: number
SceneDocument.refraction?: { testDistance, chart, pinhole, pinholeDiameter, jcc? }
SceneDocument.training?: { id, title, age, complaint, hidden, workingDistance, startedAt, submitted? }
```

- **Migration:** `migrateV2toV3` setzt `display.workbench = 'free'`. Alle übrigen Felder sind optional, sodass Phase-1/2/3-Szenen unverändert rechnen. Getestet in `tests/phase4.training.test.ts`.
- **Präferenzen:** `expertMode` (Standard/Experte) und `visionQuality` ('standard' | 'high': hoch = chromatische Patientensicht mit getrennten R/G/B-Kernen).
- **Material:** `OpticalMaterial { id, name, category, n_d, abbe, density?, dk?, waterContent?, uvCutoff?, modulus?, wettingAngle?, fdaGroup?, … }`. Die Legacy-IDs aus Phase 1–3 bleiben mit identischem n erhalten.

---

## 5. Arbeitsbereiche

Die Reiter sitzen oben über der Szene; das Dock liegt unten und ist einklappbar. „Frei“ ist die bisherige CAD-Oberfläche.

**Skiaskopie**

- Skiaskop wird automatisch vor dem Auge platziert (Standard 67 cm).
- Pupillenreflex: ziehen oder automatischer Schwenk.
- Einstellbar: Strichlage, Plan-/Konkavspiegel, Strichbreite, Helligkeit, Guckloch (Experte).
- Messglas mit Sph/Cyl/Achse.
- Beobachtung: Bewegung, Geschwindigkeit, Breite, Helligkeit, Break/Skew.
- Experte: Hauptschnitte. Außerdem Neutralisationsglas, Arbeitsabstandskorrektur mit Rechenweg und Training.

**Refraktion**

- Messglas; Nebeln +0,75 und −0,25.
- Autorefraktometer (im Training gesperrt).
- Prüfentfernung, Lochblende, Alter/Akkommodation, Prisma.
- Kreuzzylinder mit beiden Wendestellungen und Patientenantwort.
- Sehzeichen: Landolt, Buchstaben, Zahlen, Fächer, Rot-Grün, Alltagsszene.
- Visus-Schätzung und Vorher/Nachher.

**Patientensicht**

- Netzhautbild ohne und mit Korrektion.
- PSF-Ansicht, Unschärfe in Winkelminuten.
- Beispiele (Emmetropie, Myopie, Hyperopie jung/alt, Astigmatismus).

**Kontaktlinse**

- Formstabile KL aufsetzen.
- Fluoreszeinbild mit Gelbfilter, optischer Zone und Klick-Sonde, die **Messwert** und **Interpretation** getrennt anzeigt.
- Bearbeitbar: BC, Ø, OZ, Dezentration, periphere Kurven (Editor, Standardperipherie), Hornhautradius und Q.
- Material mit Dk/t, Tränenlinse, Sitzanalyse, 3D-Fluo-Ansicht.
- Steht noch ein Messglas vor dem Auge, weist das Panel auf die Überrefraktion hin.

**Inspector**

- Reiter *Eigenschaften*, *Fachinfo* und *Werkzeuge*.
- Die Werkzeuge übernehmen die Werte der Auswahl, z. B. HSA-Umrechnung mit „Glas umsetzen“.

**Standard/Experte:** Im Standardmodus sind Detailfelder ausgeblendet: Linsen-/Kammerindizes, Q, nF/nC, Dichte, UV, Modul, Hauptschnitte und Gucklochgröße.

---

## 6. Grenzen

- Keine Aberrationen höherer Ordnung (sphärische Aberration, Koma), keine Streuung, keine Blendung.
- Skiaskopie: kein Scherenphänomen und kein „Against-the-rule“-Artefakt durch Pupillenrand.
- Weiche KL: kein Fluoreszeinbild (fachlich korrekt: Fluoreszein färbt Hydrogele) – das Panel sagt das.
- Sitz: statisch, ohne Schwerkraft, Lidkräfte und Bewegung.
- Binokulare Tests (Kreuztest, Polatest, Phorien) sind nicht enthalten. Das Prisma wirkt nur monokular als Bildverschiebung.
- Spaltlampe und Topograf sind weiterhin „In Entwicklung“ (Modulregistry).
- Die Patientensicht zeigt das Netzhautbild, nicht die neuronale Wahrnehmung.

---

## 7. Performance

- **PSF und Faltung** laufen in einem **Web Worker** (`patient/psf.worker.ts`, ≈ 18 kB):
  - FFT 512² je Kanal.
  - Nur der jeweils neueste Auftrag wird angezeigt, veraltete Ergebnisse werden verworfen.
  - Der Hauptthread bleibt frei.
- **Qualität „hoch“** rechnet drei chromatische Kerne statt eines.
- **Skiaskopie-Reflex:** analytisch pro Pixel (Canvas 280 px), kein Raytracing. Der automatische Schwenk rendert nur das Canvas neu, nicht die 3D-Szene.
- **Fluoreszeinbild:** 200×200 Dickenauswertung, memoisiert auf Linse und Auge.
- **Raytracing:** Cache je Wellenlänge; Instrumente sind vom Tracing ausgenommen.
- **Laden:** Arbeitsbereichs-Panels werden lazy geladen (5–15 kB je Panel). Das Hauptbundle ist durch three.js ≈ 1,8 MB (≈ 512 kB gzip).
- **Messung:** In der Test-Umgebung (Software-Rendering Swiftshader, 2 Kerne) braucht der erste Aufbau eines Arbeitsbereichs einige Sekunden. Danach laufen 60 fps im Leerlauf. Auf Geräten mit GPU ist das deutlich schneller.

---

## 8. Vorbereitung Industrie / Cloud

- **Rechenkerne:** frei von UI und Browser-APIs (außer dem Worker). Sie sind damit serverseitig nutzbar, z. B. für Stapelauswertung und Prüfungsfälle mit serverseitig verborgener Wahrheit.
- **Trainingsfälle:** per Seed reproduzierbar. Die Auswertung ist eine reine Funktion, also serverseitig prüfbar.
- **Materialbibliothek:** eine Liste mit Kategorien. Sie lässt sich durch eine Hersteller-/Katalog-API ersetzen; Schnittstelle `findMaterial` / `materialsForElement`.
- **Instrumente:** in einer Registry, neue Geräte als Parametersatz und Panel.
- **Dokumente:** schema-versioniert (v3) mit Migrationskette; der Import älterer Dateien bleibt erhalten.
- **Bewusst noch nicht umgesetzt:**
  - echtes Backend und Authentifizierung
  - Mehrbenutzer-Synchronisation
  - Protokoll-/Befundexport (PDF)
  - Anbindung realer Geräte (Autorefraktometer, Topograf)

---

## Tests

| Datei | Inhalt |
|---|---|
| `tests/phase4.retinoscopy.test.ts` | Neutralpunkt bei −1/w, Mit-/Gegenbewegung, Konkavspiegel-Umkehr, Astigmatismus/Break, Schwenk, Neutralisationsglas, Arbeitsabstand |
| `tests/phase4.vision.test.ts` | Akkommodation, PSF-Moment p·\|D\|, Visus-Monotonie, JCC, Nebeln, Rot-Grün-LCA, Raytracing blau vor rot |
| `tests/phase4.fluorescein.test.ts` | Intensitätskurve, Klassen, Steil/Flach/Parallel, Dezentration auf asphärischer Hornhaut, Sonde |
| `tests/phase4.materials.test.ts` | Bibliothek, Dk/t, Hydrogel-Dk, Filter je Element, Dispersion, Rechner (HSA, Prentice, K, Tränenlinse …) |
| `tests/phase4.training.test.ts` | Migration v2 → v3, Fallgenerator, Fall anwenden, Auswertung |
| `tests/e2e/phase4.e2e.mjs` | Skiaskop öffnen, bewegen, neutralisieren; Refraktion Sph/Cyl/Achse, Lochblende, Rot-Grün, JCC; Patientensicht; KL → Fluoreszein, Sonde, 3D-Fluo, Materialwechsel; Speichern + Neuladen; Training; Experte; Inspector-Reiter |
