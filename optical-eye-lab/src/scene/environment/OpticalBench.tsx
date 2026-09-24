/**
 * Optische Bank: Schiene mit Millimeterskala unter der optischen Achse,
 * Halter für Auge und Elemente. Nullpunkt der Skala = Hornhautscheitel.
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { SceneLabel } from '../labels/labels';
import type { SceneDocument } from '@/model/types';
import { elementRadius } from '@/model/derived/elementShape';
import { isContactLens } from '@/model/elementRegistry';
import { theme3d } from '../theme3d';
import { FLOOR_Y } from './LabRoom';

const RAIL_DROP = 48; // Abstand optische Achse → Schienenoberkante
const RAIL_W = 16;
const RAIL_H = 9;

export const OpticalBench = memo(function OpticalBench({ doc }: { doc: SceneDocument }) {
  const eyePos = doc.eye.transform.position;
  const railTop = eyePos[1] - RAIL_DROP;

  // Länge an die Szene anpassen (vor dem Auge = −Z)
  const minZ = useMemo(() => {
    let m = eyePos[2] - 260;
    for (const e of doc.elements) m = Math.min(m, e.transform.position[2] - 60);
    for (const l of doc.lights) m = Math.min(m, l.transform.position[2] - 30);
    return Math.floor(m / 50) * 50;
  }, [doc.elements, doc.lights, eyePos]);
  const maxZ = eyePos[2] + doc.eye.anatomy.axialLength + 50;
  const length = maxZ - minZ;
  const midZ = (maxZ + minZ) / 2;

  const ticks = useMemo(() => {
    const pts: number[] = [];
    const labels: number[] = [];
    const z0 = eyePos[2];
    const y = railTop + 0.05;
    for (let d = 0; z0 - d >= minZ + 2; d += 5) {
      const z = z0 - d;
      const major = d % 50 === 0;
      const mid = d % 10 === 0;
      const len = major ? 9 : mid ? 5.5 : 3;
      const x0 = eyePos[0] - RAIL_W / 2 + 1.5;
      pts.push(x0, y, z, x0 + len, y, z);
      if (major) labels.push(d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return { geometry: g, labels };
  }, [eyePos, railTop, minZ]);

  const holders = doc.elements
    .filter((e) => e.visible && !isContactLens(e) && e.kind !== 'magnifier')
    .map((e) => {
      const p = e.transform.position;
      const bottom = p[1] - elementRadius(e);
      const onRail = Math.abs(p[0] - eyePos[0]) < 25 && bottom > railTop + 2;
      return onRail ? { id: e.id, x: p[0], z: p[2], height: bottom - railTop } : null;
    })
    .filter(Boolean) as Array<{ id: string; x: number; z: number; height: number }>;

  const legs = [minZ + 30, maxZ - 30];
  const eyeBottom = eyePos[1] - doc.eye.anatomy.globeRadius * 0.92;
  const eyeHolderZ = eyePos[2] + doc.eye.anatomy.axialLength * 0.55;

  return (
    <group raycast={() => null}>
      {/* Schiene */}
      <mesh position={[eyePos[0], railTop - RAIL_H / 2, midZ]} castShadow receiveShadow>
        <boxGeometry args={[RAIL_W, RAIL_H, length]} />
        <meshStandardMaterial color={theme3d.bench} metalness={0.7} roughness={0.38} />
      </mesh>
      <mesh position={[eyePos[0], railTop + 0.01, midZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[RAIL_W - 2, length - 2]} />
        <meshStandardMaterial color={theme3d.benchTop} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Skala */}
      <lineSegments geometry={ticks.geometry}>
        <lineBasicMaterial color={theme3d.tick} />
      </lineSegments>
      {ticks.labels.map((d) => (
        <SceneLabel key={d} position={[eyePos[0] + RAIL_W / 2 + 5, railTop, eyePos[2] - d]} text={d === 0 ? '0 mm' : `${d}`} variant="bench" />
      ))}
      {/* Füße */}
      {legs.map((z, i) => (
        <group key={i}>
          <mesh position={[eyePos[0], (railTop - RAIL_H + FLOOR_Y) / 2, z]} castShadow>
            <cylinderGeometry args={[4, 4, railTop - RAIL_H - FLOOR_Y, 24]} />
            <meshStandardMaterial color={theme3d.metal} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[eyePos[0], FLOOR_Y + 8, z]} castShadow>
            <cylinderGeometry args={[26, 30, 4, 48]} />
            <meshStandardMaterial color="#15181d" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* Augenhalter */}
      {doc.eye.visible && eyeBottom > railTop && (
        <group position={[eyePos[0], 0, eyeHolderZ]}>
          <mesh position={[0, (railTop + eyeBottom) / 2, 0]} castShadow>
            <cylinderGeometry args={[1.6, 1.6, eyeBottom - railTop, 20]} />
            <meshStandardMaterial color={theme3d.metal} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, railTop + 2.5, 0]} castShadow>
            <boxGeometry args={[RAIL_W + 2, 5, 14]} />
            <meshStandardMaterial color="#14171b" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      )}
      {/* Reiter für Elemente */}
      {holders.map((h) => (
        <group key={h.id} position={[h.x, 0, h.z]}>
          <mesh position={[0, railTop + h.height / 2, 0]} castShadow>
            <cylinderGeometry args={[1.2, 1.2, h.height, 16]} />
            <meshStandardMaterial color={theme3d.metal} metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, railTop + 2.5, 0]} castShadow>
            <boxGeometry args={[RAIL_W + 2, 5, 10]} />
            <meshStandardMaterial color="#14171b" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
});
