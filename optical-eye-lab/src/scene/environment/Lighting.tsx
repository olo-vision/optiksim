/**
 * Studio-Beleuchtung: Key-, Rim- und Fülllicht sowie eine prozedurale Umgebung
 * (Lightformer, keine externen HDRI-Dateien) für realistische Glasreflexe.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Vec3 } from '@/model/types';

interface Props {
  target: Vec3;
  shadows: boolean;
  exposure: number;
}

export function Lighting({ target, shadows, exposure }: Props) {
  const key = useRef<THREE.DirectionalLight>(null);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    gl.toneMappingExposure = exposure;
    invalidate();
  }, [gl, exposure, invalidate]);

  useEffect(() => {
    if (!key.current) return;
    key.current.target.position.set(target[0], target[1], target[2]);
    key.current.target.updateMatrixWorld();
    invalidate();
  }, [target, invalidate]);

  return (
    <>
      <ambientLight intensity={0.12} />
      <hemisphereLight args={['#d6e6ff', '#08090c', 0.22]} />
      <directionalLight
        ref={key}
        position={[target[0] - 260, target[1] + 420, target[2] - 340]}
        intensity={2.1}
        color="#fff6ec"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-320}
        shadow-camera-right={320}
        shadow-camera-top={320}
        shadow-camera-bottom={-320}
        shadow-camera-near={10}
        shadow-camera-far={1600}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
      <directionalLight position={[target[0] + 320, target[1] + 160, target[2] + 420]} intensity={0.9} color="#9cc8ff" />
      <directionalLight position={[target[0] + 200, target[1] - 60, target[2] - 380]} intensity={0.35} color="#ffffff" />

      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#06080b']} />
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 6, -6]} rotation={[Math.PI / 3, 0, 0]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#dbeaff" position={[-8, 1, 0]} rotation={[0, Math.PI / 2, 0]} scale={[3, 8, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#ffffff" position={[8, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[2, 6, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#bfe2ff" position={[0, 3, 8]} scale={3} />
        <Lightformer form="rect" intensity={0.25} color="#8fa3b8" position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
      </Environment>
    </>
  );
}
