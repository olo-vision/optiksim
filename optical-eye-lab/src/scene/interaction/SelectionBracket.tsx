/**
 * CAD-typische Eckmarkierung um die Bounding-Box des ausgewählten Objekts.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { theme3d } from '../theme3d';

interface Props {
  box: THREE.Box3;
  color?: string;
  opacity?: number;
}

export function SelectionBracket({ box, color = theme3d.accent, opacity = 0.95 }: Props) {
  const geometry = useMemo(() => {
    const pad = 0.8;
    const min = box.min.clone().subScalar(pad);
    const max = box.max.clone().addScalar(pad);
    const size = max.clone().sub(min);
    const len = Math.min(size.x, size.y, size.z) * 0.22 + 0.6;
    const pts: number[] = [];
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const sx = x === min.x ? 1 : -1;
          const sy = y === min.y ? 1 : -1;
          const sz = z === min.z ? 1 : -1;
          pts.push(x, y, z, x + sx * Math.min(len, size.x / 2), y, z);
          pts.push(x, y, z, x, y + sy * Math.min(len, size.y / 2), z);
          pts.push(x, y, z, x, y, z + sz * Math.min(len, size.z / 2));
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [box]);

  return (
    <lineSegments geometry={geometry} renderOrder={10} raycast={() => null}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} toneMapped={false} />
    </lineSegments>
  );
}
