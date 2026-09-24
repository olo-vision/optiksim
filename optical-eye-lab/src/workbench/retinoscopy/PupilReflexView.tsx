/**
 * Blick durch das Skiaskop-Guckloch (Phase 4): Gesicht/Iris mit Lichtband und Fundusreflex in der Pupille.
 * Jeder Pixel wird aus dem Reflexmodell (retinoscopy.ts) berechnet – keine vorgefertigte Animation.
 * Ziehen mit der Maus schwenkt das Skiaskop (Verschiebung senkrecht zum Strich).
 */
import { useEffect, useRef } from 'react';
import { faceBandAt, reflexAt, type ReflexModel } from '@/engine/optics/retinoscopy';

const SIZE = 280;
/** Bildausschnitt ±8 mm */
const HALF_MM = 8;

export function PupilReflexView({
  model,
  irisColor,
  irisRadius = 5.9,
  onSweep,
  showGuides,
}: {
  model: ReflexModel;
  irisColor: string;
  irisRadius?: number;
  onSweep?: (deltaMm: number) => void;
  showGuides?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const iris = hexToRgb(irisColor);
    const pr = model.pupilRadius;
    for (let j = 0; j < SIZE; j++) {
      const y = HALF_MM - ((j + 0.5) / SIZE) * 2 * HALF_MM;
      for (let i = 0; i < SIZE; i++) {
        const x = -HALF_MM + ((i + 0.5) / SIZE) * 2 * HALF_MM;
        const r = Math.hypot(x, y);
        let R: number;
        let G: number;
        let B: number;
        if (r <= pr) {
          // Pupille: dunkel + Fundusreflex (orange-rot)
          // Darstellung: Wahrnehmung ~ Leuchtdichte^0,5 (sonst wirken schwache Reflexe unsichtbar)
          const v = Math.sqrt(reflexAt(model, x, y, 0.07));
          R = 10 + 245 * v;
          G = 6 + 120 * v;
          B = 5 + 55 * v;
        } else {
          // Iris bzw. Haut, beleuchtet vom Lichtband
          const band = faceBandAt(model, x, y, 0.35);
          const base = r <= irisRadius ? [iris[0] * 0.35, iris[1] * 0.35, iris[2] * 0.35] : r <= irisRadius + 0.35 ? [30, 22, 20] : [58, 42, 36];
          const lit = 0.18 + 0.82 * band;
          R = base[0] * lit + 90 * band;
          G = base[1] * lit + 70 * band;
          B = base[2] * lit + 45 * band;
        }
        const k = (j * SIZE + i) * 4;
        img.data[k] = Math.min(255, R);
        img.data[k + 1] = Math.min(255, G);
        img.data[k + 2] = Math.min(255, B);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (showGuides) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      // Richtung des Reflexbandes
      const a = (model.bandAxis * Math.PI) / 180;
      const c = SIZE / 2;
      const L = (pr / (2 * HALF_MM)) * SIZE;
      ctx.beginPath();
      ctx.moveTo(c - Math.cos(a) * L, c + Math.sin(a) * L);
      ctx.lineTo(c + Math.cos(a) * L, c - Math.sin(a) * L);
      ctx.stroke();
      ctx.restore();
    }
  }, [model, irisColor, irisRadius, showGuides]);

  return (
    <canvas
      ref={canvas}
      className="reflex-view"
      width={SIZE}
      height={SIZE}
      aria-label="Blick durch das Skiaskop: Pupille mit Fundusreflex"
      data-testid="reflex-view"
      onPointerDown={(e) => {
        if (!onSweep) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!drag.current || !onSweep) return;
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const mmPerPx = (2 * HALF_MM) / rect.width;
        const dx = (e.clientX - drag.current.x) * mmPerPx;
        const dy = -(e.clientY - drag.current.y) * mmPerPx;
        drag.current = { x: e.clientX, y: e.clientY };
        onSweep(dx * model.m[0] + dy * model.m[1]);
      }}
      onPointerUp={() => (drag.current = null)}
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [90, 110, 140];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
