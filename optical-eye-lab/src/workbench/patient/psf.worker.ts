/**
 * Web Worker der Patientensicht: PSF-Kerne erzeugen und Bildkanäle per FFT falten (Phase 4).
 * Hält den Haupt-Thread (3D-Ansicht, Bedienung) frei.
 */
import { psfKernel } from '@/engine/optics/vision';
import { convolveChannel, kernelSpectrum } from '@/engine/optics/fft';
import type { PsfJob, PsfResult } from './psfProtocol';

self.onmessage = (ev: MessageEvent<PsfJob>) => {
  const job = ev.data;
  const t0 = performance.now();
  const out: Float32Array[] = [];
  const cache = new Map<string, ReturnType<typeof kernelSpectrum>>();
  const kernels: PsfResult['kernels'] = [];
  job.channels.forEach((ch, i) => {
    const spec = job.psf[i] ?? job.psf[0];
    const key = JSON.stringify(spec);
    let s = cache.get(key);
    if (!s) {
      const k = psfKernel(spec.E, spec.pupil, job.arcminPerPx, spec.lambda, job.N - 1);
      s = kernelSpectrum(k.data, k.size, job.N);
      cache.set(key, s);
      kernels.push({ size: k.size, data: Float32Array.from(k.data) });
    }
    out.push(convolveChannel(ch, s, job.N, job.shift));
  });
  const res: PsfResult = { id: job.id, N: job.N, channels: out, kernels, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(res, out.map((c) => c.buffer));
};
