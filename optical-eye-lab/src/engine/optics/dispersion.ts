/**
 * Dispersion (Phase 4).
 *
 * Brechungsindex in Abhängigkeit von der Wellenlänge aus n_d und Abbe-Zahl ν_d
 * mit der zweigliedrigen Cauchy-Näherung   n(λ) = A + B / λ²
 *   ν_d = (n_d − 1) / (n_F − n_C)   →   B = (n_d − 1) / ν_d / (1/λ_F² − 1/λ_C²),   A = n_d − B/λ_d²
 * Fraunhofer-Linien: d = 587,56 nm (Referenz), F = 486,13 nm, C = 656,27 nm.
 * Genauigkeit: für Brillenglas-/Kontaktlinsenmaterialien im sichtbaren Bereich typisch besser als ±0,002
 * (keine Sellmeier-Koeffizienten verfügbar → bewusst einfache, dokumentierte Näherung).
 *
 * Augenmedien: „chromatisches Auge“ – alle Augenmedien erhalten die Dispersion von Wasser (ν ≈ 55,8).
 * Damit beträgt die chromatische Längsaberration des Modellauges zwischen F und C ≈ 1 dpt, in guter
 * Übereinstimmung mit Messwerten am menschlichen Auge (vgl. Thibos et al. 1992, Modell „Chromatic Eye“).
 */
export const LAMBDA_D = 587.56;
export const LAMBDA_F = 486.13;
export const LAMBDA_C = 656.27;
/** Abbe-Zahl, mit der alle Augenmedien gerechnet werden (Wasser) */
export const EYE_MEDIA_ABBE = 55.8;

const DF = 1 / (LAMBDA_F * LAMBDA_F) - 1 / (LAMBDA_C * LAMBDA_C);

/** Brechungsindex bei λ (nm). Ohne Abbe-Zahl oder für n ≈ 1 (Luft) keine Dispersion. */
export function indexAt(nd: number, abbe: number | undefined, lambdaNm: number): number {
  if (!abbe || !Number.isFinite(abbe) || abbe <= 0 || Math.abs(nd - 1) < 1e-6) return nd;
  if (Math.abs(lambdaNm - LAMBDA_D) < 0.05) return nd;
  const B = (nd - 1) / abbe / DF;
  return nd + B * (1 / (lambdaNm * lambdaNm) - 1 / (LAMBDA_D * LAMBDA_D));
}

/** n_F − n_C (Hauptdispersion) */
export const principalDispersion = (nd: number, abbe: number) => (nd - 1) / abbe;

/** Liegt die Wellenlänge so nah an der d-Linie, dass keine Dispersion gerechnet werden muss? */
export const isReferenceWavelength = (lambdaNm: number | undefined) => lambdaNm === undefined || Math.abs(lambdaNm - LAMBDA_D) < 1;

/** Farbe einer Spektrallinie (sRGB, Näherung nach Bruton) für die Darstellung. */
export function wavelengthToHex(lambda: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (lambda >= 380 && lambda < 440) {
    r = -(lambda - 440) / 60;
    b = 1;
  } else if (lambda < 490) {
    g = (lambda - 440) / 50;
    b = 1;
  } else if (lambda < 510) {
    g = 1;
    b = -(lambda - 510) / 20;
  } else if (lambda < 580) {
    r = (lambda - 510) / 70;
    g = 1;
  } else if (lambda < 645) {
    r = 1;
    g = -(lambda - 645) / 65;
  } else if (lambda <= 780) {
    r = 1;
  }
  const f = lambda < 420 ? 0.3 + (0.7 * (lambda - 380)) / 40 : lambda > 700 ? 0.3 + (0.7 * (780 - lambda)) / 80 : 1;
  const c = (v: number) => Math.round(255 * Math.pow(Math.max(0, v * f), 0.8));
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Wichtige Wellenlängen für Auswahl in der Oberfläche */
export const SPECTRAL_LINES: Array<{ id: string; label: string; nm: number }> = [
  { id: 'F', label: 'F (blau, 486 nm)', nm: LAMBDA_F },
  { id: 'e', label: 'e (grün, 546 nm)', nm: 546.07 },
  { id: 'd', label: 'd (gelb, 588 nm) – Referenz', nm: LAMBDA_D },
  { id: 'C', label: 'C (rot, 656 nm)', nm: LAMBDA_C },
];
