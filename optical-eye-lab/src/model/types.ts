/**
 * Zentrales Datenmodell der Szene.
 *
 * Grundsätze:
 *  - Alle Längen in mm, Winkel in Grad (siehe core/units.ts).
 *  - Das Datenmodell ist reines JSON (serialisierbar, versioniert) – keine Three.js-Objekte.
 *  - Rendering, Physik und Raytracing lesen dieses Modell, verändern es aber nie direkt.
 *  - Neue Objektarten werden über model/elementRegistry.ts ergänzt.
 */
import type { Vec3 } from '@/core/math/vec';

export type { Vec3 };

/**
 * Schema-Historie:
 *  1 – Phase 1
 *  2 – Phase 2: torische Flächen, torische Hornhaut, Refraktionsmodell des Auges,
 *      erweiterte Kontaktlinse (Sitz, Tränenfilm, Zonen), erweiterte Lichtquellen
 *  3 – Phase 4: Arbeitsbereiche, Skiaskop, Akkommodation/Patient, Hornhaut-Asphärizität,
 *      Messglas-Rolle, Fluoreszein-Ansicht, Trainingsfälle (alle Felder optional)
 */
export const SCHEMA_VERSION = 3;

/* ------------------------------------------------------------------ */
/* Gemeinsame Bausteine                                                */
/* ------------------------------------------------------------------ */

export interface Transform {
  /** Position in mm (Weltkoordinaten) */
  position: Vec3;
  /** Euler-Rotation in Grad (Reihenfolge XYZ) */
  rotation: Vec3;
  /** Skalierung (nur für freie Medien sinnvoll; optische Maße werden über Parameter gesteuert) */
  scale: Vec3;
}

export type EntityType = 'eye' | 'element' | 'light' | 'measure-point';

export interface EntityBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  notes?: string;
}

/** Referenz auf ein optisches Medium (Preset-ID oder „custom“). */
export interface MediumRef {
  presetId: string;
  /** Brechungsindex n_d */
  n: number;
  /** Abbe-Zahl ν_d – Dispersion (Phase 4): n(λ) aus n_d und ν_d (Cauchy-Näherung) */
  abbe?: number;
}

export type SurfaceFinish = 'clear' | 'coated' | 'tinted' | 'frosted';

export interface Appearance {
  /** Farbton des Materials (Hex) */
  tint: string;
  /** Transparenz 0 … 1 (1 = maximal durchsichtig) */
  transparency: number;
  finish: SurfaceFinish;
}

/**
 * Platzhalter für zukünftige physikalische Parameter (Asphärizität, Torizität,
 * Dispersion, Absorption, Wassergehalt, Dk-Wert …). Module können hier
 * eigene Schlüssel ablegen, ohne das Kernschema zu brechen.
 */
export type PhysicsExtension = Record<string, number | string | boolean>;

/* ------------------------------------------------------------------ */
/* Optische Elemente                                                   */
/* ------------------------------------------------------------------ */

export type LensKind =
  | 'converging-lens'
  | 'diverging-lens'
  | 'plano-convex'
  | 'plano-concave'
  | 'biconvex'
  | 'biconcave'
  | 'custom-lens'
  | 'spectacle-lens'
  | 'contact-lens'
  | 'rigid-contact-lens'
  | 'soft-contact-lens'
  | 'magnifier';

export type ElementKind = LensKind | 'prism' | 'plane-plate' | 'custom-medium';

export type ElementFamily = 'lens' | 'prism' | 'plate' | 'medium';

export type LensOutline = 'round' | 'oval' | 'rect';

export interface LensParams {
  /** Durchmesser (runde Kontur) [mm] */
  diameter: number;
  /** Mittendicke [mm] */
  centerThickness: number;
  /** Vorderflächenradius r1 [mm], 0 = plan */
  frontRadius: number;
  /** Rückflächenradius r2 [mm], 0 = plan */
  backRadius: number;
  /** Randform (Brillenglas) */
  outline: LensOutline;
  /** Scheibenbreite bei ovaler/rechteckiger Form [mm] */
  width: number;
  /** Scheibenhöhe bei ovaler/rechteckiger Form [mm] */
  height: number;
  /**
   * Torische Flächen (Phase 2, optional).
   * frontRadius/backRadius gelten dann im Meridian frontAxis/backAxis (TABO-Grad),
   * frontRadius2/backRadius2 im Meridian senkrecht dazu. Fehlt R2 → sphärisch.
   */
  frontRadius2?: number;
  frontAxis?: number;
  backRadius2?: number;
  backAxis?: number;
}

