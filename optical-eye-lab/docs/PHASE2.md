# Phase 2 – Fehlsichtigkeit, Sph/Cyl/Achse, torische Optik, Tränenlinse

Stand: 0.2.0 · Schema-Version 2

## Architekturentscheidung: eine Quelle der Wahrheit

**Die Geometrie ist primär.** Gespeichert werden ausschließlich Radien (je Hauptschnitt), Achslagen, Dicken und Brechungsindizes.
Sphäre / Zylinder / Achse werden **immer** daraus berechnet und nie separat gespeichert. Die Eingabe optischer Werte löst die Geometrie (Löser) und schreibt nur Geometrie zurück. Dadurch kann nie ein angezeigter Wert von der tatsächlichen Wirkung abweichen.

| Objekt | Primär gespeichert | Abgeleitet |
|---|---|---|
| Linse / Brillenglas / KL | `lens.frontRadius(2)/frontAxis`, `lens.backRadius(2)/backAxis`, `centerThickness`, `medium.n` | Scheitelbrechwert-Matrix → Sph/Cyl/A, Hauptschnitte |
| Auge | `anatomy` (inkl. `corneaFrontRadius2`, `corneaAxis`, `axialLength`) | Refraktion am Hornhautscheitel (Sph/Cyl/A), Brennlinien |
| Aufgesetzte KL | `contact.centration`, `contact.tilt`, `contact.tearFilmThickness` | `transform` (Constraint `applyConstraints`) |

Nicht eindeutig umkehrbare Fälle werden gekennzeichnet (z. B. Hinweis bei zwei torischen Flächen mit unterschiedlicher Achse, Meldung „nicht realisierbar“ bei zu kleinem Radius).

## 1. Geänderte und neue Dateien

**Neu**
- `src/core/math/powerMatrix.ts` – Rezept ↔ Wirkungsmatrix, Transposition, Hauptschnitte, Effektivität, Scheitelbrechwert (Matrix)
- `src/engine/physics/eyeRefraction.ts` – Refraktionsstatus, Ametropie-Löser (Achse/Brechung/Auto)
- `src/engine/physics/lensOptics.ts` – Wirkung aus Geometrie, Linsendesign aus Rezept
- `src/engine/physics/contactLens.ts` – Tränenlinse, Sitzklasse
- `src/engine/physics/correction.ts` – Korrektion live, Restrefraktion (Vergenz-Matrixrechnung)
- `src/engine/physics/explain.ts` – Erklärungen (Formel, eingesetzte Werte, Ergebnis, Text)
- `src/model/derived/effectiveLens.ts` – wirksame Geometrie (weiche KL angeschmiegt), Hornhautfläche
- `src/model/derived/contactSeat.ts` – KL-Sitz-Constraint, Tränenraumprofil, Auflageberechnung
- `src/scene/elements/TearFilmView.tsx` – Tränenfilm-Dickenkarte in 3D
- `src/ui/common/RxEditor.tsx`, `src/ui/common/Explain.tsx` – Rezepteingabe, Info-Popover
- `src/ui/inspector/LensInspector.tsx` – Inspector mit Modus Optische Werte / Geometrie
- `tests/phase2.*.test.ts`, `tests/e2e/*.e2e.mjs`, `docs/PHASE2.md`

**Erweitert**
- `src/core/math/surfaces.ts` (SurfaceSpec, Bikonik, Krümmungsmatrix, allgemeine Randdickenprüfung), `src/core/math/vec.ts` (Matrixprodukt, Euler-Rückrechnung)
- `src/model/types.ts` (Schema 2), `src/model/elementRegistry.ts` (KL-Standardwerte), `src/model/sceneFactory.ts` (Aufsetzen), `src/model/derived/elementShape.ts`, `src/model/derived/infoCards.ts`
- `src/engine/raytracing/csg.ts` (torische Flächen, Rahmenwechsel), `solids.ts` (Tränenfilm-Körper, `sceneSolids`), `eyeTracer.ts` (torische Hornhaut), `tracer.ts` (koinzidente Grenzflächen, Meridian-Abtastung, Brennlinien, Hauptschnitt-Fächer), `types.ts`
- `src/state/store.ts` (Constraints in jedem Commit, KL-Verschieben = Zentrierung), `persistence.ts` (Migration v1→v2, Präferenzen), `presets.ts` (10 Demo-Szenen)
- `src/scene/...` (torische Geometrie, Brennlinien, Tränenfilm), `src/ui/...` (Refraktionsstatus, Korrektion, Lichtquellen/Geräte, Maßkette)

## 2. Neue Datenmodelle (alle Felder optional → alte Szenen bleiben ladbar)

```ts
LensParams      += frontRadius2?, frontAxis?, backRadius2?, backAxis?          // torische Flächen (TABO)
EyeAnatomy      += corneaFrontRadius2?, corneaAxis?                           // torische Hornhaut
EyeEntity       += ametropiaMode?: 'auto' | 'axial' | 'refractive'
ContactLensParams += onEye?, tearFilm?, nTear?, centration?{x,y}, tilt?{x,y},
                     opticZoneDiameter?, peripheralCurves?[{radius,width}], edgeThicknessNominal?, eccentricity?
LightSource.source += fanMode?, intensity?, lineLength?, vergence?, deviceRole?, observationAxis?
                      kind: 'parallel' | 'point' | 'line'(vorbereitet)
Preferences     += cylForm: 'minus' | 'plus', paramMode: 'optical' | 'geometry'
```

