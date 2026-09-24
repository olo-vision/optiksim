import { describe, expect, it } from 'vitest';
import { traceScene } from '@/engine/raytracing';
import { createElement, createEmptyScene, createLightSource, placeAtVertexDistance } from '@/model/sceneFactory';
import { solveEyeForRefraction, eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { designLensForRx } from '@/engine/physics/lensOptics';
import { computeCorrection } from '@/engine/physics/correction';
import { applyConstraints } from '@/model/derived/contactSeat';
import type { LensElement, SceneDocument } from '@/model/types';
import type { Rx } from '@/core/math/powerMatrix';

function scene(rx: Rx, mode: 'axial' | 'refractive' = 'axial'): SceneDocument {
  let doc = createEmptyScene();
  doc.eye = { ...doc.eye, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, mode).anatomy };
  const l = createLightSource(doc, 80);
  l.source.beamDiameter = 3;
  l.source.rayCount = 7;
  doc = { ...doc, lights: [l] };
  return doc;
}

describe('Raytracing Phase 2', () => {
  it('Myopie −3,00: achsnaher Fokus vor der Retina, passend zur paraxialen Rechnung', () => {
    const doc = scene({ sph: -3, cyl: 0, axis: 180 });
    const r = traceScene(doc);
    const parax = eyeRefractionState(doc.eye.anatomy).meridians[0].defocusMm;
    expect(r.focus!.paraxialDefocusMm).toBeLessThan(-0.7);
    expect(r.focus!.paraxialDefocusMm).toBeCloseTo(parax, 1);
    expect(r.focus!.astigmatism).toBeUndefined();
  });
  it('Hyperopie +3,00: Fokus hinter der Retina', () => {
    const r = traceScene(scene({ sph: 3, cyl: 0, axis: 180 }));
    expect(r.focus!.paraxialDefocusMm).toBeGreaterThan(0.7);
  });
  it('Astigmatismus −3,00/−1,75 A134: zwei Brennlinien in den Hauptschnitten', () => {
    const doc = scene({ sph: -3, cyl: -1.75, axis: 134 });
    const r = traceScene(doc);
    const a = r.focus!.astigmatism!;
    expect(a).toBeDefined();
    const st = eyeRefractionState(doc.eye.anatomy);
    expect(a.sturmIntervalMm).toBeCloseTo(st.sturmIntervalMm, 1);
    const degs = a.lines.map((l) => Math.round(l.meridianDeg)).sort((x, y) => x - y);
    expect(Math.abs(degs[0] - 44)).toBeLessThanOrEqual(2);
    expect(Math.abs(degs[1] - 134)).toBeLessThanOrEqual(2);
    // Meridian 44° (stärker myop) fokussiert weiter vorn
    const l44 = a.lines.find((l) => Math.abs(l.meridianDeg - 44) < 3)!;
    const l134 = a.lines.find((l) => Math.abs(l.meridianDeg - 134) < 3)!;
    expect(l44.defocusMm).toBeLessThan(l134.defocusMm);
  });
  it('Torisches Brillenglas korrigiert das astigmatische Auge (Raytracing)', () => {
    let doc = scene({ sph: -3, cyl: -1.75, axis: 134 });
    const S = -3 / (1 + 0.012 * -3);
    const S2 = -4.75 / (1 + 0.012 * -4.75);
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: S, cyl: S2 - S, axis: 134 }).lens };
    doc = { ...doc, elements: [placeAtVertexDistance(el, doc, 12)] };
    const r = traceScene(doc);
    expect(Math.abs(r.focus!.paraxialDefocusMm)).toBeLessThan(0.05);
    expect(r.focus!.astigmatism).toBeUndefined();
  });
  it('Formstabile KL mit Tränenfilm: Tränenfilm-Körper wird durchlaufen, Fokus korrigiert', () => {
    let doc = scene({ sph: -3, cyl: 0, axis: 180 });
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: -3, cyl: 0, axis: 180 }).lens, contact: { ...el.contact!, onEye: true, tearFilm: true, tearFilmThickness: 0.02 } };
    doc = applyConstraints({ ...doc, elements: [el] });
    const r = traceScene(doc);
    expect(r.stats.retina).toBeGreaterThan(0);
    const res = computeCorrection(doc).residualRx.sph;
    // Raytracing und Vergenzrechnung stimmen überein (Rest ~ 0)
    expect(Math.abs(res)).toBeLessThan(0.05);
    expect(Math.abs(r.focus!.paraxialDefocusMm)).toBeLessThan(0.05);
  });
  it('Steile formstabile KL erzeugt Plus-Tränenlinse → Fokus rückt nach vorn', () => {
    let doc = scene({ sph: 0, cyl: 0, axis: 180 });
    let el = createElement('rigid-contact-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, backRadius: 7.6 }, contact: { ...el.contact!, onEye: true, tearFilmThickness: 0.03 } };
    el = { ...el, lens: designLensForRx(el, { sph: 0, cyl: 0, axis: 180 }).lens };
    doc = applyConstraints({ ...doc, elements: [el] });
    const withTear = traceScene(doc).focus!.paraxialDefocusMm;
    const noTear = traceScene({ ...doc, elements: [{ ...el, contact: { ...el.contact!, tearFilm: false } }] }).focus!.paraxialDefocusMm;
    expect(withTear).toBeLessThan(-0.2);
    expect(withTear).toBeLessThan(noTear);
  });
});
