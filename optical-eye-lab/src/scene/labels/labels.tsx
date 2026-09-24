/**
 * Leichtgewichtiges Label-System für Beschriftungen in der 3D-Szene.
 *
 * - <SceneLabel> (im R3F-Baum) registriert einen Anker und Inhalt.
 * - <LabelProjector> (im R3F-Baum) projiziert pro gerendertem Frame alle Anker
 *   auf den Bildschirm und schreibt die Position direkt ins DOM (kein React-Render).
 * - <LabelLayer> (im DOM-Baum) rendert die eigentlichen HTML-Labels.
 *
 * Vorteil gegenüber drei/Html: kein eigener React-Root pro Label, keine
 * Unmount-Warnungen, deutlich weniger Overhead bei vielen Bemaßungen.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { create } from 'zustand';

export type LabelVariant = 'eye' | 'bench' | 'dim' | 'dim-emphasis' | 'focus';

interface LabelEntry {
  id: number;
  text: string;
  sub?: string;
  variant: LabelVariant;
  anchor: THREE.Object3D;
}

interface LabelState {
  labels: Map<number, LabelEntry>;
  upsert: (e: LabelEntry) => void;
  remove: (id: number) => void;
}

export const useLabelStore = create<LabelState>()((set, get) => ({
  labels: new Map(),
  upsert: (e) => {
    const prev = get().labels.get(e.id);
    if (prev && prev.text === e.text && prev.sub === e.sub && prev.variant === e.variant && prev.anchor === e.anchor) return;
    const m = new Map(get().labels);
    m.set(e.id, e);
    set({ labels: m });
  },
  remove: (id) => {
    if (!get().labels.has(id)) return;
    const m = new Map(get().labels);
    m.delete(id);
    set({ labels: m });
  },
}));

/** DOM-Elemente der Labels (für direkte Positionierung ohne React). */
const domRefs = new Map<number, HTMLDivElement>();
let nextId = 1;

export function SceneLabel({ position, text, sub, variant = 'dim' }: { position: THREE.Vector3Tuple | THREE.Vector3; text: string; sub?: string; variant?: LabelVariant }) {
  const ref = useRef<THREE.Group>(null);
  const id = useMemo(() => nextId++, []);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    if (ref.current) useLabelStore.getState().upsert({ id, text, sub, variant, anchor: ref.current });
    invalidate();
  }, [id, text, sub, variant, invalidate]);
  useEffect(() => () => useLabelStore.getState().remove(id), [id]);
  const pos = position instanceof THREE.Vector3 ? position.toArray() : position;
  return <group ref={ref} position={pos as THREE.Vector3Tuple} />;
}

function isVisible(o: THREE.Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new THREE.Vector3(), []);

  // neue Labels brauchen einen Frame zur Positionierung
  useEffect(() => useLabelStore.subscribe(() => invalidate()), [invalidate]);

  useFrame(() => {
    for (const [id, e] of useLabelStore.getState().labels) {
      const el = domRefs.get(id);
      if (!el) continue;
      e.anchor.getWorldPosition(v);
      v.project(camera);
      const hidden = v.z > 1 || v.z < -1 || !isVisible(e.anchor);
      if (hidden) {
        el.style.visibility = 'hidden';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
    // Priorität 0: R3F rendert weiterhin automatisch (positive Prioritäten übernehmen den Render-Loop)
  });
  return null;
}

const CLASS: Record<LabelVariant, string> = {
  eye: 'scene-label scene-label--eye',
  bench: 'bench-label',
  dim: 'dim-label',
  'dim-emphasis': 'dim-label dim-label--emphasis',
  focus: 'dim-label dim-label--focus',
};

export function LabelLayer() {
  const labels = useLabelStore((s) => s.labels);
  return (
    <div className="label-layer" aria-hidden>
      {[...labels.values()].map((l) => (
        <div
          key={l.id}
          className="label-layer__item"
          style={{ visibility: 'hidden' }}
          ref={(el) => {
            if (el) domRefs.set(l.id, el);
            else domRefs.delete(l.id);
          }}
        >
          <div className={CLASS[l.variant]}>
            {l.variant.startsWith('dim') || l.variant === 'focus' ? (
              <>
                <span className="dim-label__value">{l.text}</span>
                {l.sub && <span className="dim-label__sub">{l.sub}</span>}
              </>
            ) : (
              l.text
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