export type ContactLensDesign = 'rigid' | 'soft';

export interface PeripheralCurve {
  /** Radius der Peripheriekurve [mm] */
  radius: number;
  /** Breite der Zone [mm] */
  width: number;
}

export interface ContactLensParams {
  design: ContactLensDesign;
  /** Zentrale Tränenfilmdicke zwischen Linsenrückfläche und Hornhautscheitel [mm] */
  tearFilmThickness: number;
  /** Linse sitzt auf dem Auge: Position/Ausrichtung werden aus Auge + Zentrierung abgeleitet */
  onEye?: boolean;
  /** Tränenfilm als optisches Medium aktiv */
  tearFilm?: boolean;
  /** Brechungsindex des Tränenfilms */
  nTear?: number;
  /** Dezentration relativ zum Hornhautscheitel im TABO-Rahmen [mm] (x → 0°, y → 90°) */
  centration?: { x: number; y: number };
  /** Neigung um die horizontale (x) bzw. vertikale (y) Achse [°] */
  tilt?: { x: number; y: number };
  /** Optische Zone (Rückfläche) [mm] – vorbereitet für Sitz/Fluoreszein */
  opticZoneDiameter?: number;
  /** Periphere Kurven – vorbereitet, noch ohne Einfluss auf Geometrie/Raytracing */
  peripheralCurves?: PeripheralCurve[];
  /** Nominale Randdicke [mm] – vorbereitet */
  edgeThicknessNominal?: number;
  /** Exzentrizität der Rückfläche – vorbereitet */
  eccentricity?: number;
}

export interface MagnifierParams {
  showFrame: boolean;
  showHandle: boolean;
}

interface ElementBase extends EntityBase {
  entityType: 'element';
  kind: ElementKind;
  family: ElementFamily;
  medium: MediumRef;
  appearance: Appearance;
  physics: PhysicsExtension;
}

export interface LensElement extends ElementBase {
  family: 'lens';
  kind: LensKind;
  lens: LensParams;
  contact?: ContactLensParams;
  magnifier?: MagnifierParams;
  /**
   * Rolle des Glases (Phase 4): 'trial' = Messglas (Refraktion/Skiaskopie-Neutralisation),
   * wird von den Arbeitsbereichen gesteuert und kann eine prismatische Wirkung tragen.
   */
  role?: 'trial';
  /** Prismatische Wirkung des Messglases [cm/m] mit Basislage (TABO-Grad) – wirkt in der Patientensicht */
  trialPrism?: { amount: number; base: number };
}

export interface PrismParams {
  /** Brechender Winkel α [°] */
  apexAngle: number;
  /** Basislage nach TABO [°] (0° = Basis nasal/rechts, 90° = oben, 180° = links, 270° = unten) */
  baseSetting: number;
  /** Länge Basis → Apex-Kante [mm] */
  height: number;
  /** Breite entlang der brechenden Kante [mm] */
  width: number;
}

export interface PrismElement extends ElementBase {
  family: 'prism';
  kind: 'prism';
  prism: PrismParams;
}

export interface PlateParams {
  width: number;
  height: number;
  thickness: number;
}

export interface PlateElement extends ElementBase {
  family: 'plate';
  kind: 'plane-plate';
  plate: PlateParams;
}

export type MediumShape = 'box' | 'cylinder' | 'sphere';

export interface MediumParams {
  shape: MediumShape;
  width: number;
  height: number;
  depth: number;
}

export interface MediumElement extends ElementBase {
  family: 'medium';
  kind: 'custom-medium';
  body: MediumParams;
}

export type OpticalElement = LensElement | PrismElement | PlateElement | MediumElement;

/* ------------------------------------------------------------------ */
/* Auge                                                                */
/* ------------------------------------------------------------------ */

/**
 * Anatomie-Parameter des Modellauges (Standard: Le-Grand-Modellauge, vereinfacht).
 * Lokales Koordinatensystem: Ursprung = Hornhautscheitel, +Z zeigt ins Auge (Lichtrichtung).
 */
