/**
 * Strichskiaskopie (Phase 4) – Reflexmodell aus der paraxialen Vergenzrechnung.
 *
 * KEINE Animation: Lage, Breite, Richtung, Geschwindigkeit und Helligkeit des Reflexes folgen aus der
 * dioptrischen Fehlermatrix E des Systems (Auge + vorgeschaltete Gläser) bezogen auf den Hornhautscheitel:
 *
 *   E = A_Auge − L_HS(Guckloch)                (computeCorrection mit objectZ = −w)
 *
 * L_HS(Guckloch) ist die Vergenz, die ein Punkt im Guckloch (Abstand w) nach Durchgang durch alle Gläser am
 * Hornhautscheitel erzeugt. E = 0 bedeutet: Das Guckloch liegt im Fernpunkt des Systems → Neutralisation.
 * Ohne Gläser gilt E = A + I/w (skalar: E = R + 1/w).
 *
 * Paraxiales Modell (Pupillenebene ≈ Hornhautscheitelebene, Vektoren im TABO-Rahmen, Längen in m):
 *  - Ein Strahl mit Höhe x und Neigung u in der Pupille trifft die Netzhaut an der Winkelkoordinate θ = u + R·x,
 *    R = E − I/w ist der Refraktionsfehler (Fernpunktvergenz) des Systems.
 *  - Beobachtung: Strahlen vom Guckloch (0 bei −w) durch den Pupillenpunkt x:   θ_B(x) = E·x.
 *  - Beleuchtung: virtuelle Strichlichtquelle im Abstand s vor dem Auge (Planspiegel s = w + d, Konkavspiegel
 *    s = w − d), seitlich versetzt um c. Der ausgeleuchtete Netzhautstreifen ist in θ ein Band mit Normale m
 *    (m ⟂ Strichrichtung ℓ), Mitte −m·c/s und Halbbreite
 *        h = P·|(I/s + R)·m| + W_Q/(2s)          (P Pupillenradius, W_Q Strichbreite an der Quelle)
 *  - Ein Pupillenpunkt x leuchtet, wenn  |g·x + m·c/s| ≤ h   mit   g = E·m.
 *    ⇒ Der Reflex ist ein Band mit Normale g (nicht notwendig ∥ m!), Breite 2h/|g|.
 *  - Schwenk: Das Lichtband auf dem Gesicht verschiebt sich um σ entlang m; es gilt c = −σ·m·(s−w)/w.
 *    Reflexlage entlang ĝ:  p = σ·(s−w) / (w·s·|g|);  Bewegung relativ zum Gesichtsband (entlang m):
 *        k = (g·m)·(s−w) / (w·s·|g|²)        (skalar: k = (d/s) / (1 + w·R) )
 *    k > 0 Mitbewegung, k < 0 Gegenbewegung, |k| → ∞ Neutralisation (Pupille leuchtet ganz auf oder bleibt dunkel).
 *  - Astigmatismus: Liegt der Strich nicht in einem Hauptschnitt, sind g und m nicht parallel:
 *    Reflexband und Gesichtsband sind gegeneinander verdreht (Break) und der Reflex wandert schräg (Skew).
 *  - Helligkeit (vereinfacht): Anteil des aus der Pupille austretenden Lichts eines Netzhautpunkts, der das
 *    Guckloch (Radius a) erreicht. Der Lichtfleck in der Gucklochebene ist die Ellipse w·E·(Pupillenscheibe):
 *        B = I₀ · min(1, a / (w·P·|λ₁|)) · min(1, a / (w·P·|λ₂|))      (λᵢ Eigenwerte von E)
 *
 * Vereinfachungen (dokumentiert): paraxial; Pupille in der Hornhautscheitelebene; Gläser für die Reflexgeometrie
 * als dünn am Hornhautscheitel betrachtet (die Neutralisationsbedingung E = 0 ist dagegen exakt über die
 * Vergenzrechnung mit HSA); Beobachtung entlang der Augenachse (seitlicher Versatz → nur Hinweis, keine
 * Randstrahlrefraktion); keine Aberrationen höherer Ordnung, keine Streuung; Fundusreflex als Lambert-Fläche.
 */
