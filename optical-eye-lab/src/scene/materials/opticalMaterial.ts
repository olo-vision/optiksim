/**
 * Material-Mapping: Datenmodell (Medium + Erscheinung) → Three.js-Materialparameter.
 * Die physikalische Transmission (Brechung im Bild) nutzt den Transmissions-Pass von Three.js;
 * im Leistungsmodus wird auf einfache Transparenz umgeschaltet.
 */
import * as THREE from 'three';
import type { Appearance } from '@/model/types';
import type { QualityLevel } from '@/state/persistence';

export interface OpticalMaterialProps {
  color: THREE.Color;
  transmission: number;
  opacity: number;
  transparent: boolean;
  roughness: number;
  metalness: number;
  ior: number;
  thickness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  iridescence: number;
  iridescenceIOR: number;
  attenuationColor: THREE.Color;
  attenuationDistance: number;
  envMapIntensity: number;
  specularIntensity: number;
  side: THREE.Side;
  depthWrite: boolean;
}

export function opticalMaterialProps(app: Appearance, n: number, thickness: number, quality: QualityLevel): OpticalMaterialProps {
  const tint = new THREE.Color(app.tint);
  const clear = Math.max(0, Math.min(1, app.transparency));
  const useTransmission = quality !== 'performance';
  const frosted = app.finish === 'frosted';
  const tinted = app.finish === 'tinted';
  return {
    color: tint,
    transmission: useTransmission ? clear : 0,
    opacity: useTransmission ? 1 : 0.18 + (1 - clear) * 0.8,
    transparent: !useTransmission,
    roughness: frosted ? 0.42 : 0,
    metalness: 0,
    ior: Math.max(1, Math.min(2.333, n)),
    thickness: Math.max(0.05, thickness * 0.6),
    clearcoat: 0,
    clearcoatRoughness: 0.05,
    iridescence: app.finish === 'coated' ? 0.45 : 0,
    iridescenceIOR: 1.45,
    attenuationColor: tinted ? tint : new THREE.Color('#ffffff'),
    attenuationDistance: tinted ? Math.max(1, thickness * 1.5) : Infinity,
    envMapIntensity: app.finish === 'coated' ? 0.55 : 0.9,
    specularIntensity: app.finish === 'coated' ? 0.35 : 0.9,
    side: THREE.DoubleSide,
    depthWrite: useTransmission,
  };
}
