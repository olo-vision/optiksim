/**
 * Geometrie optischer Flächen.
 *
 * Vorzeichenkonvention (DIN / Optik-Standard):
 *   - Licht läuft in +Z-Richtung (lokales Koordinatensystem jedes Elements).
 *   - Radius R > 0: Krümmungsmittelpunkt liegt in Lichtrichtung hinter dem Scheitel (+Z).
 *   - Radius R < 0: Krümmungsmittelpunkt liegt vor dem Scheitel (−Z).
 *   - R = 0 wird als Planfläche (R = ∞) interpretiert.
 */

export const isPlano = (R: number) => !Number.isFinite(R) || Math.abs(R) < 1e-9 || Math.abs(R) > 1e7;

/**
 * Pfeilhöhe (Sagitta) einer sphärischen Fläche bei Einfallshöhe h.
 * Positiver Wert = Fläche liegt am Rand weiter in +Z als am Scheitel.
 */
export function sag(R: number, h: number): number {
  if (isPlano(R)) return 0;
  const r2 = R * R;
  const h2 = Math.min(h * h, r2);
  return R - Math.sign(R) * Math.sqrt(r2 - h2);
}

/** Maximal mögliche Einfallshöhe einer Kugelfläche (Halbkugel). */
export const maxSemiAperture = (R: number) => (isPlano(R) ? Infinity : Math.abs(R));

export interface LensShapeCheck {
  /** Tatsächlich darstellbare Mittendicke (ggf. automatisch erhöht). */
  centerThickness: number;
  /** Randdicke bei maximaler Einfallshöhe. */
  edgeThickness: number;
  /** Tatsächlich verwendete halbe Öffnung. */
  semiAperture: number;
  warnings: string[];
}

/**
 * Prüft, ob eine Linse mit den Parametern geometrisch darstellbar ist,
 * und korrigiert die Darstellung falls nötig (Werte im Modell bleiben unverändert).
 */
export function checkLensShape(R1: number, R2: number, centerThickness: number, semiAperture: number, minEdge = 0.05): LensShapeCheck {
  const warnings: string[] = [];
  let h = semiAperture;
  const limit = Math.min(maxSemiAperture(R1), maxSemiAperture(R2)) * 0.995;
  if (h > limit) {
    warnings.push(`Durchmesser größer als die Radien zulassen – Darstellung auf Ø ${(2 * limit).toFixed(1)} mm begrenzt.`);
    h = limit;
  }
  const s1 = sag(R1, h);
  const s2 = sag(R2, h);
  let t = centerThickness;
  let edge = t - s1 + s2;
  if (edge < minEdge) {
    const needed = s1 - s2 + minEdge;
    warnings.push(`Randdicke wäre negativ – Mittendicke für die Darstellung auf ${needed.toFixed(2)} mm erhöht.`);
    t = needed;
    edge = minEdge;
  }
  // Mittendicke kann bei Zerstreuungslinsen kleiner werden als die Randdicke – das ist korrekt.
  if (t <= 0) {
    warnings.push('Mittendicke muss größer als 0 sein.');
    t = 0.01;
  }
  return { centerThickness: t, edgeThickness: edge, semiAperture: h, warnings };
}
