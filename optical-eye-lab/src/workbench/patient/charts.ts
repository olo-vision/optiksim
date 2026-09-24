/**
 * Sehzeichen und Testbilder für die Patientensicht (Phase 4).
 * Alle Größen in Winkelminuten: ein Sehzeichen für Visus V ist 5/V′ hoch, Strichbreite 1/V′ (DIN EN ISO 8596).
 * Das Bild zeigt die Sicht des Patienten (links = links des Patienten).
 */
import type { RefractionSetup } from '@/model/types';

export type ChartKind = RefractionSetup['chart'];

export const CHART_LABEL: Record<ChartKind, string> = {
  landolt: 'Landoltringe',
  letters: 'Buchstaben',
  numbers: 'Zahlen',
  fan: 'Astigmatismusfächer',
  duochrome: 'Rot-Grün-Test',
  scene: 'Alltagsszene',
};

export interface ChartRow {
  visus: number;
  /** Zeilenmitte [px] */
  y: number;
  height: number;
}

export interface ChartLayout {
  rows: ChartRow[];
  /** Bildfeld [Winkelminuten] (Kantenlänge) */
  fieldArcmin: number;
}

const ROWS = [0.2, 0.32, 0.5, 0.63, 0.8, 1.0, 1.25, 1.6];
const LETTERS = ['C', 'D', 'H', 'K', 'N', 'O', 'R', 'S', 'V', 'Z'];
const NUMBERS = ['2', '3', '4', '5', '6', '7', '8', '9'];

/** Pseudozufall pro Zeile, damit sich das Testbild nicht bei jeder Berechnung ändert */
function seeded(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function landolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, gapDir: number) {
  const s = size / 5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-gapDir * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, 2.5 * s, 0, Math.PI * 2);
  ctx.arc(0, 0, 1.5 * s, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(1.2 * s, -0.5 * s, 1.6 * s, s);
  ctx.restore();
}

