/**
 * Refraktionsstatus des Modellauges (Phase 2).
 *
 * Bezugsebene: HORNHAUTSCHEITEL. Die Refraktion A ist die Vergenz, die am Hornhautscheitel
 * (in Luft) vorliegen muss, damit das Bild auf der Retina liegt:  A = 1 / a_R  (a_R = Fernpunktabstand, m).
 * Myopie: A < 0 (Fernpunkt vor dem Auge), Hyperopie: A > 0.
 *
 * Astigmatismus: Die Hornhautvorderfläche kann torisch sein (corneaFrontRadius im Meridian corneaAxis,
 * corneaFrontRadius2 senkrecht dazu). Da alle übrigen Flächen rotationssymmetrisch sind, entkoppeln
 * die beiden Hauptschnitte paraxial exakt: Jeder Hauptschnitt wird mit der bestehenden
 * y-nu-Durchrechnung (summarizeEye) wie ein sphärisches Auge mit dem jeweiligen Radius gerechnet.
 *
 * Umrechnung Refraktion → Anatomie (solveEyeForRefraction), ausgehend vom Le-Grand-Normalauge:
 *  - Achsenametropie ('axial'):   Hornhaut im Achsmeridian = Le-Grand-Radius (7,80 mm);
 *                                  Baulänge = paraxiales Bild des Fernpunkts (exakt, keine Faustregel);
 *                                  Zylinder über den Hornhautradius im zweiten Hauptschnitt.
 *  - Brechungsametropie ('refractive'): Baulänge = Le Grand (24,20 mm); beide Hornhaut-Hauptschnitte
 *                                  werden numerisch (Bisektion) so gelöst, dass die Zielrefraktion entsteht.
 *  - Automatisch ('auto'):        Standardmodell = sphärischer Anteil als Achsenametropie,
 *                                  Astigmatismus als Hornhautastigmatismus (identisch zu 'axial').
 */
import type { AmetropiaMode, EyeAnatomy } from '@/model/types';
import { DEFAULT_EYE_ANATOMY } from '@/model/derived/eyeGeometry';
import { eyeParaxialSurfaces, imageOfAxialPoint, summarizeEye } from './eyeOptics';
import { matrixToRx, normalizeAxis, rxToMatrix, type CylForm, type Mat2, type Rx } from '@/core/math/powerMatrix';

export interface MeridianState {
  /** Meridian (TABO-Grad) */
  meridian: number;
  /** Hornhautvorderflächenradius in diesem Meridian [mm] */
  corneaRadius: number;
  /** Refraktion am Hornhautscheitel [dpt] */
  refraction: number;
  /** Gesamtbrechwert [dpt] */
  totalPower: number;
  /** Bildlage (Objekt ∞) relativ zur Retina [mm] (< 0 = vor der Retina) */
  defocusMm: number;
}

export interface EyeRefractionState {
  /** Refraktion am Hornhautscheitel (Minuszylinder-Schreibweise) */
  rx: Rx;
  matrix: Mat2;
  meridians: [MeridianState, MeridianState];
  astigmatic: boolean;
  /** Sturmsches Intervall (paraxial, Abstand der Brennlinien) [mm] */
  sturmIntervalMm: number;
}

const withCornea = (a: EyeAnatomy, R: number): EyeAnatomy => ({ ...a, corneaFrontRadius: R, corneaFrontRadius2: undefined });

/** Refraktion am Hornhautscheitel für eine sphärische Hornhaut mit Radius R. */
export function refractionForCorneaRadius(a: EyeAnatomy, R: number): number {
  return summarizeEye(withCornea(a, R)).refractionAtCornea;
}

export function eyeRefractionState(a: EyeAnatomy, form: CylForm = 'minus'): EyeRefractionState {
  const m1 = normalizeAxis(a.corneaAxis ?? 180);
  const m2 = normalizeAxis(m1 + 90);
  const R1 = a.corneaFrontRadius;
  const R2 = a.corneaFrontRadius2 ?? a.corneaFrontRadius;
  const s1 = summarizeEye(withCornea(a, R1));
  const s2 = R2 === R1 ? s1 : summarizeEye(withCornea(a, R2));
  const meridians: [MeridianState, MeridianState] = [
    { meridian: m1, corneaRadius: R1, refraction: s1.refractionAtCornea, totalPower: s1.totalPower, defocusMm: s1.defocusMm },
    { meridian: m2, corneaRadius: R2, refraction: s2.refractionAtCornea, totalPower: s2.totalPower, defocusMm: s2.defocusMm },
  ];
  const raw: Rx = { sph: meridians[0].refraction, cyl: meridians[1].refraction - meridians[0].refraction, axis: m1 };
  const matrix = rxToMatrix(raw);
  const rx = matrixToRx(matrix, form, m1);
  return {
    rx,
    matrix,
    meridians,
    astigmatic: Math.abs(raw.cyl) > 0.005,
    sturmIntervalMm: Math.abs(meridians[0].defocusMm - meridians[1].defocusMm),
  };
}

