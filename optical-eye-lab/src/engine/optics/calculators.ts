/**
 * Optische Rechner (Phase 4) – reine Funktionen mit Erklärung (Formel, eingesetzte Werte, Ergebnis, Text).
 * Die Oberfläche verbindet sie mit der aktuellen Auswahl (Werte übernehmen / in die Simulation schreiben).
 * Alle Dioptrien-Formeln rechnen Längen in Meter.
 */
import { effectivityMatrix, matrixToRx, rxToMatrix, type CylForm, type Mat2, type Rx } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { formatRx, type Explanation } from '@/engine/physics/explain';

const dpt = (v: number) => formatPower(v);
const m = (mm: number, d = 4) => `${formatNumber(mm / 1000, d)} m`;

export interface CalcResult<T> {
  value: T;
  explanation: Explanation;
}

/* --------------------------- HSA / Vertex --------------------------- */

/**
 * Glas vom HSA d₁ auf HSA d₂ umrechnen, sodass die Wirkung am Hornhautscheitel gleich bleibt.
 *   F_HS = F₁ / (1 − d₁F₁),   F₂ = F_HS / (1 + d₂·F_HS)      (Matrixform je Hauptschnitt)
 */
export function vertexConversion(rx: Rx, d1Mm: number, d2Mm: number, form: CylForm = 'minus'): CalcResult<{ atCornea: Rx; converted: Rx }> {
  const F = rxToMatrix(rx);
  const Fc = effectivityMatrix(F, d1Mm);
  const F2 = effectivityMatrix(Fc, -d2Mm);
  const atCornea = matrixToRx(Fc, form, rx.axis);
  const converted = matrixToRx(F2, form, rx.axis);
  return {
    value: { atCornea, converted },
    explanation: {
      title: 'HSA-Umrechnung',
      formula: 'F_HS = F₁ / (1 − d₁·F₁)   →   F₂ = F_HS / (1 + d₂·F_HS)',
      substitution: `F₁ = ${formatRx(rx)},  d₁ = ${m(d1Mm, 3)},  d₂ = ${m(d2Mm, 3)}  →  F_HS = ${formatRx(atCornea)}`,
      result: formatRx(converted),
      text: 'Gleiche Wirkung am Hornhautscheitel bei geändertem Abstand: Rückt ein Minusglas näher ans Auge, muss es schwächer werden; ein Plusglas muss stärker werden. Bei Zylindern wird jeder Hauptschnitt (Matrixform) umgerechnet.',
    },
  };
}

/** Brillenglaswerte → Kontaktlinsenwerte (Wirkung am Hornhautscheitel, ohne Tränenlinse) */
export function spectacleToContact(rx: Rx, hsaMm: number, form: CylForm = 'minus'): CalcResult<Rx> {
  const Fc = matrixToRx(effectivityMatrix(rxToMatrix(rx), hsaMm), form, rx.axis);
  return {
    value: Fc,
    explanation: {
      title: 'Brille → Kontaktlinse',
      formula: 'F_KL = F_Br / (1 − d·F_Br)',
      substitution: `F_Br = ${formatRx(rx)},  d = ${m(hsaMm, 3)}`,
      result: formatRx(Fc),
      text: 'Die Kontaktlinse sitzt im Hornhautscheitel. Ihre Wirkung muss der Wirkung des Brillenglases am Hornhautscheitel entsprechen. Bei formstabilen Linsen kommt die Tränenlinse hinzu (siehe Tränenlinsenrechner).',
    },
  };
}

/* --------------------------- Prentice --------------------------- */

/**
 * Prismatische Wirkung beim Blick durch einen Punkt im Abstand c vom optischen Mittelpunkt:
 *   P⃗ = −F·c⃗   (c in cm, P in cm/m); Basis in Richtung von P⃗ (Prentice-Regel, Matrixform)
 * c⃗ im TABO-Rahmen (x → 0°, y → 90°), Blick auf das Auge.
 */
