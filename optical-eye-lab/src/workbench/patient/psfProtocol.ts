import type { Mat2 } from '@/core/math/powerMatrix';

export interface PsfSpec {
  E: Mat2;
  pupil: number;
  lambda: number;
}

export interface PsfJob {
  id: number;
  N: number;
  arcminPerPx: number;
  /** 1 (Graustufen) oder 3 (RGB) Kanäle, Werte 0…1 */
  channels: Float32Array[];
  /** PSF je Kanal (1 Eintrag = für alle) */
  psf: PsfSpec[];
  /** Bildverschiebung durch Prismen [px] */
  shift: [number, number];
}

export interface PsfResult {
  id: number;
  N: number;
  channels: Float32Array[];
  kernels: Array<{ size: number; data: Float32Array }>;
  ms: number;
}