Migration `migrateV1toV2` (state/persistence.ts): KL, die zentriert auf der Hornhaut saßen, werden als „aufgesetzt“ markiert, der Tränenfilm wird aktiviert und die neuen Felder erhalten Standardwerte. Lichtquellen bekommen den Fächermodus `principal`. Getestet in `tests/phase2.presets.test.ts`.

## 3. Formeln

Einheiten: Radien in mm, Brechkraft in dpt (1/m). Für Dioptrien-Formeln werden Längen immer in Meter umgerechnet.
Radius-Vorzeichen wie in Phase 1: r > 0 heißt, der Krümmungsmittelpunkt liegt in Lichtrichtung hinter dem Scheitel.
Achsen nach TABO (Blick auf das Auge, 0° rechts, gegen den Uhrzeigersinn, Bereich (0°, 180°]).

| Größe | Formel |
|---|---|
| Rezept → Matrix | F = Sph·I + Cyl·p·pᵀ, p = (−sin A, cos A) |
| Wirkung im Meridian φ | F(φ) = Sph + Cyl·sin²(φ − A) |
| Transposition | Sph′ = Sph + Cyl, Cyl′ = −Cyl, A′ = A ± 90° |
| Flächenbrechwert (torisch) | F = (n′ − n)·K, K = kₐ·a·aᵀ + k_b·p·pᵀ |
| Scheitelbrechwert | S′ = (I − δF₁)⁻¹F₁ + F₂, δ = d/n |
| Linsendesign | F₂ = T − (I − δF₁)⁻¹F₁ (Brillenglas) · F₁ = X(I + δX)⁻¹, X = T − F₂ (KL) |
| Effektivität / HSA | F_HS = F·(I − d·F)⁻¹ (skalar: F/(1 − d·F)) |
| Vergenz-Übertragung | L ← L·(I − (d/n)·L)⁻¹ |
| Restrefraktion | R = A_Auge − L_HS |
| Tränenlinse | S′_TL aus F₁ = (n_T − 1)·K_KL, F₂ = (1 − n_T)·K_HH, d = t_T |
| Augenrefraktion | A = 1/a_R, Fernpunkt durch paraxiale Rückwärtsabbildung der Retina (y-nu, alle 4 Flächen) |
| Achsenametropie | Baulänge = paraxialer Bildort des Fernpunkts (exakt, keine Faustregel) |
| Brechungsametropie | Hornhautradius je Hauptschnitt per Bisektion auf A(r) = A_Ziel |
| Raytracing | vektorielles Snellius-Gesetz t = ηd + (η cos ε₁ − cos ε₂)N, Totalreflexion |
| Brennlinien | Fokus D(φ) in 36 Meridianen, Anpassung D = a + b·cos2φ + c·sin2φ |

## 4. Vereinfachungen (im Programm gekennzeichnet)

- **Torische Fläche als Bikonik:** Beide Hauptschnitte sind exakt. Außerhalb davon weicht sie von einem echten Torus erst in höherer Ordnung ab.
- **Rezept- und Korrektionsrechnung sind paraxial:** Dezentration und Neigung werden dort ignoriert (Hinweis im Inspector). Das Raytracing berücksichtigt sie.
- **Weiche KL, Schmiegung:** Die Rückfläche übernimmt die Hornhautform plus Tränenfilm, die Nennwirkung bleibt. Nicht modelliert sind Biegungsverluste, Dickenänderung und Randverhalten.
- **Sitzmodell:** Die Linse folgt der Hornhautnormale am Zentrierpunkt. Optische Zone, periphere Kurven, Exzentrizität und nominale Randdicke werden gespeichert, beeinflussen aber noch nichts.
- **Tränenraumprofil** wird entlang der Augenachse gemessen (Sehrichtung). Negative Werte bedeuten Auflage.
- **Kreis kleinster Verwirrung:** Als geometrische Mitte zwischen den Brennlinien.
- **Weitere Grenzen:**
  - Keine Dispersion (n gilt für die d-Linie) und keine Fresnel-Verluste.
  - Die Augenlinse ist homogen.
  - Prismen, Platten und freie Medien wirken nur im Raytracing, nicht in der Rezeptrechnung.
- **Ametropie-Löser:** Er geht vom Le-Grand-Normalauge aus. Achsenametropie setzt den Hornhautradius im Achsmeridian auf 7,80 mm, Brechungsametropie setzt die Baulänge auf 24,20 mm.

## 5. Grundlage für Phase 3

- **Skiaskopie:**
  - Lichtquellen haben schon Arbeitsabstand, Vergenz, Intensität, Linienform, Geräterolle und Beobachtungsachse im Datenmodell.
  - Das Raytracing verfolgt beliebige Quellen durch torische Systeme.
  - `meridianScan` liefert die Fokuslage je Meridian, die Grundlage für Mit- und Gegenbewegung sowie die Neutralisation.
- **Fluoreszein:**
  - `computeTearProfile()` und `tearThicknessAt()` liefern die lokale Tränenfilmdicke als Raster.
  - `TearFilmView` zeigt sie bereits als Dickenkarte.
  - Später wird daraus: Dicke → Fluoreszenzintensität → Fluobild.
- **KL-Anpassung und -Sitz:**
  - Zentrierung, Neigung und Sitzklasse sind vorhanden (`seatFrameLocal`, `applyConstraints`).
  - `tearThicknessForBearing` ist ein einfaches Auflagemodell.
  - Optische Zone und periphere Kurven sind angelegt.
- **Keratometrie:** Die torische Hornhaut mit Radien je Hauptschnitt ist vorhanden (`corneaSpec`, `radiusInMeridian`).
- **Lernmodus:** Jeder berechnete Wert kann eine `Explanation` tragen (Formel, eingesetzte Werte, Ergebnis, Text).