export function prentice(rx: Rx, cx_mm: number, cy_mm: number): CalcResult<{ amount: number; base: number; horizontal: number; vertical: number }> {
  const F = rxToMatrix(rx);
  const cx = cx_mm / 10;
  const cy = cy_mm / 10;
  const px = -(F.a * cx + F.b * cy);
  const py = -(F.b * cx + F.c * cy);
  const amount = Math.hypot(px, py);
  let base = (Math.atan2(py, px) * 180) / Math.PI;
  base = ((base % 360) + 360) % 360;
  const baseLabel = amount < 1e-6 ? '–' : `${formatNumber(base, 0)}°`;
  return {
    value: { amount, base, horizontal: px, vertical: py },
    explanation: {
      title: 'Prentice-Regel',
      formula: 'P = c · F   (c in cm, F in dpt, P in cm/m);   Matrixform: P⃗ = −F·c⃗',
      substitution: `F = ${formatRx(rx)},  c = (${formatNumber(cx, 2)} cm | ${formatNumber(cy, 2)} cm)`,
      result: `${formatNumber(amount, 2)} cm/m, Basis ${baseLabel} (TABO)`,
      text: 'Blickt das Auge nicht durch den optischen Mittelpunkt, wirkt das Glas zusätzlich prismatisch. Plusgläser wirken Basis zum optischen Mittelpunkt hin, Minusgläser Basis davon weg. Bei Zylindern hängt die Wirkung von der Richtung der Dezentration ab.',
    },
  };
}

/* --------------------------- dicke Linse --------------------------- */

export function backVertexPower(r1Mm: number, r2Mm: number, n: number, tMm: number): CalcResult<{ F1: number; F2: number; S: number; F: number }> {
  const F1 = r1Mm ? (1000 * (n - 1)) / r1Mm : 0;
  const F2 = r2Mm ? (1000 * (1 - n)) / r2Mm : 0;
  const d = tMm / 1000 / n;
  const S = F1 / (1 - d * F1) + F2;
  const F = F1 + F2 - d * F1 * F2;
  return {
    value: { F1, F2, S, F },
    explanation: {
      title: "Scheitelbrechwert S'∞",
      formula: "F₁ = (n − 1)/r₁,  F₂ = (1 − n)/r₂,  S'∞ = F₁/(1 − (d/n)·F₁) + F₂",
      substitution: `n = ${formatNumber(n, 3)}, r₁ = ${m(r1Mm)}, r₂ = ${m(r2Mm)}, d = ${m(tMm, 4)}  →  F₁ = ${dpt(F1)}, F₂ = ${dpt(F2)}`,
      result: `S'∞ = ${dpt(S)}   (Hauptpunktbrechwert F = ${dpt(F)})`,
      text: 'Der bildseitige Scheitelbrechwert ist der auf dem Rezept und am Scheitelbrechwertmesser angegebene Wert. Er weicht bei dicken Plusgläsern deutlich vom Hauptpunktbrechwert ab.',
    },
  };
}

/* --------------------------- Abbildung --------------------------- */

/**
 * Abbildungsgleichung (Vergenzform):  L' = L + F,  L = 1/a,  L' = 1/a',  β = L / L'
 * a < 0: Objekt vor der Linse (reell). Längen in mm.
 */
export function imaging(Fdpt: number, aMm: number): CalcResult<{ L: number; L2: number; a2: number; beta: number }> {
  const L = Number.isFinite(aMm) && aMm !== 0 ? 1000 / aMm : 0;
  const L2 = L + Fdpt;
  const a2 = Math.abs(L2) < 1e-9 ? Infinity : 1000 / L2;
  const beta = Math.abs(L2) < 1e-9 ? Infinity : L / L2;
  return {
    value: { L, L2, a2, beta },
    explanation: {
      title: 'Abbildungsgleichung (Vergenzen)',
      formula: "L' = L + F,   L = 1/a,   a' = 1/L',   β' = L / L'",
      substitution: `L = 1 / ${m(aMm, 3)} = ${dpt(L)},  F = ${dpt(Fdpt)}`,
      result: `L' = ${dpt(L2)}  →  a' = ${Number.isFinite(a2) ? `${formatNumber(a2, 1)} mm` : '∞'},  β' = ${Number.isFinite(beta) ? formatNumber(beta, 3) : '∞'}`,
      text: 'Die Vergenz ist der Kehrwert der Entfernung in Metern. Eine Linse addiert ihren Brechwert zur Vergenz. Negative Bildweite: virtuelles Bild vor der Linse; negativer Abbildungsmaßstab: umgekehrtes Bild.',
    },
  };
}

