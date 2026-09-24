/**
 * Raytracing-Engine – Datentypen.
 *
 * Status Phase 1: VORSCHAU. Geometrische Strahlverfolgung mit vektoriellem
 * Snelliusschen Brechungsgesetz durch sphärische und plane Flächen.
 * Nicht enthalten: Dispersion, Reflexionsverluste (Fresnel), Beugung,
 * Asphären/Torics, Tränenfilm, Gradientenindex der Augenlinse.
 */
import type { Vec3 } from '@/core/math/vec';

export interface Ray {
  origin: Vec3;
  /** normierte Richtung */
  dir: Vec3;
}

export type RayTermination =
  | 'retina' // trifft die Netzhaut
  | 'escaped' // verlässt die Szene
  | 'blocked' // trifft Iris, Fassung, Linsenrand
  | 'absorbed' // trifft Sklera
  | 'max-steps';

export interface RayPath {
  points: Vec3[];
  termination: RayTermination;
  /** Index des Strahls innerhalb der Quelle (für Farbverlauf) */
  index: number;
  sourceId: string;
  color: string;
  /** letzte Richtung im Glaskörper (für Fokusanalyse) */
  finalDir?: Vec3;
  /** Einfallshöhe des Strahls in der Quelle [mm] (Vorzeichen = Seite) */
  offset: number;
  /** Fächer-Index (0 = erster Hauptschnitt/Meridionalschnitt, 1 = zweiter) */
  fan?: number;
}

export interface FocalLine {
  /** Meridian (TABO-Grad), dessen Strahlen hier fokussieren */
  meridianDeg: number;
  /** Lage relativ zur Retina entlang der Augenachse [mm] (< 0 = vor der Retina) */
  defocusMm: number;
  pointWorld: Vec3;
  /** Richtung der Brennlinie (senkrecht zum fokussierenden Meridian) */
  lineDirWorld: Vec3;
  lengthMm: number;
}

/** Sturmsches Konoid (vereinfacht): zwei Brennlinien und Kreis kleinster Verwirrung (Mittelpunkt). */
export interface AstigmaticFocus {
  lines: [FocalLine, FocalLine];
  sturmIntervalMm: number;
  leastConfusionWorld: Vec3;
  leastConfusionDefocusMm: number;
}

/** Eine CSG-Intervallgrenze: Parameter t und nach außen gerichtete Normale. */
export interface Boundary {
  t: number;
  normal: Vec3 | null;
  /** optisch wirksame Fläche (false = Rand/Fassung → Strahl endet) */
  optical: boolean;
}

export interface Interval {
  enter: Boundary;
  exit: Boundary;
}

/** Eine Primitive liefert die Intervalle entlang einer Geraden, in denen der Punkt „innen“ liegt. */
export interface Primitive {
  intervals(o: Vec3, d: Vec3): Interval[];
}

export interface SolidHit {
  t: number;
  /** Normale nach außen (Welt) */
  normal: Vec3;
  entering: boolean;
  optical: boolean;
}

/** Geschlossener Körper mit homogenem Brechungsindex (Weltkoordinaten-Schnittstelle). */
export interface TraceableSolid {
  id: string;
  n: number;
  /** nächster Schnittpunkt mit t > tMin */
  intersect(ray: Ray, tMin: number): SolidHit | null;
}

export interface TraceSettings {
  maxSteps: number;
  /** Länge freier Strahlen, die die Szene verlassen [mm] */
  escapeLength: number;
  ambientIndex: number;
}

export interface FocusAnalysis {
  /** Achsnaher (paraxialer) Fokus aus den innersten Strahlen (Welt) */
  paraxialFocusWorld: Vec3;
  /** Lage des achsnahen Fokus relativ zur Retina: < 0 vor, > 0 hinter der Retina [mm] */
  paraxialDefocusMm: number;
  /** Punkt kleinster Streuung des gesamten Bündels (Welt) */
  focusWorld: Vec3;
  /** Lage des Bündelfokus relativ zur Retina [mm] */
  defocusMm: number;
  /** RMS-Radius des Zerstreuungsbildes auf der Retina [mm] */
  retinaSpotRms: number;
  raysUsed: number;
  /** Nur bei astigmatischem System (Phase 2) */
  astigmatism?: AstigmaticFocus;
}

export interface TraceResult {
  paths: RayPath[];
  focus: FocusAnalysis | null;
  stats: Record<RayTermination, number>;
  computeMs: number;
}
