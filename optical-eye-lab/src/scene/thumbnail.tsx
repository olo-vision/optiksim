/**
 * Vorschaubild der 3D-Ansicht für die Bibliothek.
 * Rendert den aktuellen Frame und verkleinert ihn auf 320×200 (JPEG), ohne die Szene zu verändern.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

let capture: (() => string | null) | null = null;

export const THUMB_W = 320;
export const THUMB_H = 200;

/** Liefert ein JPEG-Data-URL der aktuellen Ansicht oder null (kein Viewport aktiv). */
export function captureViewportThumbnail(): string | null {
  try {
    return capture?.() ?? null;
  } catch {
    return null;
  }
}

export function ThumbnailCapture() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    capture = () => {
      gl.render(scene, camera);
      const src = gl.domElement;
      if (!src.width || !src.height) return null;
      const c = document.createElement('canvas');
      c.width = THUMB_W;
      c.height = THUMB_H;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      // „cover“: mittig beschneiden
      const s = Math.max(THUMB_W / src.width, THUMB_H / src.height);
      const w = THUMB_W / s;
      const h = THUMB_H / s;
      ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, THUMB_W, THUMB_H);
      return c.toDataURL('image/jpeg', 0.72);
    };
    return () => {
      capture = null;
    };
  }, [gl, scene, camera]);
  return null;
}
