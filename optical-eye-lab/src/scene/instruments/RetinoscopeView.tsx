/**
 * 3D-Darstellung des Strichskiaskops (Phase 4): Griff, Kopf mit Guckloch und das Lichtband
 * (Strichlage, Schwenk) als leuchtende Fläche bis zur Augenebene.
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { LightSourceEntity } from '@/model/types';
import { useAppStore } from '@/state/store';
import { worldToEyeLocal } from '@/model/sceneFactory';
import { DEFAULT_RETINOSCOPE } from '@/engine/optics/retinoscopy';
import { theme3d } from '../theme3d';

export const RetinoscopeBody = memo(function RetinoscopeBody({ light, highlight }: { light: LightSourceEntity; highlight: boolean }) {
  const eye = useAppStore((s) => s.doc.eye);
  const p = { ...DEFAULT_RETINOSCOPE, ...(light.retinoscope ?? {}) };
  const w = Math.max(20, -worldToEyeLocal(eye, light.transform.position)[2]);
  // Strichrichtung TABO θ → lokal (−cos θ, sin θ); Schwenk entlang der Senkrechten
  const th = (p.streakAxis * Math.PI) / 180;
  const beamRot = Math.atan2(Math.sin(th), -Math.cos(th));
  const mx = -Math.cos(th + Math.PI / 2);
  const my = Math.sin(th + Math.PI / 2);
  const beamGeo = useMemo(() => {
    // Trapez: am Skiaskop schmal, am Auge ~30 mm lang, Breite = Strichbreite
    const len = w;
    const g = new THREE.BufferGeometry();
    const near = 3;
    const far = 16;
    const verts = new Float32Array([-near, 0, 0, near, 0, 0, far, 0, len, -far, 0, len]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, [w]);
  const bodyColor = highlight ? '#2b3d4d' : '#20252c';
  return (
    <group>
      {/* Kopf */}
      <mesh position={[0, 0, -9]} castShadow>
        <boxGeometry args={[22, 26, 18]} />
        <meshStandardMaterial color={bodyColor} metalness={0.6} roughness={0.35} emissive={highlight ? theme3d.accentSoft : '#000'} emissiveIntensity={0.35} />
      </mesh>
      {/* Guckloch-Ring */}
      <mesh position={[0, 3, 0.2]}>
        <ringGeometry args={[1.3, 2.6, 32]} />
        <meshBasicMaterial color="#0b0d10" side={THREE.DoubleSide} />
      </mesh>
      {/* Austrittsfenster */}
      <mesh position={[0, -4, 0.3]}>
        <planeGeometry args={[9, 5]} />
        <meshBasicMaterial color="#ffcf8a" toneMapped={false} />
      </mesh>
      {/* Griff */}
      <mesh position={[0, -80, -10]}>
        <cylinderGeometry args={[9, 10, 120, 32]} />
        <meshStandardMaterial color={bodyColor} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0, -18, -10]}>
        <cylinderGeometry args={[6.5, 9, 12, 32]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* Lichtband */}
      <group rotation={[0, 0, beamRot]} position={[(mx * p.sweep) / 2, (my * p.sweep) / 2, 0]}>
        <mesh geometry={beamGeo} renderOrder={5} raycast={() => null}>
          <meshBasicMaterial color="#ffc27a" transparent opacity={0.16 * p.intensity + 0.04} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
});
