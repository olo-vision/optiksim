import { describe, expect, it } from 'vitest';
import { DEFAULT_EYE_ANATOMY } from '@/model/derived/eyeGeometry';
import { eyeRefractionState, solveEyeForRefraction, axialLengthForRefraction } from '@/engine/physics/eyeRefraction';
import { designLensForRx, lensRx, lensOptics } from '@/engine/physics/lensOptics';
import { tearLens } from '@/engine/physics/contactLens';
import { computeCorrection } from '@/engine/physics/correction';
import { createElement, createEmptyScene, placeAtVertexDistance } from '@/model/sceneFactory';
import { applyConstraints } from '@/model/derived/contactSeat';
import { effectivePower } from '@/engine/physics/formulas';
import { rxEquals } from '@/core/math/powerMatrix';
import type { LensElement, SceneDocument } from '@/model/types';

const close = (a: number, b: number, d = 3) => expect(a).toBeCloseTo(b, d);

function eyeDoc(rx: { sph: number; cyl: number; axis: number }, mode: 'auto' | 'axial' | 'refractive' = 'axial') {
  const doc = createEmptyScene();
  doc.eye = { ...doc.eye, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, mode).anatomy };
  return doc;
}

describe('Fehlsichtigkeit des Auges', () => {
  it('Le Grand ist emmetrop (±0,1 dpt)', () => {
    expect(Math.abs(eyeRefractionState(DEFAULT_EYE_ANATOMY).rx.sph)).toBeLessThan(0.1);
  });
  it('Achsenametropie −3,00: Baulänge länger, Refraktion exakt', () => {
    const r = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: -3, cyl: 0, axis: 180 }, 'axial');
    expect(r.anatomy.axialLength).toBeGreaterThan(DEFAULT_EYE_ANATOMY.axialLength + 0.9);
    close(eyeRefractionState(r.anatomy).rx.sph, -3);
    expect(r.anatomy.corneaFrontRadius).toBe(7.8);
  });
  it('Achsenametropie +3,00 (Hyperopie): Auge kürzer', () => {
    const r = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: 3, cyl: 0, axis: 180 }, 'axial');
    expect(r.anatomy.axialLength).toBeLessThan(DEFAULT_EYE_ANATOMY.axialLength - 0.9);
    close(eyeRefractionState(r.anatomy).rx.sph, 3);
  });
  it('Baulängenänderung ≈ 0,3–0,4 mm/dpt', () => {
    const d = axialLengthForRefraction(DEFAULT_EYE_ANATOMY, -1) - axialLengthForRefraction(DEFAULT_EYE_ANATOMY, 0);
    expect(d).toBeGreaterThan(0.3); expect(d).toBeLessThan(0.42);
  });
  it('Brechungsametropie −3,00: Baulänge bleibt, Hornhaut steiler', () => {
    const r = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: -3, cyl: 0, axis: 180 }, 'refractive');
    close(r.anatomy.axialLength, DEFAULT_EYE_ANATOMY.axialLength, 6);
    expect(r.anatomy.corneaFrontRadius).toBeLessThan(7.8);
    close(eyeRefractionState(r.anatomy).rx.sph, -3);
  });
  it('Astigmatismus −3,00/−1,75 A134 (beide Modelle)', () => {
    for (const mode of ['axial', 'refractive', 'auto'] as const) {
      const r = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: -3, cyl: -1.75, axis: 134 }, mode);
      const s = eyeRefractionState(r.anatomy);
      expect(rxEquals(s.rx, { sph: -3, cyl: -1.75, axis: 134 }, 0.002)).toBe(true);
      expect(s.astigmatic).toBe(true);
      expect(s.sturmIntervalMm).toBeGreaterThan(0.4);
    }
  });
  it('Pluszylinder-Eingabe ergibt dasselbe Auge', () => {
    const a = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: -3, cyl: -1.75, axis: 134 }, 'refractive').anatomy;
    const b = solveEyeForRefraction(DEFAULT_EYE_ANATOMY, { sph: -4.75, cyl: 1.75, axis: 44 }, 'refractive').anatomy;
    expect(rxEquals(eyeRefractionState(a).rx, eyeRefractionState(b).rx, 0.002)).toBe(true);
  });
});

