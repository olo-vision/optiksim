/**
 * Tränenfilm unter aufgesetzten Kontaktlinsen: Dickenkarte auf der Hornhaut (Vorschau).
 * Helligkeit ∝ lokale Tränenfilmdicke (additiv; dunkel = Auflage). Grundlage für das
 * spätere Fluoreszeinbild (Phase 3) – hier bewusst neutral eingefärbt.
 */
import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { EyeEntity, LensElement } from '@/model/types';
import { corneaSpec } from '@/model/derived/effectiveLens';
import { tearThicknessAt } from '@/model/derived/contactSeat';
import { sagXY, taboToLocal } from '@/core/math/surfaces';
import { DEG2RAD } from '@/core/units';

const DARK = new THREE.Color('#000000');
const BRIGHT = new THREE.Color('#5fd0ff');

export const TearFilmView = memo(function TearFilmView({ el, eye }: { el: LensElement; eye: EyeEntity }) {
  const geometry = useMemo(() => {
    const c = el.contact!;
    const R = el.lens.diameter / 2;
    const [cx, cy] = taboToLocal(c.centration?.x ?? 0, c.centration?.y ?? 0);
    const spec = corneaSpec(eye);
    const NR = 18;
    const NA = 72;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const vals: number[] = [];
    const pts: Array<[number, number, number]> = [];
    const add = (xt: number, yt: number) => {
      const [lx, ly] = taboToLocal(xt, yt);
      const x = cx + lx;
      const y = cy + ly;
      pts.push([x, y, sagXY(spec, x, y) - 0.003]);
      vals.push(Math.max(0, tearThicknessAt(el, eye, xt, yt)));
    };
    add(0, 0);
    for (let i = 1; i <= NR; i++)
      for (let j = 0; j < NA; j++) {
        const r = (R * i) / NR;
        const a = (j / NA) * Math.PI * 2;
        add(r * Math.cos(a), r * Math.sin(a));
      }
    const vmax = Math.max(0.01, ...vals);
    pts.forEach((p, k) => {
      pos.push(...p);
      const cc = DARK.clone().lerp(BRIGHT, Math.min(1, vals[k] / vmax) * 0.9);
      col.push(cc.r, cc.g, cc.b);
    });
    const v = (i: number, j: number) => 1 + (i - 1) * NA + (j % NA);
    for (let j = 0; j < NA; j++) idx.push(0, v(1, j), v(1, j + 1));
    for (let i = 1; i < NR; i++)
      for (let j = 0; j < NA; j++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [el, eye]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const t = eye.transform;
  return (
    <group position={t.position} rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]} raycast={() => null}>
      <mesh geometry={geometry} renderOrder={4} raycast={() => null}>
        <meshBasicMaterial vertexColors transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
});