import type { LensElement, LightSourceEntity, RetinoscopeParams, SceneDocument } from '@/model/types';
import { worldToEyeLocal } from '@/model/sceneFactory';
import { computeCorrection } from '@/engine/physics/correction';
import { eigen2, effectivityMatrix, madd2, matrixToRx, msub2, rxToMatrix, type Mat2, type Rx } from '@/core/math/powerMatrix';

export const DEFAULT_RETINOSCOPE: RetinoscopeParams = {
  streakAxis: 90,
  streakWidth: 2.5,
  sleeve: 'plane',
  sourceDistance: 300,
  sweep: 0,
  peephole: 2.5,
  intensity: 1,
};

export type Motion = 'with' | 'against' | 'neutral';

export const MOTION_LABEL: Record<Motion, string> = { with: 'Mitbewegung', against: 'Gegenbewegung', neutral: 'Neutral' };

type V2 = [number, number];
const dot2 = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len2 = (a: V2) => Math.hypot(a[0], a[1]);
const mulM = (M: Mat2, v: V2): V2 => [M.a * v[0] + M.b * v[1], M.b * v[0] + M.c * v[1]];
/** TABO-Winkel → Einheitsvektor im TABO-Rahmen (x → 0°, y → 90°) */
export const taboDir = (deg: number): V2 => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const angleOf = (v: V2) => {
  let d = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  d = ((d % 180) + 180) % 180;
  return d === 0 ? 180 : d;
};

export interface MeridianMotion {
  /** Meridian (TABO) */
  meridian: number;
  /** Fehler in diesem Hauptschnitt [dpt] (0 = neutral) */
  error: number;
  motion: Motion;
}

export interface ReflexModel {
  /** Arbeitsabstand Guckloch → Hornhautscheitel [mm] */
  workingDistance: number;
  /** Seitlicher Versatz der Beobachtung zur Augenachse [mm] */
  lateralOffset: number;
  /** Fehlermatrix E (dpt) */
  E: Mat2;
  /** Fehlermatrix als Rezept (nur für Lehrer/Auswertung) */
  errorRx: Rx;
  pupilRadius: number;
  params: RetinoscopeParams;
  /** Einheitsvektor der Schwenkrichtung (⟂ Strich) */
  m: V2;
  /** Strichrichtung */
  l: V2;
  /** Normale des Reflexbandes g = E·m [dpt] */
  g: V2;
  /** Lage der virtuellen Quelle s [m] */
  s: number;
  /** Halbbreite des Netzhautstreifens [rad] */
  h: number;
  /** Bewegung relativ zum Gesichtsband (dimensionslos) */
  speed: number;
  motion: Motion;
  /** Breite des Reflexbandes in der Pupille [mm] (Infinity = ganze Pupille) */
  bandWidth: number;
  /** Orientierung des Reflexbandes (TABO-Grad, Richtung des Bandes) */
  bandAxis: number;
  /** Winkel zwischen Reflexband und Lichtstrich [°] (Break/Skew) */
  skew: number;
  brightness: number;
  /** Mitte des Reflexbandes entlang ĝ [mm] */
  offset: number;
  principal: [MeridianMotion, MeridianMotion];
  /** Fehler im gerade geprüften Meridian (Schwenkrichtung) [dpt] */
  sweepMeridianError: number;
  notes: string[];
}

/** Eigenwerte/-richtungen von E als Hauptschnitte mit Bewegungsrichtung (Planspiegel). */
function principalMotions(E: Mat2, sleeve: RetinoscopeParams['sleeve'], tol: number): [MeridianMotion, MeridianMotion] {
  const e = eigen2(E);
  const sign = sleeve === 'concave' ? -1 : 1;
  const mk = (meridian: number, error: number): MeridianMotion => ({
    meridian,
    error,
    motion: Math.abs(error) <= tol ? 'neutral' : error * sign > 0 ? 'with' : 'against',
  });
  const m2 = ((e.deg1 + 90 - 1) % 180) + 1;
  return [mk(e.deg1, e.l1), mk(m2, e.l2)];
}