describe('Linsen aus Rezept', () => {
  const doc = createEmptyScene();
  it('Brillenglas −3,00 sph', () => {
    const el = createElement('spectacle-lens', doc) as LensElement;
    const d = designLensForRx(el, { sph: -3, cyl: 0, axis: 180 });
    expect(d.ok).toBe(true);
    close(lensRx({ ...el, lens: d.lens }).sph, -3, 6);
    expect(d.lens.backRadius2).toBeUndefined();
  });
  it('Brillenglas −3,00/−1,75 A134: innentorisch, exakt', () => {
    const el = createElement('spectacle-lens', doc) as LensElement;
    const d = designLensForRx(el, { sph: -3, cyl: -1.75, axis: 134 });
    const rx = lensRx({ ...el, lens: d.lens });
    expect(rxEquals(rx, { sph: -3, cyl: -1.75, axis: 134 }, 1e-4)).toBe(true);
    expect(d.lens.backRadius2).toBeDefined();
    expect(d.lens.frontRadius).toBe(el.lens.frontRadius);
  });
  it('Plusglas: Mittendicke wird für Randdicke erhöht', () => {
    const el = createElement('spectacle-lens', doc) as LensElement;
    const d = designLensForRx(el, { sph: 6, cyl: 0, axis: 180 });
    expect(d.lens.centerThickness).toBeGreaterThan(el.lens.centerThickness);
    close(lensRx({ ...el, lens: d.lens }).sph, 6, 5);
  });
  it('Kontaktlinse torisch: Basiskurve bleibt', () => {
    const el = createElement('soft-contact-lens', doc) as LensElement;
    const d = designLensForRx(el, { sph: -3, cyl: -1.75, axis: 134 });
    expect(d.lens.backRadius).toBe(el.lens.backRadius);
    expect(rxEquals(lensRx({ ...el, lens: d.lens }), { sph: -3, cyl: -1.75, axis: 134 }, 1e-4)).toBe(true);
  });
});

function withElement(doc: SceneDocument, el: LensElement) {
  return applyConstraints({ ...doc, elements: [el] });
}

describe('Korrektion & HSA', () => {
  it('Auge −3,00, Glas −3,00 im HSA 12: Rest ≈ −0,10 dpt', () => {
    const doc = eyeDoc({ sph: -3, cyl: 0, axis: 180 });
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: -3, cyl: 0, axis: 180 }).lens };
    const c = computeCorrection(withElement(doc, placeAtVertexDistance(el, doc, 12)));
    close(c.elements[0].effectiveRx.sph, effectivePower(-3, 12), 3);
    close(c.residualRx.sph, -3 - effectivePower(-3, 12), 2);
  });
  it('Vollkorrektion: Glas mit F/(1+dF)-Umrechnung → Rest 0', () => {
    const doc = eyeDoc({ sph: -3, cyl: -1.75, axis: 134 });
    const needed = (A: number) => A / (1 + 0.012 * A);
    const S = needed(-3); const S2 = needed(-4.75);
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: S, cyl: S2 - S, axis: 134 }).lens };
    const c = computeCorrection(withElement(doc, placeAtVertexDistance(el, doc, 12)));
    expect(Math.abs(c.residualRx.sph)).toBeLessThan(0.01);
    expect(Math.abs(c.residualRx.cyl)).toBeLessThan(0.01);
  });
  it('HSA-Änderung ändert die Restrefraktion', () => {
    const doc = eyeDoc({ sph: -8, cyl: 0, axis: 180 });
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: -8, cyl: 0, axis: 180 }).lens };
    const r12 = computeCorrection(withElement(doc, placeAtVertexDistance(el, doc, 12))).residualRx.sph;
    const r20 = computeCorrection(withElement(doc, placeAtVertexDistance(el, doc, 20))).residualRx.sph;
    expect(r20).toBeLessThan(r12);
  });
  it('Verdrehtes Glas verändert die wirksame Achse', () => {
    const doc = eyeDoc({ sph: 0, cyl: 0, axis: 180 });
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: 0, cyl: -2, axis: 90 }).lens };
    const placed = placeAtVertexDistance(el, doc, 12);
    const rot = { ...placed, transform: { ...placed.transform, rotation: [0, 0, 20] as [number, number, number] } };
    const c = computeCorrection(withElement(doc, rot));
    close(c.elements[0].ownRx.axis, 70, 3);
  });
});

