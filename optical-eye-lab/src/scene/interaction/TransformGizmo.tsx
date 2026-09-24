/**
 * Transform-Gizmo (Verschieben / Drehen) für die aktuelle Auswahl.
 * Schreibt Änderungen live in den Store; eine Ziehbewegung = ein Undo-Schritt.
 * Umschalt-Taste invertiert das Raster-Einrasten während des Ziehens.
 */
import { useEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { useAppStore, findEntity } from '@/state/store';
import { RAD2DEG } from '@/core/units';
import { useObjectRegistry } from './objectRegistry';

/** Globaler Zustand, damit „Klick ins Leere“ nach einem Gizmo-Drag nicht die Auswahl aufhebt. */
export const gizmoState = { axisHovered: false, lastDragEnd: 0, dragging: false };

const round = (v: number, d = 1000) => Math.round(v * d) / d;

export function TransformGizmo() {
  const selectedId = useAppStore((s) => s.selectedId);
  const entity = useAppStore((s) => findEntity(s.doc, s.selectedId));
  const tool = useAppStore((s) => s.tool);
  const snapping = useAppStore((s) => s.snapping);
  const space = useAppStore((s) => s.transformSpace);
  const prefs = useAppStore((s) => s.prefs);
  const obj = useObjectRegistry((s) => (selectedId ? s.objects.get(selectedId) : undefined));
  useObjectRegistry((s) => s.version);
  const ref = useRef<TransformControlsImpl>(null);
  const [shift, setShift] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Shift' && setShift(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setShift(false);
    const blur = () => setShift(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Achsen-Hover für die Klick-Behandlung merken
  useEffect(() => {
    const c = ref.current as unknown as { addEventListener: (t: string, f: (e: { value: unknown }) => void) => void; removeEventListener: (t: string, f: (e: { value: unknown }) => void) => void } | null;
    if (!c) return;
    const onAxis = (e: { value: unknown }) => {
      gizmoState.axisHovered = e.value !== null;
    };
    c.addEventListener('axis-changed', onAxis);
    return () => {
      c.removeEventListener('axis-changed', onAxis);
      gizmoState.axisHovered = false;
    };
  });

  if (!entity || !obj || tool === 'select' || entity.locked || !entity.visible) return null;
  const mode = tool === 'rotate' && entity.entityType !== 'measure-point' ? 'rotate' : 'translate';
  const snap = snapping !== shift;

  return (
    <TransformControls
      ref={ref as never}
      object={obj}
      mode={mode}
      space={space}
      size={prefs.gizmoSize}
      translationSnap={snap ? prefs.translationSnap : null}
      rotationSnap={snap ? (prefs.rotationSnap * Math.PI) / 180 : null}
      onMouseDown={() => {
        gizmoState.dragging = true;
        useAppStore.getState().beginGesture();
      }}
      onMouseUp={() => {
        gizmoState.dragging = false;
        gizmoState.lastDragEnd = performance.now();
        useAppStore.getState().endGesture();
      }}
      onObjectChange={() => {
        const id = useAppStore.getState().selectedId;
        if (!id) return;
        const p = obj.position;
        const r = obj.rotation;
        useAppStore.getState().setTransform(id, {
          position: [round(p.x), round(p.y), round(p.z)],
          rotation: [round(r.x * RAD2DEG, 100), round(r.y * RAD2DEG, 100), round(r.z * RAD2DEG, 100)],
        });
      }}
    />
  );
}