export interface ReflexInput {
  E: Mat2;
  workingDistanceMm: number;
  pupilDiameterMm: number;
  params: RetinoscopeParams;
  lateralOffsetMm?: number;
  /** Toleranz für „neutral“ [dpt] */
  neutralTolerance?: number;
}

export function buildReflexModel(inp: ReflexInput): ReflexModel {
  const p = inp.params;
  const w = Math.max(0.05, inp.workingDistanceMm / 1000);
  const P = inp.pupilDiameterMm / 2000;
  const tol = inp.neutralTolerance ?? 0.125;
  const E = inp.E;
  const R: Mat2 = { a: E.a - 1 / w, b: E.b, c: E.c - 1 / w };
  const d = Math.max(0.01, p.sourceDistance / 1000);
  let s = p.sleeve === 'plane' ? w + d : w - d;
  if (Math.abs(s) < 0.02) s = 0.02 * Math.sign(s || 1);
  const l = taboDir(p.streakAxis);
  const m = taboDir(p.streakAxis + 90);
  const g = mulM(E, m);
  const gLen = len2(g);
  const M: Mat2 = { a: 1 / s + R.a, b: R.b, c: 1 / s + R.c };
  const Wq = ((p.streakWidth / 1000) * Math.abs(s - w)) / w;
  const h = P * len2(mulM(M, m)) + Wq / (2 * Math.abs(s));
  const eig = eigen2(E);
  const a = p.peephole / 2000;
  const f = (lam: number) => Math.min(1, a / Math.max(1e-9, w * P * Math.abs(lam)));
  const brightness = Math.max(0, Math.min(1, p.intensity)) * f(eig.l1) * f(eig.l2);
  const sweepErr = dot2(m, mulM(E, m));
  const speed = gLen < 1e-9 ? Infinity : (dot2(g, m) * (s - w)) / (w * s * gLen * gLen);
  const neutral = gLen < tol;
  const motion: Motion = neutral ? 'neutral' : speed > 0 ? 'with' : 'against';
  const bandDir: V2 = gLen < 1e-9 ? l : [-g[1] / gLen, g[0] / gLen];
  const bandAxis = angleOf(bandDir);
  let skew = Math.abs(bandAxis - angleOf(l)) % 180;
  if (skew > 90) skew = 180 - skew;
  const offset = gLen < 1e-9 ? 0 : (p.sweep * (s - w)) / (w * s * gLen);
  const notes: string[] = [];
  if ((inp.lateralOffsetMm ?? 0) > 3) notes.push('Das Skiaskop steht seitlich der Augenachse – die periphere Refraktion ist nicht modelliert (Messung wie auf der Achse).');
  if (p.sleeve === 'concave') notes.push('Konkavspiegel (konvergentes Bündel): Mit- und Gegenbewegung sind gegenüber dem Planspiegel vertauscht.');
  return {
    workingDistance: inp.workingDistanceMm,
    lateralOffset: inp.lateralOffsetMm ?? 0,
    E,
    errorRx: matrixToRx(E, 'minus'),
    pupilRadius: inp.pupilDiameterMm / 2,
    params: p,
    m,
    l,
    g,
    s,
    h,
    speed,
    motion,
    bandWidth: gLen < 1e-9 ? Infinity : ((2 * h) / gLen) * 1000,
    bandAxis,
    skew: gLen < 1e-9 ? 0 : skew,
    brightness,
    offset,
    principal: principalMotions(E, p.sleeve, tol),
    sweepMeridianError: sweepErr,
    notes,
  };
}

/**
 * Leuchtdichte des Fundusreflexes am Pupillenpunkt (x, y) [mm, TABO-Rahmen] für den aktuellen Schwenk.
 * `edge` = Kantenbreite [mm] (Antialiasing/Weichzeichnung durch Abbildungsfehler, rein darstellerisch).
 * Rückgabe 0…1 (0 außerhalb der Pupille).
 */
