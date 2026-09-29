/**
 * Modul-Registry (Phase 5) – EINZIGE Quelle für die fachlichen Module der Anwendung.
 *
 * Ein Modul ist ein fokussierter Arbeitsbereich zu einem Thema (Skiaskopie, Refraktion, …). Es nutzt
 * dieselbe Simulation (SceneDocument), dieselbe Physik und dieselben Panels wie der vollständige Simulator:
 *   - `workbench` verweist auf das Panel (src/workbench/*), das im Simulator als Dock und im Modul
 *     als Hauptinhalt erscheint – keine doppelte Oberfläche.
 *   - `createScene` liefert die Startszene einer neuen Modul-Sitzung (aus den zentralen Demo-Szenen).
 * Aus der Registry leiten sich ab: Dashboard-Kacheln, Modulübersicht (/modules), Modulseite
 * (/modules/:id), Arbeitsbereich-Reiter im Simulator und die Modulliste in den Einstellungen.
 *
 * Neues Modul: Eintrag hier + (falls aktiv) Panel in src/workbench und WorkbenchId in model/types.ts.
 * Geplante Module (status 'planned') erscheinen deaktiviert mit „In Entwicklung“.
 */
import type { LucideIcon } from 'lucide-react';
import { Blend, CircleDot, Eye, Glasses, Microscope, Orbit, ScanEye, Sparkles, SquareStack, Telescope } from 'lucide-react';
import type { SceneDocument, WorkbenchId } from '@/model/types';
import { buildPreset } from '@/state/presets';

export type ModuleStatus = 'active' | 'preview' | 'planned';
export type ModuleGroup = 'Untersuchung' | 'Korrektion & Anpassung' | 'Visualisierung';

export interface ModuleDefinition {
  id: string;
  title: string;
  /** Kurztitel für Reiter und Navigation */
  short: string;
  /** Ein Satz: worum geht es? */
  tagline: string;
  description: string;
  /** Was man im Modul lernt / tun kann */
  goals: string[];
  icon: LucideIcon;
  group: ModuleGroup;
  status: ModuleStatus;
  /** Panel des Arbeitsbereichs (aktive Module) */
  workbench?: Exclude<WorkbenchId, 'free'>;
  /** Startszene einer neuen Sitzung */
  createScene?: () => SceneDocument;
  /** 3D-Ansicht beim Öffnen einblenden? */
  show3d?: boolean;
}

const scene = (presetId: string, workbench: Exclude<WorkbenchId, 'free'>, name: string, patch?: (d: SceneDocument) => SceneDocument) => () => {
  let d = buildPreset(presetId);
  d = { ...d, name, display: { ...d.display, workbench } };
  return patch ? patch(d) : d;
};

