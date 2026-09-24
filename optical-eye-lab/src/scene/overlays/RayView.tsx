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
  const astig = focus?.astigmatism;
  return (
    <group raycast={() => null}>
      {segments.map(([color, pts]) =>
        pts.length >= 2 ? <Line key={color} points={pts} segments color={color} lineWidth={1.3} toneMapped={false} /> : null,
      )}
      {astig &&
        astig.lines.map((l, k) => {
          const half = l.lengthMm / 2;
          const a: [number, number, number] = [l.pointWorld[0] - l.lineDirWorld[0] * half, l.pointWorld[1] - l.lineDirWorld[1] * half, l.pointWorld[2] - l.lineDirWorld[2] * half];
          const b: [number, number, number] = [l.pointWorld[0] + l.lineDirWorld[0] * half, l.pointWorld[1] + l.lineDirWorld[1] * half, l.pointWorld[2] + l.lineDirWorld[2] * half];
          const color = k === 0 ? theme3d.focus : '#7fd8ff';
          return (
            <group key={k}>
              <Line points={[a, b]} color={color} lineWidth={3} toneMapped={false} depthTest={false} renderOrder={40} />
              <group position={l.pointWorld}>
                <SceneLabel
                  position={[0, k === 0 ? 4.5 : -4.5, 0]}
                  variant="focus"
                  text={`Brennlinie ${k === 0 ? '1' : '2'} (Meridian ${formatNumber(l.meridianDeg, 0)}°): ${formatNumber(Math.abs(l.defocusMm), 2)} mm ${l.defocusMm < 0 ? 'vor' : 'hinter'} Retina`}
                />
              </group>
            </group>
          );
        })}
      {astig && (
        <mesh position={astig.leastConfusionWorld}>
          <sphereGeometry args={[0.18, 12, 8]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} depthTest={false} />
        </mesh>
      )}
      {focus && !astig && (
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
