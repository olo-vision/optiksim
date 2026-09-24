/**
 * Paraxiale Kenngrößen des Modellauges.
 * Vorbereitung für die Module Fehlsichtigkeit, Korrektion, HSA und Akkommodation.
 */
import type { EyeAnatomy } from '@/model/types';
import { traceParaxial, type ParaxialSurface } from './paraxial';
import { isPlano } from '@/core/math/surfaces';

export function eyeParaxialSurfaces(a: EyeAnatomy, nOutside = 1): ParaxialSurface[] {
  return [
    { z: 0, R: a.corneaFrontRadius, n1: nOutside, n2: a.nCornea, label: 'Hornhaut vorn' },
    { z: a.corneaThickness, R: a.corneaBackRadius, n1: a.nCornea, n2: a.nAqueous, label: 'Hornhaut hinten' },
    { z: a.anteriorChamberDepth, R: a.lensFrontRadius, n1: a.nAqueous, n2: a.nLens, label: 'Linse vorn' },
    { z: a.anteriorChamberDepth + a.lensThickness, R: a.lensBackRadius, n1: a.nLens, n2: a.nVitreous, label: 'Linse hinten' },
  ];
}

/** Bildlage eines axialen Objektpunkts bei z0 (−∞ erlaubt). Rückgabe: Bildort z [mm] */
export function imageOfAxialPoint(surfaces: ParaxialSurface[], z0: number): number {
  let y = 1;
  let nu = Number.isFinite(z0) ? surfaces[0].n1 * (1 / (surfaces[0].z - z0)) : 0;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    const phi = isPlano(s.R) ? 0 : (s.n2 - s.n1) / s.R;
    nu = nu - y * phi;
    const next = surfaces[i + 1];
    if (next) y = y + ((next.z - s.z) / s.n2) * nu;
  }
  const last = surfaces[surfaces.length - 1];
  const u = nu / last.n2;
  return Math.abs(u) < 1e-12 ? Infinity : last.z - y / u;
}

/** Spiegelt ein System an z = 0 (für Rückwärtsrechnung). */
function reverseSystem(surfaces: ParaxialSurface[]): ParaxialSurface[] {
  return [...surfaces].reverse().map((s) => ({ z: -s.z, R: isPlano(s.R) ? 0 : -s.R, n1: s.n2, n2: s.n1, label: s.label }));
}

export interface EyeOpticsSummary {
  corneaPower: number;
  lensPower: number;
  totalPower: number;
  /** Bildort für Objekt im Unendlichen (ab Hornhautscheitel) */
  imageZ: number;
  /** Bildlage relativ zur Retina: > 0 hinter, < 0 vor der Retina [mm] */
  defocusMm: number;
  /** Fernpunktrefraktion bezogen auf den Hornhautscheitel [dpt] */
  refractionAtCornea: number;
}

export function summarizeEye(a: EyeAnatomy): EyeOpticsSummary {
  const s = eyeParaxialSurfaces(a);
  const cornea = traceParaxial(s.slice(0, 2));
  // Linse im Medium Kammerwasser/Glaskörper
  const lensSys = traceParaxial([
    { z: 0, R: a.lensFrontRadius, n1: a.nAqueous, n2: a.nLens },
    { z: a.lensThickness, R: a.lensBackRadius, n1: a.nLens, n2: a.nVitreous },
  ]);
  const total = traceParaxial(s);
  // Fernpunkt: Retina rückwärts abbilden
  const rev = reverseSystem(s);
  const fpMirrored = imageOfAxialPoint(rev, -a.axialLength);
  const farPoint = Number.isFinite(fpMirrored) ? -fpMirrored : Infinity;
  const refraction = Number.isFinite(farPoint) && Math.abs(farPoint) > 1e-6 ? 1000 / farPoint : 0;
  return {
    corneaPower: cornea.power,
    lensPower: lensSys.power,
    totalPower: total.power,
    imageZ: total.backFocusZ,
    defocusMm: total.backFocusZ - a.axialLength,
    refractionAtCornea: refraction,
  };
}