export function reflexAt(r: ReflexModel, x: number, y: number, edge = 0.06): number {
  const rr = Math.hypot(x, y);
  if (rr > r.pupilRadius) return 0;
  const w = r.workingDistance / 1000;
  // |g·x + m·c/s| ≤ h  mit  m·c/s = −σ·(s−w)/(w·s)
  const sigma = r.params.sweep / 1000;
  const q = (r.g[0] * x + r.g[1] * y) / 1000 - (sigma * (r.s - w)) / (w * r.s);
  const gl = len2(r.g);
  // Abstand zur Bandkante in mm (in der Pupille)
  if (gl < 1e-9) return Math.abs(q) <= r.h ? r.brightness : 0;
  const distMm = ((Math.abs(q) - r.h) / gl) * 1000;
  const t = Math.max(0, Math.min(1, 0.5 - distMm / Math.max(1e-6, edge)));
  return t * r.brightness;
}

/** Lichtband auf Gesicht/Iris außerhalb der Pupille (Projektion des Strichs) 0…1 */
export function faceBandAt(r: ReflexModel, x: number, y: number, edge = 0.25): number {
  const dist = Math.abs(dot2([x, y], r.m) - r.params.sweep) - r.params.streakWidth / 2;
  return Math.max(0, Math.min(1, 0.5 - dist / edge)) * Math.max(0, Math.min(1, r.params.intensity));
}

/* ------------------------------ Szene ------------------------------ */

export const isRetinoscope = (l: LightSourceEntity) => l.source.deviceRole === 'retinoscope';

export function findRetinoscope(doc: SceneDocument): LightSourceEntity | undefined {
  return doc.lights.find((l) => isRetinoscope(l) && l.visible);
}

/** Lage des Gucklochs relativ zum Auge */
export function scopeGeometry(doc: SceneDocument, scope: LightSourceEntity) {
  const local = worldToEyeLocal(doc.eye, scope.transform.position);
  return { local, workingDistance: -local[2], lateralOffset: Math.hypot(local[0], local[1]) };
}

/** Vollständiger Skiaskopie-Zustand der Szene für ein Skiaskop. */
export function retinoscopyState(doc: SceneDocument, scope: LightSourceEntity, pupilOverride?: number): ReflexModel | null {
  const g = scopeGeometry(doc, scope);
  if (g.workingDistance < 50) return null;
  const corr = computeCorrection(doc, 'minus', { objectZ: -g.workingDistance });
  return buildReflexModel({
    E: corr.residualMatrix,
    workingDistanceMm: g.workingDistance,
    pupilDiameterMm: pupilOverride ?? doc.eye.anatomy.pupilDiameter,
    params: { ...DEFAULT_RETINOSCOPE, ...(scope.retinoscope ?? {}) },
    lateralOffsetMm: g.lateralOffset,
  });
}

/* --------------------------- Auswertung --------------------------- */

/** Messglas der Szene (Rolle 'trial'), falls vorhanden */
export const findTrialLens = (doc: SceneDocument) => doc.elements.find((e): e is LensElement => e.family === 'lens' && e.role === 'trial' && e.visible);

/**
 * Glas im Abstand h vor dem Hornhautscheitel, das die Fehlermatrix für ein Objekt im Abstand w neutralisiert:
 *   Vergenz am Glas V = −1/(w − h);  Glas + Übertragung auf den HS muss A ergeben:
 *   F = A·(I + h·A)⁻¹ − V·I      (Brillenglasbezug; skalar: F = A/(1 + hA) + 1/(w − h))
 */
export function neutralizingLens(A: Mat2, workingDistanceMm: number, vertexMm: number): Mat2 {
  const Fspec = effectivityMatrix(A, -vertexMm);
  const V = -1000 / (workingDistanceMm - vertexMm);
  return msub2(Fspec, { a: V, b: 0, c: V });
}

/**
 * Arbeitsabstandskorrektur: Brutto-Neutralisationswert − 1/w  =  Refraktion (Brillenglasebene).
 * Liefert Glas- und Endwert für den Unterricht.
 */
export function workingDistanceCorrection(grossRx: Rx, workingDistanceMm: number, vertexMm: number) {
  const lensDist = (workingDistanceMm - vertexMm) / 1000;
  const wdLens = 1 / lensDist;
  const net = matrixToRx(madd2(rxToMatrix(grossRx), { a: -wdLens, b: 0, c: -wdLens }), 'minus', grossRx.axis);
  return { workingLens: wdLens, net };
}