/** Baulänge, bei der ein Auge (sphärische Hornhaut) die Refraktion A am Hornhautscheitel hat. */
export function axialLengthForRefraction(a: EyeAnatomy, A: number): number {
  const s = eyeParaxialSurfaces(a);
  // Fernpunkt: a_R = 1/A (m) → z = 1000/A mm (A < 0: vor dem Auge)
  const zFar = Math.abs(A) < 1e-9 ? -Infinity : 1000 / A;
  return imageOfAxialPoint(s, zFar);
}

/** Hornhautradius (Bisektion) für die Zielrefraktion A bei gegebener Baulänge. */
export function corneaRadiusForRefraction(a: EyeAnatomy, A: number, lo = 5.0, hi = 12.0): { R: number; reachable: boolean } {
  const f = (R: number) => refractionForCorneaRadius(a, R) - A;
  let fl = f(lo);
  const fh = f(hi);
  if (fl * fh > 0) return { R: Math.abs(fl) < Math.abs(fh) ? lo : hi, reachable: false };
  let l = lo;
  let h = hi;
  for (let i = 0; i < 80; i++) {
    const m = (l + h) / 2;
    const fm = f(m);
    if (fl * fm <= 0) h = m;
    else {
      l = m;
      fl = fm;
    }
  }
  return { R: (l + h) / 2, reachable: true };
}

export interface EyeSolveResult {
  anatomy: EyeAnatomy;
  reachable: boolean;
  notes: string[];
}

/**
 * Stellt die Anatomie so ein, dass am Hornhautscheitel die Refraktion `rx` entsteht.
 * Alle nicht betroffenen Parameter (Linse, Vorderkammer, Indizes …) bleiben erhalten.
 */
export function solveEyeForRefraction(current: EyeAnatomy, rx: Rx, mode: AmetropiaMode): EyeSolveResult {
  const notes: string[] = [];
  const m1 = normalizeAxis(rx.axis);
  const A1 = rx.sph;
  const A2 = rx.sph + rx.cyl;
  const astig = Math.abs(rx.cyl) > 0.005;
  let reachable = true;

  if (mode === 'refractive') {
    const base: EyeAnatomy = { ...current, axialLength: DEFAULT_EYE_ANATOMY.axialLength };
    const r1 = corneaRadiusForRefraction(base, A1);
    const r2 = astig ? corneaRadiusForRefraction(base, A2) : r1;
    reachable = r1.reachable && r2.reachable;
    if (!reachable) notes.push('Zielrefraktion mit Hornhautradien zwischen 5 und 12 mm nicht erreichbar – Wert begrenzt.');
    notes.push(`Brechungsametropie: Baulänge ${DEFAULT_EYE_ANATOMY.axialLength.toFixed(2)} mm (Le Grand), Hornhaut angepasst.`);
    return {
      anatomy: { ...base, corneaFrontRadius: r1.R, corneaFrontRadius2: astig ? r2.R : undefined, corneaAxis: m1 },
      reachable,
      notes,
    };
  }

  // 'axial' und 'auto'
  const base: EyeAnatomy = { ...current, corneaFrontRadius: DEFAULT_EYE_ANATOMY.corneaFrontRadius, corneaFrontRadius2: undefined };
  const AL = axialLengthForRefraction(base, A1);
  if (!Number.isFinite(AL) || AL < 15 || AL > 40) {
    notes.push('Baulänge außerhalb des darstellbaren Bereichs.');
    return { anatomy: current, reachable: false, notes };
  }
  const withAL: EyeAnatomy = { ...base, axialLength: AL };
  let R2: number | undefined;
  if (astig) {
    const r2 = corneaRadiusForRefraction(withAL, A2);
    reachable = r2.reachable;
    R2 = r2.R;
    if (!reachable) notes.push('Zylinder mit Hornhautradien zwischen 5 und 12 mm nicht erreichbar – Wert begrenzt.');
  }
  notes.push(
    `${mode === 'auto' ? 'Standardmodell' : 'Achsenametropie'}: Baulänge ${AL.toFixed(2)} mm` +
      (astig ? ', Zylinder als Hornhautastigmatismus.' : '.'),
  );
  return { anatomy: { ...withAL, corneaFrontRadius2: R2, corneaAxis: m1 }, reachable, notes };
}