export const MODULES: ModuleDefinition[] = [
  {
    id: 'retinoscopy',
    title: 'Skiaskopie',
    short: 'Skiaskopie',
    tagline: 'Strichskiaskopie mit Reflexbeobachtung, Neutralisation und Trainingsfällen.',
    description: 'Reflexbewegung, Geschwindigkeit, Breite und Helligkeit folgen aus der Vergenzrechnung. Neutralisieren mit Messglas, Arbeitsabstand korrigieren, unbekannte Patienten skiaskopieren.',
    goals: ['Mit- und Gegenbewegung erkennen', 'Hauptschnitte und Achse finden', 'Neutralisieren und Arbeitsabstand abziehen'],
    icon: Sparkles,
    group: 'Untersuchung',
    status: 'active',
    workbench: 'retinoscopy',
    show3d: true,
    createScene: scene('astigmatism', 'retinoscopy', 'Skiaskopie', (d) => ({ ...d, eye: { ...d.eye, viewMode: 'normal' }, display: { ...d.display, showRays: false } })),
  },
  {
    id: 'refraction',
    title: 'Refraktion',
    short: 'Refraktion',
    tagline: 'Subjektive Refraktion mit Messglas, Nebel, Kreuzzylinder und Rot-Grün-Test.',
    description: 'Sphäre, Zylinder und Achse bestimmen, Visus beurteilen, Akkommodation beachten – der Patient antwortet aus der berechneten Netzhautunschärfe.',
    goals: ['Bestes sphärisches Glas finden', 'Zylinder mit dem Kreuzzylinder abgleichen', 'Rot-Grün-Abgleich und Nebeln'],
    icon: Glasses,
    group: 'Untersuchung',
    status: 'active',
    workbench: 'refraction',
    createScene: scene('astigmatism', 'refraction', 'Refraktion', (d) => ({ ...d, eye: { ...d.eye, viewMode: 'normal', patient: { age: 30, accommodates: true } }, display: { ...d.display, showRays: false } })),
  },
  {
    id: 'patient-view',
    title: 'Patientensicht',
    short: 'Patientensicht',
    tagline: 'So sieht der Patient: Netzhautbild aus Defokus, Zylinder und Pupille.',
    description: 'Faltung des Sehzeichens mit der Punktbildfunktion (Web Worker), Vergleich unkorrigiert/korrigiert, Visus-Schätzung und Beispiele.',
    goals: ['Unschärfe durch Myopie, Hyperopie, Astigmatismus sehen', 'Einfluss von Pupille und Akkommodation', 'Vorher/Nachher vergleichen'],
    icon: Eye,
    group: 'Visualisierung',
    status: 'active',
    workbench: 'patient-view',
    createScene: scene('myopia', 'patient-view', 'Patientensicht'),
  },
  {
    id: 'contact-lens',
    title: 'Kontaktlinse',
    short: 'Kontaktlinse',
    tagline: 'Formstabile Linsen: Fluoreszeinbild, Sitz, Tränenlinse und Material.',
    description: 'Fluoreszeinbild aus der Tränenfilmgeometrie (Basiskurve, periphere Kurven, Hornhaut-Q, Dezentration), Messwert und Deutung getrennt, Dk/t.',
    goals: ['Steil, flach und parallel unterscheiden', 'Tränenlinse berechnen', 'Material nach Dk/t wählen'],
    icon: CircleDot,
    group: 'Korrektion & Anpassung',
    status: 'active',
    workbench: 'contact-lens',
    show3d: true,
    createScene: scene('rgp-tear-lens', 'contact-lens', 'Kontaktlinse'),
  },
  {
    id: 'spectacle-lens',
    title: 'Brillenglas',
    short: 'Brillenglas',
    tagline: 'Glasdicke, Gewicht und Material: Mitten- und Randdicke aus der echten Geometrie.',
    description: 'Wirkung, Basiskurve, Material, Formscheibe, Zentrierung und Mindestdicken bestimmen Mitten- und Randdicke. Vergleich aller Materialien bei gleicher Wirkung.',
    goals: ['Plus: Mittendicke, Minus: Randdicke verstehen', 'Materialwahl nach Dicke, Gewicht und Abbe-Zahl', 'Einfluss von Durchmesser und Zentrierung'],
    icon: SquareStack,
    group: 'Korrektion & Anpassung',
    status: 'active',
    workbench: 'spectacle-lens',
    show3d: true,
    createScene: scene('eye-spectacle', 'spectacle-lens', 'Brillenglas'),
  },
  {
    id: 'slit-lamp',
    title: 'Spaltlampe',
    short: 'Spaltlampe',
    tagline: 'Beleuchtungsarten und optischer Schnitt.',
    description: 'Geplant: diffuse, direkte und indirekte Beleuchtung, optischer Schnitt, Kobaltblau (Fluo bereits im Modul Kontaktlinse).',
    goals: [],
    icon: Microscope,
    group: 'Untersuchung',
    status: 'planned',
  },
  {
    id: 'topography',
    title: 'Topograf',
    short: 'Topograf',
    tagline: 'Hornhauttopografie: Radien- und Brechwertkarten.',
    description: 'Geplant: Placido-Auswertung, axiale/tangentiale Karten, Exzentrizität – nutzt das Hornhautmodell (Radien, Q) der Simulation.',
    goals: [],
    icon: Orbit,
    group: 'Untersuchung',
    status: 'planned',
  },
  {
    id: 'binocular',
    title: 'Binokulartests',
    short: 'Binokular',
    tagline: 'Phorien, Fusion und Prismen im beidäugigen Sehen.',
    description: 'Geplant: Kreuztest, Zeigertest, Polatest-Prinzip, Prismenkorrektion – benötigt ein zweites Auge im Modell.',
    goals: [],
    icon: Blend,
    group: 'Untersuchung',
    status: 'planned',
  },
  {
    id: 'ophthalmoscope',
    title: 'Ophthalmoskop',
    short: 'Ophthalmoskop',
    tagline: 'Direkte Ophthalmoskopie und Fundusbild.',
    description: 'Geplant: Sehfeld, Vergrößerung und Refraktionsausgleich – benötigt ein Netzhautmodell.',
    goals: [],
    icon: ScanEye,
    group: 'Untersuchung',
    status: 'planned',
  },
  {
    id: 'optics-bench',
    title: 'Optische Bank',
    short: 'Optische Bank',
    tagline: 'Freie Optik: Linsen, Prismen, Strahlengang.',
    description: 'Wird über „Vollständiger Simulator“ genutzt (Vorlage „Freie optische Bank“).',
    goals: [],
    icon: Telescope,
    group: 'Visualisierung',
    status: 'planned',
  },
];

