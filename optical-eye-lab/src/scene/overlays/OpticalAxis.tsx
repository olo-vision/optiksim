/**
 * Optische Achse des Auges (Hornhautscheitel-Achse) – Bezug für Raytracing,
 * Dezentration, Prismen und spätere Skiaskopie.
 */
import { Line } from '@react-three/drei';
import type { EyeEntity } from '@/model/types';
import { DEG2RAD } from '@/core/units';
import { theme3d } from '../theme3d';

export function OpticalAxis({ eye, frontLength }: { eye: EyeEntity; frontLength: number }) {
  const t = eye.transform;
  const back = eye.anatomy.axialLength + 30;
  return (
    <group position={t.position} rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]} raycast={() => null}>
      <Line
        points={[
          [0, 0, -frontLength],
          [0, 0, back],
        ]}
        color={theme3d.axisDim}
        lineWidth={1}
        dashed
        dashSize={3}
        gapSize={1.6}
        renderOrder={5}
      />
      {/* Scheitelmarke */}
      <Line points={[[-1.4, 0, -0.02], [1.4, 0, -0.02]]} color={theme3d.axis} lineWidth={1.2} />
      <Line points={[[0, -1.4, -0.02], [0, 1.4, -0.02]]} color={theme3d.axis} lineWidth={1.2} />
    </group>
  );
}
