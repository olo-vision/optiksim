/**
 * Schnelle Fourier-Transformation (radix-2, iterativ) und FFT-Faltung für Bilder (Phase 4, Patientensicht).
 * Reines TypeScript ohne Abhängigkeiten – läuft im Web Worker und in Unit-Tests.
 */

export function isPow2(n: number) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place-FFT eines komplexen Vektors (re, im) der Länge n (Zweierpotenz). inverse → skaliert mit 1/n. */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  // Bit-Umkehr
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

/** 2D-FFT (Zeilen, dann Spalten) eines N×N-Feldes. */
export function fft2d(re: Float64Array, im: Float64Array, N: number, inverse = false): void {
  const rr = new Float64Array(N);
  const ri = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    const o = y * N;
    rr.set(re.subarray(o, o + N));
    ri.set(im.subarray(o, o + N));
    fft1d(rr, ri, inverse);
    re.set(rr, o);
    im.set(ri, o);
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      rr[y] = re[y * N + x];
      ri[y] = im[y * N + x];
    }
    fft1d(rr, ri, inverse);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = rr[y];
      im[y * N + x] = ri[y];
    }
  }
}

/**
 * Transformierter Faltungskern: Kern (k×k, zentriert, Summe 1) wird zyklisch um (0,0) in ein N×N-Feld gelegt.
 */
export function kernelSpectrum(kernel: Float64Array, k: number, N: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  const c = (k - 1) / 2;
  for (let y = 0; y < k; y++)
    for (let x = 0; x < k; x++) {
      const v = kernel[y * k + x];
      if (!v) continue;
      const X = (((x - c) % N) + N) % N;
      const Y = (((y - c) % N) + N) % N;
      re[Y * N + X] += v;
    }
  fft2d(re, im, N);
  return { re, im };
}

/** Zyklische Faltung eines N×N-Kanals (0…1) mit einem vorberechneten Kernspektrum. */
export function convolveChannel(channel: Float32Array | Float64Array, spec: { re: Float64Array; im: Float64Array }, N: number, shift: [number, number] = [0, 0]): Float32Array {
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  re.set(channel);
  fft2d(re, im, N);
  const [sx, sy] = shift;
  const hasShift = sx !== 0 || sy !== 0;
  for (let v = 0; v < N; v++)
    for (let u = 0; u < N; u++) {
      const i = v * N + u;
      let kr = spec.re[i];
      let ki = spec.im[i];
      if (hasShift) {
        // Verschiebung (Prisma) als Phasenfaktor e^(−2πi(u·sx + v·sy)/N)
        const fu = u < N / 2 ? u : u - N;
        const fv = v < N / 2 ? v : v - N;
        const ph = (-2 * Math.PI * (fu * sx + fv * sy)) / N;
        const c = Math.cos(ph);
        const s = Math.sin(ph);
        const nr = kr * c - ki * s;
        ki = kr * s + ki * c;
        kr = nr;
      }
      const a = re[i];
      const b = im[i];
      re[i] = a * kr - b * ki;
      im[i] = a * ki + b * kr;
    }
  fft2d(re, im, N, true);
  const out = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = Math.min(1, Math.max(0, re[i]));
  return out;
}
