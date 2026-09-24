/**
 * Erklärungen zu berechneten Werten (Vorstufe des Lernmodus).
 * Jede Erklärung enthält: Formel, eingesetzte Werte (mit Einheiten), Ergebnis, fachliche Kurzerklärung.
 * Alle Längen werden für Dioptrien-Formeln in Meter umgerechnet (1 dpt = 1/m).
 */
import { formatNumber, formatPower } from '@/core/units';
import { transposeRx, type Rx } from '@/core/math/powerMatrix';

export interface Explanation {
  title: string;
  formula: string;
  substitution: string;
  result: string;
  text: string;
}

const m = (mm: number, d = 4) => `${formatNumber(mm / 1000, d)} m`;
const dpt = (v: number) => formatPower(v);
const n4 = (v: number) => formatNumber(v, 4);

export function formatRx(rx: Rx): string {
  if (Math.abs(rx.cyl) < 0.005) return `${dpt(rx.sph)} sph`;
  return `${dpt(rx.sph)} / ${dpt(rx.cyl)} cyl  A ${formatNumber(rx.axis, 0)}°`;
}

export const explainSurfacePower = (n1: number, n2: number, Rmm: number, F: number): Explanation => ({
  title: 'Flächenbrechwert',
  formula: "F = (n' − n) / r",
  substitution: `F = (${n4(n2)} − ${n4(n1)}) / ${m(Rmm)}`,
  result: dpt(F),
  text: 'Eine gekrümmte Grenzfläche zwischen zwei Medien bricht Licht umso stärker, je größer der Indexunterschied und je kleiner der Radius ist. Der Radius wird dafür in Meter eingesetzt.',
});

export const explainBackVertex = (F1: number, F2: number, tMm: number, n: number, S: number): Explanation => ({
  title: "Scheitelbrechwert S'∞",
  formula: "S'∞ = F₁ / (1 − (d/n)·F₁) + F₂",
  substitution: `S'∞ = ${dpt(F1)} / (1 − (${m(tMm, 5)} / ${n4(n)}) · ${dpt(F1)}) + ${dpt(F2)}`,
  result: dpt(S),
  text: 'Der Scheitelbrechwert ist die Wirkung, gemessen an der augenseitigen Linsenfläche – der Wert, den ein Scheitelbrechwertmesser anzeigt und der auf dem Rezept steht. Die Mittendicke wirkt als reduzierte Strecke d/n.',
});

export const explainEffectivePower = (F: number, dMm: number, Fe: number, context = 'Hornhautscheitel'): Explanation => ({
  title: `Wirksame Brechkraft am ${context}`,
  formula: 'F_HS = F / (1 − d·F)',
  substitution: `F_HS = ${dpt(F)} / (1 − ${m(dMm)} · ${dpt(F)})`,
  result: dpt(Fe),
  text: 'Eine Linse im Abstand d vor dem Auge wirkt am Hornhautscheitel anders als in ihrer eigenen Ebene. Minusgläser werden mit wachsendem HSA am Auge schwächer, Plusgläser stärker. Bei Zylindern gilt die Formel für jeden Hauptschnitt bzw. in Matrixform F·(I − d·F)⁻¹.',
});

export const explainTearLens = (nT: number, rCL: number, rHH: number, tMm: number, F: number): Explanation => ({
  title: 'Tränenlinse',
  formula: "F_TL = (n_T − 1)/r_KL + (1 − n_T)/r_HH − (d/n_T)·F₁·F₂",
  substitution: `F_TL = (${n4(nT)} − 1)/${m(rCL)} + (1 − ${n4(nT)})/${m(rHH)}  (d = ${formatNumber(tMm * 1000, 0)} µm)`,
  result: dpt(F),
  text: 'Der Tränenfilm zwischen formstabiler Linse und Hornhaut bildet eine eigene Linse. Ist die Basiskurve steiler als die Hornhaut, entsteht eine Plus-Tränenlinse (Faustregel ≈ +0,50 dpt je 0,1 mm), bei flacherer Basiskurve eine Minus-Tränenlinse. Weil n_T ≈ n_Hornhaut, gleicht sie Hornhautastigmatismus weitgehend aus.',
});

