# Optical Eye Lab

Interaktive 3D-Simulationsumgebung für Augenoptik – **Phase 1: Grundsystem**.

Ein virtuelles optisches Labor mit parametrischem Modellauge (Le Grand), frei platzierbaren optischen Elementen, CAD-Bedienung, Bemaßung, optischer Achse, Inspector und lokalem Speichern. Die Architektur ist auf spätere Module (Fehlsichtigkeit, Kontaktlinsensitz, Skiaskopie, Lernmodus …) vorbereitet.

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
| `npm test` | Unit-Tests der Optik- und Raytracing-Engine |

Alles läuft lokal – kein Backend, kein Login, keine externen Dienste.

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

`Q` Auswahl · `W` Verschieben · `E` Drehen · `S` Einrasten · `L` Welt/Lokal · `A` Element hinzufügen · `F` Auswahl fokussieren · `G` Auge fokussieren · `H` Szene fokussieren · `1`/`3`/`7` Front/Seite/Oben · `5` Perspektive ↔ Ortho · `X` Normal ↔ Schnitt · `M` Bemaßung · `T` Strahlengang · `Leertaste` Strahlengang live/pausiert · `⌘/Strg+Z` Rückgängig · `⌘/Strg+S` Speichern · `Entf` Löschen

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

## Konventionen

- **1 Three.js-Einheit = 1 mm.** Winkel im Datenmodell in Grad, Brechkraft in dpt.
- **Licht läuft in +Z.** Das Auge schaut nach −Z; sein lokaler Ursprung ist der **Hornhautscheitel**, +Z zeigt ins Auge.
- **Radien-Vorzeichen:** r > 0 → Krümmungsmittelpunkt liegt in Lichtrichtung hinter dem Scheitel. `0` = plan.
- **Element-Ursprung** = Mitte zwischen Vorder- und Rückscheitel; lokale +Z-Achse = optische Achse des Elements.
- **Prisma-Basislage** (Frontansicht auf das Auge): 0° rechts · 90° oben · 180° links · 270° unten.

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
├─ modules/registry.ts   Erweiterungspunkt für Fachmodule (derzeit nur geplant)
└─ ui/                   Oberfläche: Toolbar, Szenenbaum, Inspector, Dialoge, HUD
```

**Datenfluss:** UI und Gizmo ändern das `SceneDocument` ausschließlich über Store-Actions → Szene, Messungen, Physik und Raytracing leiten alles daraus ab (keine doppelte Wahrheit). Physik und Raytracing sind rein funktional und ohne Three.js/React testbar.

### Erweitern

- **Neues optisches Element:** Eintrag in `model/elementRegistry.ts` (Standardwerte + Felder). Passt es zu einer vorhandenen Familie (`lens`, `prism`, `plate`, `medium`), sind Darstellung, Raytracing und Inspector automatisch vorhanden. Für eine neue Familie: Typ in `model/types.ts`, Geometrie in `scene/elements/`, Körper in `engine/raytracing/solids.ts`.
- **Neues Medium:** Eintrag in `model/media.ts`.
- **Neues Fachmodul:** Beschreibung in `modules/registry.ts`; Schnittstelle für Inspector-Abschnitte, Szenen-Overlays und Berechnungen ist dort definiert.
- **Schema-Änderung:** `SCHEMA_VERSION` erhöhen und Migration in `state/persistence.ts → migrateDocument` ergänzen.

---

## Bekannte Grenzen (bewusst, Phase 1)

- Strahlengang ist eine **Vorschau**: nur sphärische/plane Flächen, keine Dispersion, keine Fresnel-Verluste, kein Tränenfilm (Luftspalt statt Tränenlinse), homogene Augenlinse.
- Keine Refraktionssimulation, Skiaskopie, Fluoreszein, Sitzberechnung, Aberrationen höherer Ordnung, Lernmodus – vorbereitet, aber nicht umgesetzt.
- Die Szene ist für Desktop, Notebook und Tablet im Querformat ausgelegt.
