/**
 * Registry: Entitäts-ID → Three.js-Objekt.
 * Ermöglicht Transform-Gizmo und Kamera-Fokus, ohne Three.js-Objekte im State zu halten.
 */
import type * as THREE from 'three';
import { create } from 'zustand';

interface RegistryState {
  objects: Map<string, THREE.Object3D>;
  version: number;
  register: (id: string, obj: THREE.Object3D | null) => void;
}

export const useObjectRegistry = create<RegistryState>()((set, get) => ({
  objects: new Map(),
  version: 0,
  register: (id, obj) => {
    const map = get().objects;
    const current = map.get(id);
    if (obj) {
      if (current === obj) return;
      map.set(id, obj);
    } else {
      if (!current) return;
      map.delete(id);
    }
    set({ version: get().version + 1 });
  },
}));

/** Ref-Callback-Fabrik für Gruppen von Entitäten. */
export function registerRef(id: string) {
  return (obj: THREE.Object3D | null) => useObjectRegistry.getState().register(id, obj);
}
