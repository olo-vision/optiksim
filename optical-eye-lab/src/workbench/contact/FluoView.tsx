/**
 * Fluoreszeinbild (Phase 4): Aufsicht auf Hornhaut und Kontaktlinse unter Kobaltblau-Licht.
 * Helligkeit je Pixel = Fluoreszenz der lokalen Tränenfilmdicke (fluorescein.ts) – keine frei gewählte Farbskala.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EyeEntity, LensElement } from "@/model/types";
import { tearThicknessAt } from "@/model/derived/contactSeat";
import {
  fluoIntensity,
  probeFluorescein,
  type FluoProbe,
} from "@/engine/optics/fluorescein";
import { formatNumber } from "@/core/units";

const GRID = 200;
const HALF_MM = 7;

export function FluoView({
  el,
  eye,
  yellowFilter,
  showZones,
  onProbe,
}: {
  el: LensElement;
  eye: EyeEntity;
  yellowFilter: boolean;
  showZones: boolean;
  onProbe?: (p: FluoProbe | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<FluoProbe | null>(null);
  const c = el.contact!;
  const cx = c.centration?.x ?? 0;
  const cy = c.centration?.y ?? 0;
  const R = el.lens.diameter / 2;
  const cornea = eye.anatomy.corneaDiameter / 2;

  // Dickenfeld nur bei Geometrieänderung neu berechnen
  const field = useMemo(() => {
    const t = new Float32Array(GRID * GRID).fill(NaN);
    for (let j = 0; j < GRID; j++) {
      const y = HALF_MM - ((j + 0.5) / GRID) * 2 * HALF_MM;
      for (let i = 0; i < GRID; i++) {
        const x = -HALF_MM + ((i + 0.5) / GRID) * 2 * HALF_MM;
        const dx = x - cx;
        const dy = y - cy;
        if (Math.hypot(dx, dy) <= R)
          t[j * GRID + i] = tearThicknessAt(el, eye, dx, dy);
      }
    }
    return t;
  }, [el, eye, cx, cy, R]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(GRID, GRID);
    for (let j = 0; j < GRID; j++) {
      const y = HALF_MM - ((j + 0.5) / GRID) * 2 * HALF_MM;
      for (let i = 0; i < GRID; i++) {
        const x = -HALF_MM + ((i + 0.5) / GRID) * 2 * HALF_MM;
        const r = Math.hypot(x, y);
        const dLens = Math.hypot(x - cx, y - cy);
        const t = field[j * GRID + i];
        // Hintergrund: Kobaltblau auf Iris/Sklera; Gelbfilter unterdrückt Blau
        let base: [number, number, number] =
          r <= cornea ? [10, 18, 70] : [30, 40, 120];
        if (yellowFilter) base = r <= cornea ? [6, 8, 6] : [18, 20, 14];
        let I = 0;
        if (!Number.isNaN(t)) I = fluoIntensity(t);
        else if (r <= cornea) {
          // freier Tränenfilm (≈ 5 µm) + Tränenmeniskus am Linsenrand
          const edgeDist = dLens - R;
          const meniscus =
            edgeDist >= 0 && edgeDist < 0.35
              ? Math.exp(-edgeDist / 0.12) * 0.75
              : 0;
          I = Math.max(fluoIntensity(0.005), meniscus);
        }
        const g = yellowFilter ? [120, 255, 60] : [110, 255, 90];
        const k = (j * GRID + i) * 4;
        img.data[k] = Math.min(255, base[0] + g[0] * I);
        img.data[k + 1] = Math.min(255, base[1] + g[1] * I);
        img.data[k + 2] = Math.min(255, base[2] * (1 - 0.7 * I) + g[2] * I);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [field, yellowFilter, cx, cy, R, cornea]);

  const toPct = (mm: number) => ((mm + HALF_MM) / (2 * HALF_MM)) * 100;
  const oz = (c.opticZoneDiameter ?? 0) / 2;
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = -HALF_MM + ((e.clientX - rect.left) / rect.width) * 2 * HALF_MM;
    const y = HALF_MM - ((e.clientY - rect.top) / rect.height) * 2 * HALF_MM;
    const p = probeFluorescein(el, eye, x - cx, y - cy);
    setProbe(p);
    onProbe?.(p);
  };

  return (
    <div className="fluo-wrap">
      <div
        className="fluo-view"
        onPointerDown={pick}
        data-testid="fluo-view"
        role="img"
        aria-label="Fluoreszeinbild – klicken für lokale Werte"
      >
        <canvas ref={canvas} width={GRID} height={GRID} />
        <svg viewBox="0 0 100 100" className="fluo-view__overlay" aria-hidden>
          <circle
            cx={toPct(cx)}
            cy={100 - toPct(cy)}
            r={(R / (2 * HALF_MM)) * 100}
            className="fluo-view__lens"
          />
          {showZones && oz > 0 && (
            <circle
              cx={toPct(cx)}
              cy={100 - toPct(cy)}
              r={(oz / (2 * HALF_MM)) * 100}
              className="fluo-view__oz"
            />
          )}
          {probe && (
            <circle
              cx={toPct(probe.x + cx)}
              cy={100 - toPct(probe.y + cy)}
              r={1.4}
              className="fluo-view__probe"
            />
          )}
        </svg>
      </div>
      {probe && (
        <div className="fluo-probe" data-testid="fluo-probe">
          <div className="fluo-probe__sec">Messwert (Geometrie)</div>
          <div>
            {probe.zoneLabel} · r = {formatNumber(probe.r, 2)} mm
          </div>
          <div>
            Tränenfilm:{" "}
            <strong>
              {Number.isFinite(probe.thickness)
                ? `${Math.round(probe.thickness * 1000)} µm`
                : "—"}
            </strong>
          </div>
          <div className="fluo-probe__cls">{probe.classLabel}</div>
          <div className="fluo-probe__sec">Interpretation (didaktisch)</div>
          <div>{probe.interpretation}</div>
          <button
            type="button"
            className="fluo-probe__close"
            onClick={() => setProbe(null)}
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
