/**
 * Paraxiale Durchrechnung zentrierter Systeme (Matrix-/y-nu-Verfahren).
 *
 * Grundlage für spätere Module: Fehlsichtigkeit, HSA, Korrektion,
 * Fernpunkt, Kardinalpunkte des Auges.
 */
import { isPlano } from '@/core/math/surfaces';

export interface ParaxialSurface {
  /** Scheitelposition auf der Achse [mm] */
  z: number;
  /** Krümmungsradius [mm], 0 = plan */
  R: number;
  /** Brechungsindex vor der Fläche */
  n1: number;
  /** Brechungsindex hinter der Fläche */
  n2: number;
  label?: string;
}

export interface ParaxialResult {
  /** Gesamtbrechkraft [dpt] */
  power: number;
  /** Bildseitige Schnittweite ab letzter Fläche [mm] */
  backFocalDistance: number;
  /** Lage des bildseitigen Brennpunkts auf der Achse [mm] */
  backFocusZ: number;
  /** Bildseitige Brennweite f' [mm] */
  effectiveFocalLength: number;
}

/**
 * Durchrechnung eines achsparallelen Strahls (Objekt im Unendlichen).
 * Verwendet reduzierte Winkel: nu' = nu − y·φ,   y' = y + (d/n)·nu'
 */
export function traceParaxial(surfaces: ParaxialSurface[]): ParaxialResult {
  if (surfaces.length === 0) return { power: 0, backFocalDistance: Infinity, backFocusZ: Infinity, effectiveFocalLength: Infinity };
  let y = 1; // mm
  let nu = 0;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    const phi = isPlano(s.R) ? 0 : (s.n2 - s.n1) / s.R; // 1/mm
    nu = nu - y * phi;
    const next = surfaces[i + 1];
    if (next) y = y + ((next.z - s.z) / s.n2) * nu;
  }
  const last = surfaces[surfaces.length - 1];
  const nLast = last.n2;
  const u = nu / nLast;
  const bfd = u !== 0 ? -y / u : Infinity;
  // Systembrechkraft φ = −nu' / y₀ (y₀ = 1)
  const phiSys = -nu; // 1/mm
  return {
    power: phiSys * 1000,
    backFocalDistance: bfd,
    backFocusZ: last.z + bfd,
    effectiveFocalLength: phiSys !== 0 ? nLast / phiSys : Infinity,
  };
}