export const MODULE_GROUPS: ModuleGroup[] = ['Untersuchung', 'Korrektion & Anpassung', 'Visualisierung'];

export const findModule = (id: string | undefined) => MODULES.find((m) => m.id === id);
export const activeModules = () => MODULES.filter((m) => m.status !== 'planned' && m.workbench);
/** Modul, das zu einem Arbeitsbereich des Simulators gehört */
export const moduleForWorkbench = (wb: WorkbenchId | undefined) => MODULES.find((m) => m.workbench && m.workbench === wb);

/* ----------------------------------------------------------------------------
 * Fachliche Fähigkeiten des Simulators (Status-Übersicht in den Einstellungen,
 * Geräte im Dialog „Element hinzufügen“). Getrennt von den Modulen oben.
 * -------------------------------------------------------------------------- */

export type CapabilityCategory = 'Optische Simulation' | 'Kontaktlinsen' | 'Untersuchungsgeräte' | 'Lernmodus';

export interface Capability {
  id: string;
  title: string;
  category: CapabilityCategory;
  status: ModuleStatus;
  description: string;
}

export const CAPABILITIES: Capability[] = [
  { id: 'raytracing', title: 'Strahlengang', category: 'Optische Simulation', status: 'active', description: 'Geometrische Strahlverfolgung (Snellius), torische Flächen, Dispersion.' },
  { id: 'ametropia', title: 'Fehlsichtigkeiten', category: 'Optische Simulation', status: 'active', description: 'Myopie, Hyperopie, Astigmatismus; Akkommodation. Presbyopie über Alter/Akkommodationsbreite.' },
  { id: 'correction', title: 'Korrektion & HSA', category: 'Optische Simulation', status: 'active', description: 'Effektive Brechkraft, Hornhautscheitelabstand, Vollkorrektion.' },
  { id: 'lens-thickness', title: 'Glasdicke & Gewicht', category: 'Optische Simulation', status: 'active', description: 'Mitten-/Randdicke aus Geometrie und Mindestdicken, Zentrierung, Volumen und Gewicht (Phase 5).' },
  { id: 'patient-view', title: 'Patientensicht', category: 'Optische Simulation', status: 'active', description: 'Unschärfe aus Defokus, Zylinder und Pupille (PSF-Faltung), Visus-Schätzung.' },
  { id: 'tear-lens', title: 'Tränenlinse', category: 'Kontaktlinsen', status: 'active', description: 'Tränenfilm zwischen Kontaktlinse und Hornhaut.' },
  { id: 'fluorescein', title: 'Fluoreszeinbild', category: 'Kontaktlinsen', status: 'active', description: 'Fluoreszeinbild formstabiler Linsen aus der Tränenfilmgeometrie.' },
  { id: 'lens-fit', title: 'Linsensitz', category: 'Kontaktlinsen', status: 'preview', description: 'Zentrierung, Auflage, Randunterspülung (statisch; Lidschlag-Bewegung geplant).' },
  { id: 'retinoscope', title: 'Skiaskop', category: 'Untersuchungsgeräte', status: 'active', description: 'Strichskiaskopie mit Reflexbewegung, Neutralisation und Training.' },
  { id: 'phoropter', title: 'Messbrille / Phoropter', category: 'Untersuchungsgeräte', status: 'active', description: 'Subjektive Refraktion mit Messglas, Kreuzzylinder, Nebeln, Rot-Grün.' },
  { id: 'keratometer', title: 'Keratometer', category: 'Untersuchungsgeräte', status: 'active', description: 'Hornhautradien und Brechwerte (Inspector → Werkzeuge).' },
  { id: 'lensmeter', title: 'Scheitelbrechwertmesser', category: 'Untersuchungsgeräte', status: 'active', description: 'Scheitelbrechwert und Prisma eines Glases (Inspector → Werkzeuge).' },
  { id: 'slit-lamp', title: 'Spaltlampe', category: 'Untersuchungsgeräte', status: 'planned', description: 'Beleuchtungsarten und Spaltbild (Kobaltblau/Fluo bereits im Arbeitsbereich Kontaktlinse).' },
  { id: 'ophthalmoscope', title: 'Ophthalmoskop', category: 'Untersuchungsgeräte', status: 'planned', description: 'Direkte Ophthalmoskopie – benötigt ein Netzhautmodell.' },
  { id: 'learning', title: 'Lernmodus', category: 'Lernmodus', status: 'preview', description: 'Formel, eingesetzte Werte und Herleitung (ⓘ), Fachinfo, Trainingsfälle.' },
];

export const capabilitiesByCategory = (c: CapabilityCategory) => CAPABILITIES.filter((m) => m.category === c);
