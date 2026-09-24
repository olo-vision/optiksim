/**
 * Nur im Entwicklungsmodus: Test-Hooks für automatisierte UI-Tests
 * (Store-Zugriff und Bildschirmprojektion von Objekten).
 */
import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useAppStore } from '@/state/store';
import { useObjectRegistry } from './interaction/objectRegistry';

export function DevHooks() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__oel = useAppStore;
    w.__oelRender = () => {
      const t0 = performance.now();
      gl.render(scene, camera);
      return { ms: performance.now() - t0, calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length };
    };
    w.__oelProject = (id: string, offset: [number, number, number] = [0, 0, 0]) => {
      const o = useObjectRegistry.getState().objects.get(id);
      if (!o) return null;
      const v = o.localToWorld(new THREE.Vector3(...offset)).project(camera);
      const rect = (document.querySelector('.viewport canvas') as HTMLCanvasElement).getBoundingClientRect();
      return { x: rect.left + (v.x * 0.5 + 0.5) * size.width, y: rect.top + (-v.y * 0.5 + 0.5) * size.height };
    };
  }, [camera, size, gl, scene]);
  return null;
}