describe('Kontaktlinse & Tränenlinse', () => {
  it('formstabil, BK = K: Tränenlinse ≈ 0, Vollkorrektion', () => {
    const doc = eyeDoc({ sph: -3, cyl: 0, axis: 180 });
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: { ...designLensForRx(el, { sph: -3, cyl: 0, axis: 180 }).lens }, contact: { ...el.contact!, onEye: true, tearFilm: true } };
    const d = withElement(doc, el);
    const tl = tearLens(d.elements[0] as LensElement, d.eye);
    expect(Math.abs(tl.rx.sph)).toBeLessThan(0.05);
    expect(tl.fit).toBe('parallel');
    expect(Math.abs(computeCorrection(d).residualRx.sph)).toBeLessThan(0.05);
  });
  it('Basiskurve 0,1 mm steiler: Tränenlinse ≈ +0,5 dpt', () => {
    const doc = eyeDoc({ sph: 0, cyl: 0, axis: 180 });
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, backRadius: 7.7 }, contact: { ...el.contact!, onEye: true } };
    const tl = tearLens(el, doc.eye);
    expect(tl.rx.sph).toBeGreaterThan(0.45); expect(tl.rx.sph).toBeLessThan(0.65);
    expect(tl.fit).toBe('steep');
  });
  it('sphärische formstabile KL neutralisiert Hornhautastigmatismus weitgehend', () => {
    const doc = eyeDoc({ sph: -3, cyl: -1.75, axis: 180 });
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, backRadius: 7.8 }, contact: { ...el.contact!, onEye: true } };
    el = { ...el, lens: designLensForRx(el, { sph: -3, cyl: 0, axis: 180 }).lens };
    const c = computeCorrection(withElement(doc, el));
    expect(Math.abs(c.residualRx.cyl)).toBeLessThan(0.3);
  });
  it('weiche torische KL (angeschmiegt) korrigiert −3,00/−1,75 A134', () => {
    const doc = eyeDoc({ sph: -3, cyl: -1.75, axis: 134 });
    let el = createElement('soft-contact-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: -3, cyl: -1.75, axis: 134 }).lens, contact: { ...el.contact!, onEye: true } };
    const c = computeCorrection(withElement(doc, el));
    expect(Math.abs(c.residualRx.sph)).toBeLessThan(0.08);
    expect(Math.abs(c.residualRx.cyl)).toBeLessThan(0.08);
    expect(lensOptics(el, doc.eye).conformed).toBe(true);
  });
});

describe('Tränenraumprofil', () => {
  it('parallele KL (BK = K) dezentriert: Tränenfilm bleibt ≈ konstant (Linse folgt der Hornhaut)', async () => {
    const { computeTearProfile } = await import('@/model/derived/contactSeat');
    const doc = createEmptyScene();
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    // ohne periphere Kurven (Phase 4: Peripherie hebt den Rand ab – separat getestet)
    el = { ...el, lens: { ...el.lens, backRadius: 7.8 }, contact: { ...el.contact!, peripheralCurves: [], onEye: true, tearFilmThickness: 0.01, centration: { x: 1, y: -0.5 } } };
    const p = computeTearProfile(el, doc.eye, 12);
    expect(p.min).toBeGreaterThan(0.009);
    expect(p.max).toBeLessThan(0.0125); // entlang der Blickachse gemessen: 0,01/cos(Neigung der Hornhaut)
  });
  it('steile KL: Scheitelspalt größer als Randspalt, Auflageberechnung liefert Mindestspalt', async () => {
    const { computeTearProfile, tearThicknessForBearing } = await import('@/model/derived/contactSeat');
    const doc = createEmptyScene();
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, backRadius: 7.6 }, contact: { ...el.contact!, onEye: true } };
    const t = tearThicknessForBearing(el, doc.eye);
    el = { ...el, contact: { ...el.contact!, tearFilmThickness: t } };
    const p = computeTearProfile(el, doc.eye, 12);
    expect(p.central).toBeGreaterThan(p.edgeClearance);
    expect(p.edgeClearance).toBeGreaterThan(0.004);
  });
});

describe('Dezentrierte KL in der Korrektionsrechnung', () => {
  it('aufgesetzte, dezentrierte KL zählt weiterhin zur Korrektion', () => {
    const doc = eyeDoc({ sph: -3, cyl: 0, axis: 180 });
    let el = createElement('soft-contact-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: -3, cyl: 0, axis: 180 }).lens, contact: { ...el.contact!, onEye: true, centration: { x: 1, y: 0 } } };
    const c = computeCorrection(withElement(doc, el));
    expect(c.hasCorrection).toBe(true);
    expect(Math.abs(c.residualRx.sph)).toBeLessThan(0.1);
  });
});
