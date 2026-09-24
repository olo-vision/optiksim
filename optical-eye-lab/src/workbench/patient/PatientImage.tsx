/**
 * Patientensicht: Testbild, gefaltet mit der physikalisch abgeleiteten Punktbildfunktion (Phase 4).
 * Die Faltung läuft im Web Worker; neu gerechnet wird nur bei geänderten Parametern.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Mat2 } from '@/core/math/powerMatrix';
import { drawChart, type ChartKind, type ChartLayout } from './charts';
import type { PsfJob, PsfResult, PsfSpec } from './psfProtocol';
import { LAMBDA_D } from '@/engine/optics/dispersion';
import { formatVisus } from '@/engine/optics/vision';

export const IMAGE_N = 512;
/** Bildfeld 128′ → 4 px je Winkelminute */
export const FIELD_ARCMIN = 128;

let worker: Worker | null = null;
let jobId = 0;
const pending = new Map<number, (r: PsfResult) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  worker = new Worker(new URL('./psf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<PsfResult>) => {
    const cb = pending.get(ev.data.id);
    pending.delete(ev.data.id);
    cb?.(ev.data);
  };
  return worker;
}

const toLin = (v: number) => Math.pow(v / 255, 2.2);
const toSrgb = (v: number) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));

/** Chart zeichnen und in lineare Kanäle zerlegen (Graustufen oder RGB) */
function chartChannels(kind: ChartKind, rgb: boolean): { channels: Float32Array[]; layout: ChartLayout } {
  const c = document.createElement('canvas');
  c.width = IMAGE_N;
  c.height = IMAGE_N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const layout = drawChart(ctx, IMAGE_N, FIELD_ARCMIN / IMAGE_N, kind);
  const img = ctx.getImageData(0, 0, IMAGE_N, IMAGE_N).data;
  const n = IMAGE_N * IMAGE_N;
  if (!rgb) {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = toLin(0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2]);
    return { channels: [g], layout };
  }
  const r = new Float32Array(n);
  const gg = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = toLin(img[i * 4]);
    gg[i] = toLin(img[i * 4 + 1]);
    b[i] = toLin(img[i * 4 + 2]);
  }
  return { channels: [r, gg, b], layout };
}

export interface PatientImageProps {
  chart: ChartKind;
  /** Defokus je Kanal: 1 Eintrag (Graustufen) oder 3 (R, G, B) */
  psf: PsfSpec[];
  /** Prismatische Verschiebung [Winkelminuten] im Bild (x rechts, y unten) */
  shiftArcmin?: [number, number];
  label?: string;
  sublabel?: string;
  visus?: number;
  showRows?: boolean;
  /** Pinhole/Helligkeit: Bild abdunkeln (Lochblende lässt weniger Licht durch) */
  dim?: number;
  className?: string;
  onStats?: (s: { ms: number; kernel?: { size: number; data: Float32Array } }) => void;
}

const rgbCharts: ChartKind[] = ['duochrome', 'scene'];

export const PatientImage = memo(function PatientImage({ chart, psf, shiftArcmin = [0, 0], label, sublabel, visus, showRows = true, dim = 1, className, onStats }: PatientImageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<ChartLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const rgb = rgbCharts.includes(chart) || psf.length > 1;
  const source = useMemo(() => (typeof document === 'undefined' ? null : chartChannels(chart, rgb)), [chart, rgb]);
  const key = JSON.stringify({ chart, psf: psf.map((p) => ({ E: roundM(p.E), pupil: +p.pupil.toFixed(2), l: p.lambda })), s: shiftArcmin.map((v) => +v.toFixed(2)), rgb });

  useEffect(() => {
    if (!source) return;
    setLayout(source.layout);
    const w = getWorker();
    const draw = (chs: Float32Array[]) => {
      const cv = canvas.current;
      if (!cv) return;
      const ctx = cv.getContext('2d')!;
      const img = ctx.createImageData(IMAGE_N, IMAGE_N);
      const n = IMAGE_N * IMAGE_N;
      for (let i = 0; i < n; i++) {
        const r = chs.length === 3 ? chs[0][i] : chs[0][i];
        const g = chs.length === 3 ? chs[1][i] : chs[0][i];
        const b = chs.length === 3 ? chs[2][i] : chs[0][i];
        img.data[i * 4] = toSrgb(r * dim);
        img.data[i * 4 + 1] = toSrgb(g * dim);
        img.data[i * 4 + 2] = toSrgb(b * dim);
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    if (!w) {
      draw(source.channels);
      return;
    }
    const id = ++jobId;
    latest.current = id;
    setBusy(true);
    const timer = window.setTimeout(() => {
      const specs = rgb && psf.length === 1 ? [psf[0], psf[0], psf[0]] : psf;
      const job: PsfJob = {
        id,
        N: IMAGE_N,
        arcminPerPx: FIELD_ARCMIN / IMAGE_N,
        channels: source.channels.map((c) => c.slice()),
        psf: specs,
        shift: [shiftArcmin[0] / (FIELD_ARCMIN / IMAGE_N), shiftArcmin[1] / (FIELD_ARCMIN / IMAGE_N)],
      };
      pending.set(id, (res) => {
        if (id !== latest.current) return; // veraltet (neuere Anfrage unterwegs)
        draw(res.channels);
        setBusy(false);
        onStats?.({ ms: res.ms, kernel: res.kernels[rgb ? 1 : 0] ?? res.kernels[0] });
      });
      w.postMessage(job, job.channels.map((c) => c.buffer));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [key, source, dim]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className={`patient-image${busy ? ' is-busy' : ''}${className ? ` ${className}` : ''}`}>
      <div className="patient-image__frame">
        <canvas ref={canvas} width={IMAGE_N} height={IMAGE_N} aria-label={label ?? 'Patientensicht'} />
        {showRows && layout && layout.rows.length > 0 && (
          <div className="patient-image__rows" aria-hidden>
            {layout.rows.map((r) => (
              <span key={r.visus} style={{ top: `${(r.y / IMAGE_N) * 100}%` }} className={visus !== undefined && visus + 1e-6 >= r.visus ? 'is-readable' : ''}>
                {formatVisus(r.visus)}
              </span>
            ))}
          </div>
        )}
        {busy && <span className="patient-image__busy" />}
      </div>
      {(label || sublabel) && (
        <figcaption>
          {label && <strong>{label}</strong>}
          {sublabel && <span>{sublabel}</span>}
        </figcaption>
      )}
    </figure>
  );
});

const roundM = (m: Mat2) => ({ a: +m.a.toFixed(3), b: +m.b.toFixed(3), c: +m.c.toFixed(3) });

export const REFERENCE_LAMBDA = LAMBDA_D;