export const explainTransposition = (rx: Rx): Explanation => {
  const t = transposeRx(rx);
  return {
    title: 'Transposition',
    formula: "Sph' = Sph + Cyl,  Cyl' = −Cyl,  A' = A ± 90°",
    substitution: `${formatRx(rx)}  →  Sph' = ${dpt(rx.sph)} + (${dpt(rx.cyl)}),  Cyl' = ${dpt(-rx.cyl)},  A' = ${formatNumber(rx.axis, 0)}° ± 90°`,
    result: formatRx(t),
    text: 'Plus- und Minuszylinder-Schreibweise beschreiben dieselbe Wirkung: In beiden Fällen hat der eine Hauptschnitt die Wirkung Sph, der andere Sph + Cyl.',
  };
};

export const explainPrincipalMeridians = (rx: Rx): Explanation => ({
  title: 'Hauptschnitte',
  formula: 'F(A) = Sph,   F(A + 90°) = Sph + Cyl,   F(φ) = Sph + Cyl·sin²(φ − A)',
  substitution: `F(${formatNumber(rx.axis, 0)}°) = ${dpt(rx.sph)},   F(${formatNumber((rx.axis + 90) % 180 || 180, 0)}°) = ${dpt(rx.sph)} + (${dpt(rx.cyl)})`,
  result: `${dpt(rx.sph)} / ${dpt(rx.sph + rx.cyl)}`,
  text: 'Ein sphäro-zylindrisches Glas hat zwei senkrecht zueinander stehende Hauptschnitte mit minimaler und maximaler Wirkung. Im Achsmeridian wirkt nur die Sphäre.',
});

export const explainResidual = (A: Rx, L: Rx, R: Rx): Explanation => ({
  title: 'Restrefraktion',
  formula: 'R = A_Auge − L_HS   (Matrixform)',
  substitution: `R = [${formatRx(A)}] − [${formatRx(L)}]`,
  result: formatRx(R),
  text: 'A_Auge ist die am Hornhautscheitel benötigte Vergenz, L_HS die von allen Korrektionsmitteln am Hornhautscheitel erzeugte Vergenz. Ist R = 0, liegt das Bild eines unendlich fernen Objekts auf der Retina. Schräg gekreuzte Zylinder werden über Wirkungsmatrizen korrekt addiert.',
});

export const explainEyeRefraction = (m1: { meridian: number; refraction: number; corneaRadius: number }, m2: { meridian: number; refraction: number; corneaRadius: number }, rx: Rx): Explanation => ({
  title: 'Refraktion am Hornhautscheitel',
  formula: 'A = 1 / a_R    (a_R = Fernpunktabstand ab Hornhautscheitel, m)',
  substitution: `Hauptschnitt ${formatNumber(m1.meridian, 0)}° (r = ${formatNumber(m1.corneaRadius, 2)} mm): A = ${dpt(m1.refraction)};  Hauptschnitt ${formatNumber(m2.meridian, 0)}° (r = ${formatNumber(m2.corneaRadius, 2)} mm): A = ${dpt(m2.refraction)}`,
  result: formatRx(rx),
  text: 'Die Retina wird paraxial (y-nu-Durchrechnung aller vier Augenflächen) rückwärts abgebildet; der Bildort ist der Fernpunkt. Bei torischer Hornhaut wird jeder Hauptschnitt getrennt gerechnet.',
});

export const explainAxialLength = (A: number, AL: number): Explanation => ({
  title: 'Baulänge bei Achsenametropie',
  formula: "Baulänge = Bildort des Fernpunkts  (Objekt bei a_R = 1/A)",
  substitution: `A = ${dpt(A)}  →  a_R = ${Math.abs(A) < 1e-6 ? '∞' : `${formatNumber(1000 / A, 1)} mm`}`,
  result: `${formatNumber(AL, 2)} mm`,
  text: 'Bei der Achsenametropie ist die Brechkraft normal, aber das Auge zu lang (Myopie) oder zu kurz (Hyperopie). Die Baulänge wird exakt so gewählt, dass der Fernpunkt scharf auf der Retina abgebildet wird (Faustregel ≈ 0,37 mm je dpt).',
});
