/**
 * Phase 4 – Refraktion & Patientensicht: Defokus, Akkommodation, PSF, Visus, Chromasie, FFT.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyScene } from '@/model/sceneFactory';
import { solveEyeForRefraction } from '@/engine/physics/eyeRefraction';
import { accommodationAmplitude, blurStrength, chromaticRefractionShift, DUOCHROME, estimateAcuity, fogMatrix, jccMatrix, kernelSpread, patientViewState, psfKernel } from '@/engine/optics/vision';
import { convolveChannel, fft1d, kernelSpectrum } from '@/engine/optics/fft';
import { createTrialLens, setTrialRx } from '@/model/instruments';
import { eigen2, effectivityMatrix, matrixToRx, rxToMatrix, type Rx } from '@/core/math/powerMatrix';
import type { LensElement, SceneDocument } from '@/model/types';

function eyeDoc(rx: Rx, age?: number): SceneDocument {
  const doc = createEmptyScene('T');
  doc.eye = { ...doc.eye, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, 'auto').anatomy };
  if (age !== undefined) doc.eye.patient = { age, accommodates: true };
  return doc;
}
const sph = (s: number): Rx => ({ sph: s, cyl: 0, axis: 180 });

describe('Defokus und Akkommodation', () => {
  it('Akkommodationsbreite nach Hofstetter', () => {
    expect(accommodationAmplitude(20)).toBeCloseTo(12.5);
    expect(accommodationAmplitude(70)).toBe(0);
  });

  it('Emmetrop in 6 m: +0,17 dpt ohne Akkommodation, 0 mit Akkommodation', () => {
    expect(patientViewState(eyeDoc(sph(0))).E.a).toBeCloseTo(1 / 6, 2);
    const s = patientViewState(eyeDoc(sph(0), 25));
    expect(s.accommodation).toBeCloseTo(1 / 6, 2);
    expect(blurStrength(s.E)).toBeLessThan(0.01);
  });

  it('Myopie kann nicht wegakkommodiert werden; Hyperopie (jung) schon', () => {
    const my = patientViewState(eyeDoc(sph(-2), 25));
    expect(my.accommodation).toBe(0);
    expect(my.E.a).toBeCloseTo(-2 + 1 / 6, 2);
    const hy = patientViewState(eyeDoc(sph(2), 25));
    expect(blurStrength(hy.E)).toBeLessThan(0.01);
    const presby = patientViewState(eyeDoc(sph(2), 65));
    expect(blurStrength(presby.E)).toBeGreaterThan(1);
  });

  it('Nebeln: +1,00 vor dem Emmetropen erzeugt myopen Defokus (Akkommodation hilft nicht)', () => {
    const s = patientViewState(eyeDoc(sph(0), 25), { extra: fogMatrix(1) });
    expect(s.accommodation).toBe(0);
    expect(s.E.a).toBeCloseTo(1 / 6 - 1, 2);
  });

  it('Messglas im HSA korrigiert (Effektivität berücksichtigt)', () => {
    const rx: Rx = { sph: -3, cyl: -1.75, axis: 134 };
    let doc = eyeDoc(rx);
    const specRx = matrixToRx(effectivityMatrix(rxToMatrix(rx), -12), 'minus', 134);
    doc = { ...doc, elements: [createTrialLens(doc, specRx, 12)] };
    const s = patientViewState(doc, { testDistanceMm: 1e9 });
    expect(blurStrength(s.E)).toBeLessThan(0.02);
    // gleiche Stärke ohne HSA-Umrechnung → kleiner Restfehler
    doc = { ...doc, elements: [setTrialRx(doc, doc.elements[0] as LensElement, rx)] };
    expect(blurStrength(patientViewState(doc, { testDistanceMm: 1e9 }).E)).toBeGreaterThan(0.05);
  });

  it('Sph/Cyl/Achse verändern den Restfehler wie erwartet', () => {
    const rx: Rx = { sph: -3, cyl: -1.75, axis: 134 };
    const doc = eyeDoc(rx);
    const t = (r: Rx) => blurStrength(patientViewState({ ...doc, elements: [createTrialLens(doc, r, 12)] }).E);
    const best = t({ sph: -3.12, cyl: -1.87, axis: 134 });
    expect(t({ sph: -2.5, cyl: -1.87, axis: 134 })).toBeGreaterThan(best);
    expect(t({ sph: -3.12, cyl: -1.0, axis: 134 })).toBeGreaterThan(best);
    expect(t({ sph: -3.12, cyl: -1.87, axis: 114 })).toBeGreaterThan(best);
  });
});

describe('Visus-Schätzung und Lochblende', () => {
  it('Visus sinkt mit Defokus und steigt mit der Lochblende', () => {
    const E = rxToMatrix(sph(-2));
    const open = estimateAcuity(E, 5);
    const pin = estimateAcuity(E, 1);
    expect(estimateAcuity(rxToMatrix(sph(0)), 4).decimal).toBeGreaterThan(0.9);
    expect(open.decimal).toBeLessThan(0.3);
    expect(pin.decimal).toBeGreaterThan(open.decimal * 2);
  });
});

describe('Punktbildfunktion', () => {
  it('Kein Defokus → kompakte PSF, Defokus → größere PSF', () => {
    const sharp = kernelSpread(psfKernel(rxToMatrix(sph(0)), 4, 0.25));
    const blur = kernelSpread(psfKernel(rxToMatrix(sph(-1)), 4, 0.25));
    expect(sharp.sx).toBeLessThan(2);
    expect(blur.sx).toBeGreaterThan(sharp.sx * 3);
  });

  it('Geometrische Unschärfe: Durchmesser = p·|D| (rad) – Radius-Moment einer gleichmäßigen Scheibe = R/2', () => {
    const arcminPerPx = 0.5;
    const k = psfKernel(rxToMatrix(sph(-1)), 4, arcminPerPx);
    const Rpx = (0.002 * 1) / ((arcminPerPx / 60) * (Math.PI / 180)); // P·|D| in px
    expect(kernelSpread(k).sx).toBeCloseTo(Rpx / 2, 0);
  });

  it('Zylinder: Unschärfe nur im Hauptschnitt der Zylinderwirkung', () => {
    // Fehler nur im Meridian 90° (vertikal): Zylinderachse 180
    const E = rxToMatrix({ sph: 0, cyl: -1.5, axis: 180 });
    const s = kernelSpread(psfKernel(E, 5, 0.5));
    expect(s.sy).toBeGreaterThan(s.sx * 4);
  });

  it('Kern ist normiert', () => {
    const k = psfKernel(rxToMatrix({ sph: -1, cyl: -1, axis: 30 }), 5, 0.5);
    expect(k.data.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('Chromatische Aberration und Kreuzzylinder', () => {
  it('Rot ist hyperoper gegenüber Grün (≈ 0,3–0,7 dpt)', () => {
    const doc = createEmptyScene('T');
    const d = chromaticRefractionShift(doc.eye.anatomy, DUOCHROME.red) - chromaticRefractionShift(doc.eye.anatomy, DUOCHROME.green);
    expect(d).toBeGreaterThan(0.25);
    expect(d).toBeLessThan(0.75);
  });

  it('Kreuzzylinder ±0,25: Hauptschnitte +0,25/−0,25, Umschlagen vertauscht', () => {
    const e = eigen2(jccMatrix(0.25, 30, false));
    expect(e.l1).toBeCloseTo(0.25);
    expect(e.l2).toBeCloseTo(-0.25);
    const a = jccMatrix(0.25, 30, false);
    const b = jccMatrix(0.25, 30, true);
    expect(a.a).toBeCloseTo(-b.a);
  });
});

describe('FFT-Faltung', () => {
  it('FFT hin und zurück ist verlustfrei', () => {
    const re = new Float64Array([1, 2, 3, 4, 0, -1, 5, 2]);
    const im = new Float64Array(8);
    const orig = [...re];
    fft1d(re, im);
    fft1d(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 9));
  });

  it('Faltung eines Punktes ergibt den Kern; Helligkeit bleibt erhalten', () => {
    const N = 64;
    const img = new Float32Array(N * N);
    img[32 * N + 32] = 1;
    const k = psfKernel(rxToMatrix(sph(-1)), 4, 1);
    const out = convolveChannel(img, kernelSpectrum(k.data, k.size, N), N);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
    const c = (k.size - 1) / 2;
    expect(out[32 * N + 32]).toBeCloseTo(k.data[c * k.size + c], 3);
  });
});
