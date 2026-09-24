/**
 * Darstellung eines optischen Elements. Wählt Geometrie anhand der Elementfamilie.
 */
import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { EyeEntity, LensElement, OpticalElement } from '@/model/types';
import { effectiveLens, isSoftOnEye } from '@/model/derived/effectiveLens';
import { resolveLensShape, elementAxialExtent } from '@/model/derived/elementShape';
import { outlineRadius } from '@/core/math/outline';
import { DEG2RAD } from '@/core/units';
import { useAppStore } from '@/state/store';
import { buildLensGeometry } from './geometry/lensGeometry';
import { buildMediumGeometry, buildPrismGeometry } from './geometry/shapes';
import { opticalMaterialProps } from '../materials/opticalMaterial';
import { registerRef } from '../interaction/objectRegistry';
import { selectableHandlers, useHoverStore } from '../interaction/hover';
import { SelectionBracket } from '../interaction/SelectionBracket';
import { theme3d } from '../theme3d';

function useElementGeometry(el: OpticalElement, eye: EyeEntity): THREE.BufferGeometry {
  const key =
    el.family === 'lens' ? el.lens : el.family === 'prism' ? el.prism : el.family === 'plate' ? el.plate : el.body;
  // Weiche KL auf dem Auge hängt von der Hornhautform ab (Schmiegung)
  const eyeKey = el.family === 'lens' && isSoftOnEye(el) ? eye.anatomy : null;
  const contactKey = el.family === 'lens' ? el.contact : null;
  const geometry = useMemo(() => {
    switch (el.family) {
      case 'lens': {
        const s = resolveLensShape(el);
        const p = el.lens;
        const isContact = !!el.contact;
        const eff = effectiveLens(el, eye);
        return buildLensGeometry({
          R1: p.frontRadius,
          R2: p.backRadius,
          frontSpec: eff.front,
          backSpec: eff.back,
          thickness: s.centerThickness,
          outline: (phi) => Math.min(outlineRadius(p.outline, p.diameter, p.width, p.height, phi), s.semiAperture),
          radialSegments: isContact ? 28 : 20,
          angularSegments: p.outline === 'round' ? 96 : 128,
        });
      }
      case 'prism':
        return buildPrismGeometry(el.prism);
      case 'plate': {
        const g = new THREE.BoxGeometry(el.plate.width, el.plate.height, el.plate.thickness);
        g.computeBoundingBox();
        return g;
      }
      case 'medium':
        return buildMediumGeometry(el.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eyeKey, contactKey]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function MagnifierFittings({ el }: { el: LensElement }) {
  const s = resolveLensShape(el);
  const r = s.semiAperture;
  const m = el.magnifier;
  if (!m) return null;
  return (
    <group raycast={() => null}>
      {m.showFrame && (
        <mesh castShadow>
          <torusGeometry args={[r + 1.2, 1.6, 20, 96]} />
          <meshStandardMaterial color={theme3d.metal} metalness={0.85} roughness={0.28} />
        </mesh>
      )}
      {m.showHandle && (
        <group position={[0, -(r + 2.4), 0]}>
          <mesh position={[0, -6, 0]} castShadow>
            <cylinderGeometry args={[2.2, 2.6, 12, 32]} />
            <meshStandardMaterial color={theme3d.metal} metalness={0.85} roughness={0.3} />
          </mesh>
          <mesh position={[0, -12 - 32, 0]} castShadow>
            <cylinderGeometry args={[4, 3.4, 64, 40]} />
            <meshStandardMaterial color="#121418" metalness={0.1} roughness={0.62} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export const OpticalElementView = memo(function OpticalElementView({ el, eye }: { el: OpticalElement; eye: EyeEntity }) {
  const geometry = useElementGeometry(el, eye);
  const quality = useAppStore((s) => s.prefs.quality);
  const selected = useAppStore((s) => s.selectedId === el.id);
  const hovered = useHoverStore((s) => s.target?.entityId === el.id);

  const ext = elementAxialExtent(el);
  const mat = useMemo(
    () => opticalMaterialProps(el.appearance, el.medium.n, ext.back - ext.front, quality),
    [el.appearance, el.medium.n, ext.back, ext.front, quality],
  );
  const handlers = useMemo(() => selectableHandlers(el.id), [el.id]);
  const ref = useMemo(() => registerRef(el.id), [el.id]);
  const box = useMemo(() => geometry.boundingBox ?? new THREE.Box3(), [geometry]);

  const t = el.transform;
  const scale = el.family === 'medium' ? t.scale : ([1, 1, 1] as const);

  return (
    <group
      ref={ref}
      name={el.name}
      visible={el.visible}
      position={t.position}
      rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]}
      scale={scale as [number, number, number]}
      userData={{ entityId: el.id }}
    >
      <mesh geometry={geometry} {...handlers} renderOrder={2}>
        <meshPhysicalMaterial {...mat} />
        {(selected || hovered) && (
          <Edges threshold={28} color={selected ? theme3d.accent : theme3d.hover} lineWidth={selected ? 1.4 : 1} renderOrder={3} />
        )}
      </mesh>
      {el.family === 'lens' && el.kind === 'magnifier' && <MagnifierFittings el={el} />}
      {selected && <SelectionBracket box={box} />}
    </group>
  );
});
