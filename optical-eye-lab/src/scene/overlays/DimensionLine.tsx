/**
 * CAD-Bemaßung: Maßlinie mit Hilfslinien, Schrägstrich-Begrenzung und Beschriftung.
 * Alle Koordinaten im Eltern-Koordinatensystem (typisch: Augen-lokal).
 */
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { SceneLabel } from '../labels/labels';
import * as THREE from 'three';
import { theme3d } from '../theme3d';

interface Props {
  /** Messpunkte (auf dem Objekt) */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Versatz der Maßlinie (Richtung + Länge) */
  offset: THREE.Vector3;
  label: string;
  sublabel?: string;
  color?: string;
  emphasis?: boolean;
}

export function DimensionLine({ from, to, offset, label, sublabel, color = theme3d.dimension, emphasis }: Props) {
  const geom = useMemo(() => {
    const a = from.clone().add(offset);
    const b = to.clone().add(offset);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const off = offset.clone().normalize();
    const tick = Math.min(1.6, Math.max(0.6, len * 0.08));
    const slash = dir.clone().multiplyScalar(tick * 0.7).add(off.clone().multiplyScalar(tick * 0.7));
    const ext = off.clone().multiplyScalar(1.5);
    return {
      main: [a, b] as [THREE.Vector3, THREE.Vector3],
      ext1: [from.clone().add(off.clone().multiplyScalar(0.6)), a.clone().add(ext)] as [THREE.Vector3, THREE.Vector3],
      ext2: [to.clone().add(off.clone().multiplyScalar(0.6)), b.clone().add(ext)] as [THREE.Vector3, THREE.Vector3],
      s1: [a.clone().sub(slash), a.clone().add(slash)] as [THREE.Vector3, THREE.Vector3],
      s2: [b.clone().sub(slash), b.clone().add(slash)] as [THREE.Vector3, THREE.Vector3],
      mid: a.clone().add(b).multiplyScalar(0.5).add(off.clone().multiplyScalar(2.2)),
      len,
    };
  }, [from, to, offset]);

  if (geom.len < 1e-4) return null;
  const common = { color, transparent: true, depthTest: false, renderOrder: 30 } as const;
  return (
    <group raycast={() => null}>
      <Line points={geom.main} lineWidth={emphasis ? 1.6 : 1.1} {...common} opacity={0.95} />
      <Line points={geom.ext1} lineWidth={0.8} {...common} opacity={0.5} dashed dashSize={0.6} gapSize={0.4} />
      <Line points={geom.ext2} lineWidth={0.8} {...common} opacity={0.5} dashed dashSize={0.6} gapSize={0.4} />
      <Line points={geom.s1} lineWidth={1.4} {...common} opacity={0.95} />
      <Line points={geom.s2} lineWidth={1.4} {...common} opacity={0.95} />
      <SceneLabel position={geom.mid} text={label} sub={sublabel} variant={emphasis ? 'dim-emphasis' : 'dim'} />
    </group>
  );
}
