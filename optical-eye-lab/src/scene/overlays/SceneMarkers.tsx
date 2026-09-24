/**
 * Lichtquellen und Messpunkte als auswählbare Szenenobjekte.
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { LightSourceEntity, MeasurePointEntity } from '@/model/types';
import { DEG2RAD } from '@/core/units';
import { useAppStore } from '@/state/store';
import { registerRef } from '../interaction/objectRegistry';
import { selectableHandlers, useHoverStore } from '../interaction/hover';
import { SelectionBracket } from '../interaction/SelectionBracket';
import { theme3d } from '../theme3d';
import { RetinoscopeBody } from '../instruments/RetinoscopeView';

export const LightSourceView = memo(function LightSourceView({ light }: { light: LightSourceEntity }) {
  const selected = useAppStore((s) => s.selectedId === light.id);
  const hovered = useHoverStore((s) => s.target?.entityId === light.id);
  const handlers = useMemo(() => selectableHandlers(light.id), [light.id]);
  const ref = useMemo(() => registerRef(light.id), [light.id]);
  const r = Math.max(3, light.source.beamDiameter / 2 + 2);
  const depth = 10;
  const box = useMemo(() => new THREE.Box3(new THREE.Vector3(-r, -r, -depth), new THREE.Vector3(r, r, 1)), [r]);
  const t = light.transform;
  const glow = light.source.color;
  if (light.source.deviceRole === 'retinoscope') {
    const rbox = new THREE.Box3(new THREE.Vector3(-12, -140, -20), new THREE.Vector3(12, 14, 2));
    return (
      <group ref={ref} visible={light.visible} position={t.position} rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]} {...handlers}>
        <RetinoscopeBody light={light} highlight={hovered || selected} />
        {selected && <SelectionBracket box={rbox} />}
      </group>
    );
  }
  return (
    <group
      ref={ref}
      visible={light.visible}
      position={t.position}
      rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]}
      {...handlers}
    >
      <mesh position={[0, 0, -depth / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[r, r * 1.05, depth, 48]} />
        <meshStandardMaterial color="#1a1d22" metalness={0.8} roughness={0.3} emissive={hovered || selected ? theme3d.accentSoft : '#000'} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <circleGeometry args={[r - 1, 48]} />
        <meshBasicMaterial color={glow} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {light.source.kind === 'point' && (
        <mesh position={[0, 0, 0.6]}>
          <sphereGeometry args={[0.8, 16, 12]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      )}
      <Line points={[[0, 0, 0.5], [0, 0, 14]]} color={glow} lineWidth={1.2} transparent opacity={0.7} />
      <Line points={[[-1.6, 0, 11], [0, 0, 14], [1.6, 0, 11]]} color={glow} lineWidth={1.2} transparent opacity={0.7} />
      {selected && <SelectionBracket box={box} />}
    </group>
  );
});

export const MeasurePointView = memo(function MeasurePointView({ point }: { point: MeasurePointEntity }) {
  const selected = useAppStore((s) => s.selectedId === point.id);
  const hovered = useHoverStore((s) => s.target?.entityId === point.id);
  const handlers = useMemo(() => selectableHandlers(point.id), [point.id]);
  const ref = useMemo(() => registerRef(point.id), [point.id]);
  const box = useMemo(() => new THREE.Box3(new THREE.Vector3(-1.5, -1.5, -1.5), new THREE.Vector3(1.5, 1.5, 1.5)), []);
  return (
    <group ref={ref} visible={point.visible} position={point.transform.position} {...handlers}>
      <mesh>
        <sphereGeometry args={[hovered ? 1.1 : 0.9, 24, 16]} />
        <meshStandardMaterial color={point.color} emissive={point.color} emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <Line points={[[-3, 0, 0], [3, 0, 0]]} color={point.color} lineWidth={1} transparent opacity={0.6} />
      <Line points={[[0, -3, 0], [0, 3, 0]]} color={point.color} lineWidth={1} transparent opacity={0.6} />
      <Line points={[[0, 0, -3], [0, 0, 3]]} color={point.color} lineWidth={1} transparent opacity={0.6} />
      {selected && <SelectionBracket box={box} />}
    </group>
  );
});
