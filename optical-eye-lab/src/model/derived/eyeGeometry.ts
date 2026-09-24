/**
 * Abgeleitete Geometrie des Modellauges (lokal: Ursprung = Hornhautscheitel, +Z ins Auge).
 * Einzige Quelle der Wahrheit für Rendering, Info-Karten und Raytracing.
 */
import type { EyeAnatomy } from '../types';
import { sag } from '@/core/math/surfaces';

export const SCLERA_THICKNESS = 0.9;

export interface Ellipse {
  /** Radiale Halbachse */
  a: number;
  /** Axiale Halbachse */
  b: number;
  /** Mittelpunkt auf der Achse */
  zc: number;
}

export interface EyeGeometry {
  limbus: { h: number; z: number };
  sclera: Ellipse;
  retina: Ellipse;
  /** Parameter t (0 … π) des Limbus auf der Sklera-Ellipse */
  scleraLimbusT: number;
  /** Parameter t der Ora serrata auf der Retina-Ellipse */
  retinaStartT: number;
  corneaBackMaxH: number;
  iris: { z: number; innerR: number; outerR: number };
  lens: { frontZ: number; backZ: number; semiAperture: number };
  /** Posteriorer Pol der Retina (= Baulänge) */
  retinaPoleZ: number;
  /** Mittelpunkt des Augapfels (für Drehung, Kamera-Fokus) */
  globeCenterZ: number;
}

export function ellipsePoint(e: Ellipse, t: number): { h: number; z: number } {
  return { h: e.a * Math.sin(t), z: e.zc - e.b * Math.cos(t) };
}

export function computeEyeGeometry(a: EyeAnatomy): EyeGeometry {
  const hL = Math.min(a.corneaDiameter / 2, a.corneaFrontRadius * 0.98, a.globeRadius * 0.9);
  const zL = sag(a.corneaFrontRadius, hL);

  // Sklera-Ellipse durch Limbus und hinteren Pol
  const as = a.globeRadius;
  const k = Math.sqrt(Math.max(0.0001, 1 - (hL / as) ** 2));
  const posterior = a.axialLength + SCLERA_THICKNESS;
  const bs = (posterior - zL) / (1 + k);
  const zc = posterior - bs;
  const sclera: Ellipse = { a: as, b: bs, zc };
  const scleraLimbusT = Math.asin(Math.min(1, hL / as));

  // Retina: innere Ellipse mit gleichem Zentrum, hinterer Pol = Baulänge
  const retina: Ellipse = { a: as - SCLERA_THICKNESS, b: Math.max(1, a.axialLength - zc), zc };
  const zOra = a.anteriorChamberDepth + a.lensThickness * 0.55;
  const cosT = Math.max(-1, Math.min(1, (zc - zOra) / retina.b));
  const retinaStartT = Math.acos(cosT);

  const irisZ = a.anteriorChamberDepth + 0.15;
  const irisOuter = Math.max(hL - 0.25, a.pupilDiameter / 2 + 0.5);

  return {
    limbus: { h: hL, z: zL },
    sclera,
    retina,
    scleraLimbusT,
    retinaStartT,
    corneaBackMaxH: Math.min(hL * 0.985, Math.abs(a.corneaBackRadius) * 0.98),
    iris: { z: irisZ, innerR: Math.max(0.5, a.pupilDiameter / 2), outerR: irisOuter },
    lens: {
      frontZ: a.anteriorChamberDepth,
      backZ: a.anteriorChamberDepth + a.lensThickness,
      semiAperture: a.lensDiameter / 2,
    },
    retinaPoleZ: a.axialLength,
    globeCenterZ: zc,
  };
}

/** Le-Grand-Modellauge (vereinfacht, homogene Linse), fernakkommodiert. */
export const DEFAULT_EYE_ANATOMY: EyeAnatomy = {
  corneaFrontRadius: 7.8,
  corneaBackRadius: 6.5,
  corneaThickness: 0.55,
  corneaDiameter: 11.8,
  nCornea: 1.3771,
  anteriorChamberDepth: 3.6,
  nAqueous: 1.3374,
  lensFrontRadius: 10.2,
  lensBackRadius: -6.0,
  lensThickness: 4.0,
  lensDiameter: 9.0,
  nLens: 1.42,
  axialLength: 24.2,
  nVitreous: 1.336,
  pupilDiameter: 4.0,
  globeRadius: 12.0,
};
