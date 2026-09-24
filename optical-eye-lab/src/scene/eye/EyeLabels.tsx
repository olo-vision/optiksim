/**
 * Beschriftung der Augenstrukturen in der Schnittansicht (Leader-Linien + HTML-Labels).
 */
import { Line } from '@react-three/drei';
import { SceneLabel } from '../labels/labels';
import type { EyeAnatomy } from '@/model/types';
import { ellipsePoint, type EyeGeometry } from '@/model/derived/eyeGeometry';
import { sag } from '@/core/math/surfaces';
import { theme3d } from '../theme3d';

interface LabelDef {
  text: string;
  anchor: [number, number, number];
  label: [number, number, number];
}

export function EyeLabels({ anatomy: a, geometry: g }: { anatomy: EyeAnatomy; geometry: EyeGeometry }) {
  const retinaPt = ellipsePoint(g.retina, 2.35);
  const scleraPt = ellipsePoint(g.sclera, 2.1);
  const labels: LabelDef[] = [
    { text: 'Hornhaut', anchor: [0, 3.2, sag(a.corneaFrontRadius, 3.2) + 0.25], label: [0, 10, -6.5] },
    { text: 'Vorderkammer', anchor: [0, 1.6, (a.corneaThickness + g.iris.z) / 2 + 0.4], label: [0, 14.5, -1] },
    { text: 'Iris', anchor: [0, -(g.iris.innerR + g.iris.outerR) / 2, g.iris.z], label: [0, -10.5, -6] },
    { text: 'Augenlinse', anchor: [0, -1.5, (g.lens.frontZ + g.lens.backZ) / 2], label: [0, -14.5, 1.5] },
    { text: 'Glaskörper', anchor: [0, 3, (g.lens.backZ + a.axialLength) / 2], label: [0, 15, 11] },
    { text: 'Netzhaut', anchor: [0, retinaPt.h, retinaPt.z], label: [0, 13.5, 26.5] },
    { text: 'Lederhaut', anchor: [0, -scleraPt.h, scleraPt.z], label: [0, -14.5, 22] },
  ];
  return (
    <group raycast={() => null}>
      {labels.map((l) => (
        <group key={l.text}>
          <Line points={[l.anchor, l.label]} color={theme3d.dimensionMuted} lineWidth={1} transparent opacity={0.8} depthTest={false} renderOrder={20} />
          <mesh position={l.anchor} renderOrder={21}>
            <sphereGeometry args={[0.18, 12, 8]} />
            <meshBasicMaterial color={theme3d.dimension} depthTest={false} toneMapped={false} />
          </mesh>
          <SceneLabel position={l.label} text={l.text} variant="eye" />
        </group>
      ))}
    </group>
  );
}
