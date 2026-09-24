/**
 * Darstellung des berechneten Strahlengangs (Vorschau-Modul).
 * Berechnung in engine/raytracing; hier nur Visualisierung.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { SceneLabel } from '../labels/labels';
import type { SceneDocument } from '@/model/types';
import { traceScene, type TraceResult } from '@/engine/raytracing';
import { formatNumber } from '@/core/units';
import { useAppStore } from '@/state/store';
import { useTraceResultStore } from './traceResultStore';
import { theme3d } from '../theme3d';

export function RayView({ doc }: { doc: SceneDocument }) {
  const live = useAppStore((s) => s.simulationLive);
  const frozen = useRef<TraceResult | null>(null);
  const setResult = useTraceResultStore((s) => s.setResult);

  const result = useMemo(() => {
    if (!live && frozen.current) return frozen.current;
    const r = traceScene(doc);
    frozen.current = r;
    return r;
  }, [doc, live]);

  useEffect(() => {
    setResult(result);
    return () => setResult(null);
  }, [result, setResult]);

  const segments = useMemo(() => {
    const byColor = new Map<string, Array<[number, number, number]>>();
    for (const p of result.paths) {
      const arr = byColor.get(p.color) ?? [];
      for (let i = 0; i < p.points.length - 1; i++) arr.push(p.points[i], p.points[i + 1]);
      byColor.set(p.color, arr);
    }
    return [...byColor.entries()];
  }, [result]);

  const focus = result.focus;
  return (
    <group raycast={() => null}>
      {segments.map(([color, pts]) =>
        pts.length >= 2 ? <Line key={color} points={pts} segments color={color} lineWidth={1.3} toneMapped={false} /> : null,
      )}
      {focus && (
        <group position={focus.paraxialFocusWorld}>
          <mesh>
            <sphereGeometry args={[0.28, 16, 12]} />
            <meshBasicMaterial color={theme3d.focus} toneMapped={false} depthTest={false} />
          </mesh>
          <SceneLabel
            position={[0, 3.2, 0]}
            variant="focus"
            text={
              Math.abs(focus.paraxialDefocusMm) < 0.05
                ? 'Fokus auf der Retina'
                : `Fokus ${formatNumber(Math.abs(focus.paraxialDefocusMm), 2)} mm ${focus.paraxialDefocusMm < 0 ? 'vor' : 'hinter'} der Retina`
            }
          />
        </group>
      )}
    </group>
  );
}
