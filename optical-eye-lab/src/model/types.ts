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

export const SCHEMA_VERSION = 1;

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
  /** Abbe-Zahl ν_d – vorbereitet für Dispersion */
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
}

export type ContactLensDesign = 'rigid' | 'soft';

export interface ContactLensParams {
  design: ContactLensDesign;
  /** Tränenfilmdicke zwischen Linse und Hornhaut [mm] – vorbereitet für die Tränenlinse */
  tearFilmThickness: number;
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
}

export type EyeViewMode = 'normal' | 'section';

export interface EyeEntity extends EntityBase {
  entityType: 'eye';
  anatomy: EyeAnatomy;
  viewMode: EyeViewMode;
  irisColor: string;
  showLabels: boolean;
  physics: PhysicsExtension;
}

/** Anklickbare Teile des Auges – Grundlage für Info-Karten und späteren Lernmodus. */
export type EyePartId = 'cornea' | 'sclera' | 'iris' | 'pupil' | 'anterior-chamber' | 'lens' | 'vitreous' | 'retina';

/* ------------------------------------------------------------------ */
/* Lichtquellen & Messpunkte                                           */
/* ------------------------------------------------------------------ */

export type LightSourceKind = 'parallel' | 'point';

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
  };
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
}

/** Pseudo-ID für den Raum im Szenenbaum. */
export const ROOM_ID = '__room__';
export const EYE_ID = 'eye';