export interface EyeAnatomy {
  corneaFrontRadius: number;
  corneaBackRadius: number;
  corneaThickness: number;
  /** Horizontaler Hornhautdurchmesser (HVID) */
  corneaDiameter: number;
  nCornea: number;
  /** Vorderkammertiefe: Hornhautscheitel → Linsenvorderfläche */
  anteriorChamberDepth: number;
  nAqueous: number;
  lensFrontRadius: number;
  lensBackRadius: number;
  lensThickness: number;
  lensDiameter: number;
  nLens: number;
  /** Baulänge: Hornhautscheitel → Retina */
  axialLength: number;
  nVitreous: number;
  pupilDiameter: number;
  /** Äquatorradius des Augapfels */
  globeRadius: number;
  /**
   * Torische Hornhaut (Phase 2, optional): corneaFrontRadius gilt im Meridian corneaAxis (TABO),
   * corneaFrontRadius2 im Meridian senkrecht dazu. Fehlt R2 → sphärische Hornhaut.
   */
  corneaFrontRadius2?: number;
  corneaAxis?: number;
  /**
   * Asphärizität der Hornhautvorderfläche Q (Phase 4, konische Konstante; 0 = Kugel, typ. −0,26).
   * Wirkt auf KL-Sitz und Fluoreszein (Tränenfilmgeometrie). Paraxiale Refraktion und Raytracing
   * rechnen mit dem Scheitelradius (Q ändert paraxial nichts).
   */
  corneaAsphericity?: number;
}

/** Art der Fehlsichtigkeit beim Einstellen einer Refraktion. */
export type AmetropiaMode = 'auto' | 'axial' | 'refractive';

export type EyeViewMode = 'normal' | 'section' | 'fluorescein';

/** Patientendaten für Refraktion/Patientensicht (Phase 4) */
export interface PatientParams {
  /** Alter [Jahre] – Richtwert für die Akkommodationsbreite */
  age: number;
  /** Akkommodation berücksichtigen (Patient stellt aktiv scharf, soweit möglich) */
  accommodates: boolean;
  /** Akkommodationsbreite [dpt]; fehlt → aus dem Alter (Hofstetter, Mittelwert) */
  amplitude?: number;
}

export interface EyeEntity extends EntityBase {
  entityType: 'eye';
  anatomy: EyeAnatomy;
  viewMode: EyeViewMode;
  irisColor: string;
  showLabels: boolean;
  physics: PhysicsExtension;
  /** Modell für das Einstellen der Refraktion (Phase 2) */
  ametropiaMode?: AmetropiaMode;
  /** Patient (Phase 4) */
  patient?: PatientParams;
}

/** Anklickbare Teile des Auges – Grundlage für Info-Karten und späteren Lernmodus. */
export type EyePartId = 'cornea' | 'sclera' | 'iris' | 'pupil' | 'anterior-chamber' | 'lens' | 'vitreous' | 'retina';

/* ------------------------------------------------------------------ */
/* Lichtquellen & Messpunkte                                           */
/* ------------------------------------------------------------------ */

export type LightSourceKind = 'parallel' | 'point' | 'line';

/** Darstellungsart der Strahlenfächer */
export type RayFanMode = 'principal' | 'vertical' | 'cross';

/** Geräteklassen: Lichtquelle mit zusätzlicher Beobachtungsachse. Aktiv ab Phase 4: 'retinoscope'. */
export type LightDeviceRole = 'none' | 'retinoscope' | 'slit-lamp' | 'ophthalmoscope';

/**
 * Strichskiaskop (Phase 4). Position/Ausrichtung = transform der Lichtquelle;
 * Arbeitsabstand und Beobachtungsachse werden daraus abgeleitet.
 */
export interface RetinoscopeParams {
  /** Strichlage (Richtung des Lichtstrichs, TABO-Grad) */
  streakAxis: number;
  /** Strichbreite in der Pupillenebene [mm] */
  streakWidth: number;
  /** Hülsenstellung: plan (divergent) oder konkav (konvergent, Bewegungen kehren sich um) */
  sleeve: 'plane' | 'concave';
  /** Abstand der (virtuellen) Lichtquelle hinter bzw. vor dem Spiegel [mm] */
  sourceDistance: number;
  /** Schwenk: Auslenkung des Lichtbands in der Pupillenebene senkrecht zum Strich [mm] */
  sweep: number;
  /** Durchmesser des Gucklochs [mm] */
  peephole: number;
  /** Relative Leuchtdichte 0…1 */
  intensity: number;
}