/** Lupe: Normalvergrößerung Γ = F / 4 dpt (Bezugssehweite 25 cm) */
export function magnifier(Fdpt: number): CalcResult<number> {
  const G = Fdpt / 4;
  return {
    value: G,
    explanation: {
      title: 'Lupenvergrößerung',
      formula: 'Γ = F · s₀ = F / 4 dpt   (s₀ = 0,25 m, Objekt in der Brennebene)',
      substitution: `Γ = ${dpt(Fdpt)} · 0,25 m`,
      result: `${formatNumber(G, 2)}×`,
      text: 'Die Normalvergrößerung vergleicht den Sehwinkel durch die Lupe mit dem Sehwinkel ohne Lupe in 25 cm. Liegt das Objekt innerhalb der Brennweite und akkommodiert der Betrachter, wird die Vergrößerung etwas größer (Γ = F/4 + 1).',
    },
  };
}

/* --------------------------- KL / Hornhaut --------------------------- */

/** Keratometer: K = (1,3375 − 1) / r   (keratometrischer Index) */
export function keratometry(rMm: number): CalcResult<number> {
  const K = rMm ? 337.5 / rMm : 0;
  return {
    value: K,
    explanation: {
      title: 'Keratometrischer Brechwert',
      formula: 'K = (n_K − 1) / r,   n_K = 1,3375',
      substitution: `K = 0,3375 / ${m(rMm)}`,
      result: dpt(K),
      text: 'Keratometer rechnen mit einem fiktiven Index 1,3375, der die Rückfläche der Hornhaut pauschal berücksichtigt. Der Wert ist daher nicht der Flächenbrechwert der Vorderfläche (n = 1,376).',
    },
  };
}

/** Tränenlinse (dünn):  F_TL ≈ (n_T − 1)·(1/r_BK − 1/r_HH) */
export function tearLensQuick(baseCurveMm: number, corneaMm: number, nT = 1.336): CalcResult<number> {
  const F = baseCurveMm && corneaMm ? (nT - 1) * (1000 / baseCurveMm - 1000 / corneaMm) : 0;
  return {
    value: F,
    explanation: {
      title: 'Tränenlinse (Näherung dünne Linse)',
      formula: 'F_TL ≈ (n_T − 1) · (1/r_BK − 1/r_HH)',
      substitution: `F_TL ≈ (${formatNumber(nT, 3)} − 1) · (1/${m(baseCurveMm)} − 1/${m(corneaMm)})`,
      result: dpt(F),
      text: 'Steilere Basiskurve (kleinerer Radius) → Plus-Tränenlinse, flachere → Minus-Tränenlinse. Faustregel ≈ 0,5 dpt je 0,1 mm Radiusdifferenz im Bereich um 7,8 mm.',
    },
  };
}

/** Autorefraktometer (idealisiert): Refraktion am HS → Brillenglasebene */
export function refractionAtVertex(A: Mat2, hsaMm: number, form: CylForm = 'minus'): Rx {
  return matrixToRx(effectivityMatrix(A, -hsaMm), form);
}

/** Vergenz nach Strecke:  L₂ = L₁ / (1 − d·L₁) */
export function vergenceTransfer(L1: number, dMm: number): CalcResult<number> {
  const L2 = L1 / (1 - (dMm / 1000) * L1);
  return {
    value: L2,
    explanation: {
      title: 'Vergenzübertragung',
      formula: 'L₂ = L₁ / (1 − d·L₁)',
      substitution: `L₂ = ${dpt(L1)} / (1 − ${m(dMm)} · ${dpt(L1)})`,
      result: dpt(L2),
      text: 'Ein konvergentes Bündel (L > 0) wird auf dem Weg stärker konvergent, ein divergentes schwächer divergent – Grundlage von HSA- und Effektivitätsrechnung.',
    },
  };
}
