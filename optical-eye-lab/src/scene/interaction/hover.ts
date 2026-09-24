/**
 * Hover-Zustand (bewusst getrennt vom Haupt-Store, um Re-Renders der UI zu vermeiden).
 */
import { create } from 'zustand';
import type { ThreeEvent } from '@react-three/fiber';
import type { EyePartId } from '@/model/types';
import { useAppStore } from '@/state/store';

export interface HoverTarget {
  entityId: string;
  part?: EyePartId;
}

interface HoverState {
  target: HoverTarget | null;
  x: number;
  y: number;
  setTarget: (t: HoverTarget | null, x?: number, y?: number) => void;
  move: (x: number, y: number) => void;
}

export const useHoverStore = create<HoverState>()((set) => ({
  target: null,
  x: 0,
  y: 0,
  setTarget: (target, x, y) => set((s) => ({ target, x: x ?? s.x, y: y ?? s.y })),
  move: (x, y) => set({ x, y }),
}));

const sameTarget = (a: HoverTarget | null, b: HoverTarget | null) => a?.entityId === b?.entityId && a?.part === b?.part;

/**
 * Standard-Pointer-Handler für auswählbare Entitäten.
 * Linke Maustaste wählt aus; andere Tasten bleiben der Kamera vorbehalten.
 */
export function selectableHandlers(entityId: string, partOf?: (e: ThreeEvent<PointerEvent>) => EyePartId | undefined) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const t = { entityId, part: partOf?.(e) };
      if (!sameTarget(useHoverStore.getState().target, t)) useHoverStore.getState().setTarget(t, e.nativeEvent.clientX, e.nativeEvent.clientY);
      document.body.style.cursor = 'pointer';
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const t = { entityId, part: partOf?.(e) };
      const hs = useHoverStore.getState();
      if (!sameTarget(hs.target, t)) hs.setTarget(t, e.nativeEvent.clientX, e.nativeEvent.clientY);
      else hs.move(e.nativeEvent.clientX, e.nativeEvent.clientY);
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const hs = useHoverStore.getState();
      if (hs.target?.entityId === entityId) hs.setTarget(null);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.nativeEvent.button !== 0) return;
      // Klick nach Kamerabewegung ignorieren
      if (e.delta > 4) return;
      e.stopPropagation();
      useAppStore.getState().select(entityId, partOf?.(e as unknown as ThreeEvent<PointerEvent>) ?? null);
    },
  };
}