export interface LightSourceEntity extends EntityBase {
  entityType: 'light';
  source: {
    kind: LightSourceKind;
    /** Bündeldurchmesser (parallel) bzw. Öffnungsdurchmesser am Auge (Punktquelle) [mm] */
    beamDiameter: number;
    /** Anzahl Strahlen im Meridionalschnitt */
    rayCount: number;
    /** Wellenlänge [nm] – vorbereitet für Dispersion */
    wavelength: number;
    color: string;
    /** Zusätzlich sagittalen Schnitt (senkrecht) zeichnen */
    sagittal: boolean;
    /** Phase 2: Fächerausrichtung (Hauptschnitte automatisch) */
    fanMode?: RayFanMode;
    /** Relative Intensität 0…1 – vorbereitet (Skiaskop-Reflex) */
    intensity?: number;
    /** Länge der Lichtlinie bei kind = 'line' [mm] – vorbereitet */
    lineLength?: number;
    /** Divergenz/Konvergenz des Bündels [dpt] – vorbereitet (Skiaskop: Plan-/Konkavspiegel) */
    vergence?: number;
    /** Gerät, das diese Lichtquelle später steuert */
    deviceRole?: LightDeviceRole;
    /** Beobachtungsachse (lokale Richtung), vorbereitet für Skiaskopie/Ophthalmoskopie */
    observationAxis?: Vec3;
  };
  /** Skiaskop-Parameter bei deviceRole = 'retinoscope' (Phase 4) */
  retinoscope?: RetinoscopeParams;
}

export interface MeasurePointEntity extends EntityBase {
  entityType: 'measure-point';
  color: string;
}

export type SceneEntity = EyeEntity | OpticalElement | LightSourceEntity | MeasurePointEntity;

/* ------------------------------------------------------------------ */
/* Szene                                                               */
/* ------------------------------------------------------------------ */

export interface EnvironmentSettings {
  showRoom: boolean;
  showBench: boolean;
  showGrid: boolean;
  reflections: boolean;
  /** Belichtung / Helligkeit 0.5 … 1.8 */
  exposure: number;
}

export interface DisplaySettings {
  showOpticalAxis: boolean;
  showDimensions: boolean;
  /** Maßkette aller Elemente statt nur des ausgewählten */
  showAllDimensions: boolean;
  showRays: boolean;
  /** Arbeitsbereich, in dem die Simulation geöffnet wird (Phase 4) */
  workbench?: WorkbenchId;
}

/** Arbeitsbereiche des Simulators (Phase 4) */
export type WorkbenchId = 'free' | 'retinoscopy' | 'refraction' | 'patient-view' | 'contact-lens';

/** Sehprobe / Testaufbau der Refraktion (Phase 4) */
export interface RefractionSetup {
  /** Prüfentfernung [mm] (Ferne typ. 5000–6000 mm) */
  testDistance: number;
  chart: 'landolt' | 'letters' | 'numbers' | 'fan' | 'duochrome' | 'scene';
  /** Lochblende vor dem Auge (Pupille → pinholeDiameter) */
  pinhole: boolean;
  pinholeDiameter: number;
  /** Jackson-Kreuzzylinder vorgeschaltet */
  jcc?: { power: number; axis: number; flipped: boolean };
}

/** Fallbasiertes Training (Phase 4) */
export interface TrainingCase {
  id: string;
  title: string;
  age: number;
  complaint: string;
  /** Werte des Auges werden in der Oberfläche verborgen */
  hidden: boolean;
  /** Arbeitsabstand, mit dem das Ergebnis erwartet wird [mm] */
  workingDistance: number;
  startedAt: string;
  /** Abgegebenes Ergebnis (Refraktion am Brillenglas-Scheitel, HSA des Messglases) */
  submitted?: { sph: number; cyl: number; axis: number; at: string; grossSph?: number };
}

export interface SceneDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  eye: EyeEntity;
  elements: OpticalElement[];
  lights: LightSourceEntity[];
  measurePoints: MeasurePointEntity[];
  environment: EnvironmentSettings;
  display: DisplaySettings;
  /** Refraktions-Testaufbau (Phase 4, optional) */
  refraction?: RefractionSetup;
  /** Trainingsfall (Phase 4, optional) */
  training?: TrainingCase;
}

/** Pseudo-ID für den Raum im Szenenbaum. */
export const ROOM_ID = '__room__';
export const EYE_ID = 'eye';