export function drawChart(ctx: CanvasRenderingContext2D, N: number, arcminPerPx: number, kind: ChartKind): ChartLayout {
  const fieldArcmin = N * arcminPerPx;
  const px = (arcmin: number) => arcmin / arcminPerPx;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, N, N);
  ctx.fillStyle = '#111111';
  ctx.strokeStyle = '#111111';
  const rows: ChartRow[] = [];

  if (kind === 'fan') {
    const c = N / 2;
    const R = N * 0.42;
    ctx.lineWidth = Math.max(1, px(1.6));
    for (let a = 0; a < 180; a += 15) {
      const t = (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(c - Math.cos(t) * R * 0.18, c + Math.sin(t) * R * 0.18);
      ctx.lineTo(c - Math.cos(t) * R, c + Math.sin(t) * R);
      ctx.moveTo(c + Math.cos(t) * R * 0.18, c - Math.sin(t) * R * 0.18);
      ctx.lineTo(c + Math.cos(t) * R, c - Math.sin(t) * R);
      ctx.stroke();
    }
    ctx.restore();
    return { rows, fieldArcmin };
  }

  if (kind === 'scene') {
    drawScene(ctx, N);
    ctx.restore();
    return { rows, fieldArcmin };
  }

  if (kind === 'duochrome') {
    ctx.fillStyle = '#d42a2a';
    ctx.fillRect(0, 0, N / 2, N);
    ctx.fillStyle = '#1b9a3c';
    ctx.fillRect(N / 2, 0, N / 2, N);
    ctx.fillStyle = '#0a0a0a';
    const sizes = [0.4, 0.63, 1.0];
    let y = N * 0.2;
    sizes.forEach((v, i) => {
      const h = px(5 / v);
      for (let side = 0; side < 2; side++) {
        const x0 = side === 0 ? N * 0.25 : N * 0.75;
        for (let k = -1; k <= 1; k++) landolt(ctx, x0 + k * h * 1.6, y, h, [0, 90, 180, 270][(i + k + 3 + side) % 4]);
      }
      rows.push({ visus: v, y, height: h });
      y += h * 1.9 + px(4);
    });
    ctx.restore();
    return { rows, fieldArcmin };
  }

  // Zeilen-Tafeln
  let y = px(6);
  ROWS.forEach((v, ri) => {
    const h = px(5 / v);
    if (y + h > N - px(2)) return;
    const cy = y + h / 2;
    const count = Math.max(1, Math.min(5, Math.floor((fieldArcmin * 0.9) / (2 * (5 / v)))));
    const pitch = h * 2;
    const x0 = N / 2 - ((count - 1) * pitch) / 2;
    for (let k = 0; k < count; k++) {
      const r = seeded(ri * 7 + k);
      const cx = x0 + k * pitch;
      if (kind === 'landolt') landolt(ctx, cx, cy, h, [0, 45, 90, 135, 180, 225, 270, 315][Math.floor(r * 8)]);
      else {
        const set = kind === 'letters' ? LETTERS : NUMBERS;
        ctx.font = `700 ${h / 0.72}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(set[Math.floor(r * set.length)], cx, cy + h / 2);
      }
    }
    rows.push({ visus: v, y: cy, height: h });
    y += h + Math.max(h * 0.8, px(4));
  });
  ctx.restore();
  return { rows, fieldArcmin };
}

/** Einfache, generische Alltagsszene (Himmel, Haus, Baum, Schild) – prozedural gezeichnet. */
function drawScene(ctx: CanvasRenderingContext2D, N: number) {
  const g = ctx.createLinearGradient(0, 0, 0, N * 0.6);
  g.addColorStop(0, '#8ec5ef');
  g.addColorStop(1, '#dff0fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  ctx.fillStyle = '#8fa3b0';
  ctx.beginPath();
  ctx.moveTo(0, N * 0.55);
  ctx.lineTo(N * 0.2, N * 0.38);
  ctx.lineTo(N * 0.38, N * 0.5);
  ctx.lineTo(N * 0.6, N * 0.34);
  ctx.lineTo(N, N * 0.52);
  ctx.lineTo(N, N);
  ctx.lineTo(0, N);
  ctx.fill();
  ctx.fillStyle = '#6f9d52';
  ctx.fillRect(0, N * 0.6, N, N * 0.4);
  ctx.fillStyle = '#5b5f66';
  ctx.beginPath();
  ctx.moveTo(N * 0.42, N);
  ctx.lineTo(N * 0.49, N * 0.6);
  ctx.lineTo(N * 0.53, N * 0.6);
  ctx.lineTo(N * 0.66, N);
  ctx.fill();
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = N * 0.006;
  ctx.setLineDash([N * 0.02, N * 0.02]);
  ctx.beginPath();
  ctx.moveTo(N * 0.51, N * 0.62);
  ctx.lineTo(N * 0.55, N);
  ctx.stroke();
  ctx.setLineDash([]);
  // Haus
  ctx.fillStyle = '#e9dcc6';
  ctx.fillRect(N * 0.08, N * 0.48, N * 0.24, N * 0.2);
  ctx.fillStyle = '#9c3b2e';
  ctx.beginPath();
  ctx.moveTo(N * 0.06, N * 0.49);
  ctx.lineTo(N * 0.2, N * 0.38);
  ctx.lineTo(N * 0.34, N * 0.49);
  ctx.fill();
  ctx.fillStyle = '#3d5a73';
  for (let i = 0; i < 3; i++) ctx.fillRect(N * (0.1 + i * 0.075), N * 0.52, N * 0.04, N * 0.05);
  ctx.fillStyle = '#5a3d2b';
  ctx.fillRect(N * 0.18, N * 0.6, N * 0.04, N * 0.08);
  // Baum
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(N * 0.78, N * 0.5, N * 0.025, N * 0.16);
  ctx.fillStyle = '#2f6b33';
  ctx.beginPath();
  ctx.arc(N * 0.79, N * 0.46, N * 0.075, 0, Math.PI * 2);
  ctx.fill();
  // Schild mit Schrift (feine Details)
  ctx.fillStyle = '#555';
  ctx.fillRect(N * 0.645, N * 0.5, N * 0.008, N * 0.14);
  ctx.fillStyle = '#1e5aa8';
  ctx.fillRect(N * 0.57, N * 0.44, N * 0.16, N * 0.07);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${N * 0.028}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Bahnhof 2 km', N * 0.65, N * 0.485);
}
