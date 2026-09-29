/**
 * Phase 5 – fachlicher Review der Optik: Glasdicke ↔ Brechungsindex, Geometrie-Konsistenz,
 * gewendete Gläser, Dispersion des Auges, Rot-Grün mit Akkommodation, Skiaskopie-Hauptschnitte.
 */
import { describe, expect, it } from 'vitest';
import { createElement, createEmptyScene, createLightSource, placeAtVertexDistance, replaceLensKeepingBackVertex } from '@/model/sceneFactory';
import { designLensForRx, lensOptics } from '@/engine/physics/lensOptics';
import { lensMassProperties, requiredCenterThickness, vogelBaseCurve, withAutoThickness, edgeProfile } from '@/engine/physics/lensThickness';
import { resolveLensShape, lensOutlineFn, lensSurfaces } from '@/model/derived/elementShape';
import { placementOf } from '@/model/derived/measurements';
import { computeCorrection, elementFrameInEye, transformMatrix } from '@/engine/physics/correction';
import { backVertexMatrix, matrixToRx, rotateMatrix, rxToMatrix, type Rx } from '@/core/math/powerMatrix';
import { solveEyeForRefraction } from '@/engine/physics/eyeRefraction';
import { chromaticRefractionShift, duochromeResponse, patientViewState } from '@/engine/optics/vision';
import { LAMBDA_C, LAMBDA_F } from '@/engine/optics/dispersion';
import { buildReflexModel, DEFAULT_RETINOSCOPE } from '@/engine/optics/retinoscopy';
import { refract } from '@/engine/raytracing/refraction';
import { traceScene } from '@/engine/raytracing';
import { outlineRadiusFrom } from '@/core/math/outline';
import { thickLens } from '@/engine/physics/formulas';
import { computeElementOptics } from '@/engine/physics/elementOptics';
import { applyConstraints } from '@/model/derived/contactSeat';
import { findMaterial } from '@/model/media';
import type { LensElement, SceneDocument } from '@/model/types';

const sph = (s: number): Rx => ({ sph: s, cyl: 0, axis: 180 });

function eyeDoc(rx: Rx, age?: number): SceneDocument {
  const doc = createEmptyScene('T');
  doc.eye = { ...doc.eye, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, 'auto').anatomy };
  if (age !== undefined) doc.eye.patient = { age, accommodates: true };
  return doc;
}

/** Brillenglas mit fester Basiskurve und festen Mindestdicken (nur n variiert) */
function glass(n: number, rx: Rx, extra: Partial<LensElement['lens']> = {}): LensElement {
  const doc = createEmptyScene('T');
  let el = createElement('spectacle-lens', doc) as LensElement;
  el = { ...el, medium: { presetId: 'custom', n }, lens: { ...el.lens, frontRadius: 87, thicknessMode: 'auto', minCenterThickness: 1.5, minEdgeThickness: 1.0, ...extra } };
  return { ...el, lens: designLensForRx(el, rx).lens };
}

describe('Glasdicke ↔ Brechungsindex (gleiche Wirkung, Form, Basiskurve, Mindestdicken)', () => {
  const indices = [1.5, 1.6, 1.67, 1.74];

  it('Minusglas −6,00: Mittendicke = Mindestmittendicke, Randdicke sinkt mit steigendem n', () => {
    const edges = indices.map((n) => {
      const el = glass(n, sph(-6));
      const s = resolveLensShape(el);
      expect(s.centerThickness).toBeCloseTo(1.5, 3);
      expect(lensOptics(el).rx.sph).toBeCloseTo(-6, 3);
      return lensMassProperties(el).edgeMax;
    });
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeLessThan(edges[i - 1]);
    // grob: 1,50 → 1,74 spart mehr als 1 mm Randdicke bei Ø 52 × 40
    expect(edges[0] - edges[3]).toBeGreaterThan(1);
  });

  it('Plusglas +4,00: Randdicke = Mindestranddicke, Mittendicke sinkt mit steigendem n', () => {
    const centers = indices.map((n) => {
      const el = glass(n, sph(4));
      expect(lensOptics(el).rx.sph).toBeCloseTo(4, 3);
      expect(lensMassProperties(el).edgeMin).toBeCloseTo(1.0, 2);
      return resolveLensShape(el).centerThickness;
    });
    for (let i = 1; i < centers.length; i++) expect(centers[i]).toBeLessThan(centers[i - 1]);
  });

  it('keine Hysterese: Materialwechsel hin und zurück ergibt dieselbe Dicke', () => {
    let el = glass(1.5, sph(4));
    const t0 = el.lens.centerThickness;
    for (const n of [1.74, 1.6, 1.5]) {
      const tmp = { ...el, medium: { ...el.medium, n } };
      el = { ...tmp, lens: designLensForRx(tmp, lensOptics(el).rx).lens };
    }
    expect(el.lens.centerThickness).toBeCloseTo(t0, 3);
  });

  it('Dicke folgt der Geometrie: t = max(t_min, e_min + max(s₁ − s₂))', () => {
    const el = glass(1.6, sph(3));
    const { front, back } = lensSurfaces(el);
    const req = requiredCenterThickness(front, back, lensOutlineFn(el), 1.0, 1.5);
    expect(el.lens.centerThickness).toBeCloseTo(req, 3);
    const prof = edgeProfile(front, back, lensOutlineFn(el));
    expect(el.lens.centerThickness - prof.maxSagDiff).toBeCloseTo(1.0, 3);
  });

  it('Größerer Durchmesser / dezentrierter optischer Mittelpunkt → dickeres Plusglas', () => {
    const base = glass(1.6, sph(4));
    const larger = glass(1.6, sph(4), { width: 60, height: 46 });
    const dec = glass(1.6, sph(4), { opticalCenterOffset: { x: 4, y: 0 } });
    expect(larger.lens.centerThickness).toBeGreaterThan(base.lens.centerThickness + 0.3);
    expect(dec.lens.centerThickness).toBeGreaterThan(base.lens.centerThickness);
    // die dünnste Randstelle liegt auf der vom optischen Mittelpunkt abgewandten Seite
    expect(lensMassProperties(dec).edgeMin).toBeCloseTo(1.0, 2);
  });

  it('Materialrichtwerte: zähere Materialien erlauben dünnere Minusgläser', () => {
    expect(findMaterial('cr39')!.minCenterThickness).toBeGreaterThan(findMaterial('polycarbonate')!.minCenterThickness!);
    const doc = createEmptyScene('T');
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, sph(-4)).lens };
    expect(el.lens.thicknessMode).toBe('auto');
    expect(resolveLensShape(el).centerThickness).toBeCloseTo(2.0, 3); // ADC-Richtwert
  });

  it('Basiskurve nach Vogel: gleicher Flächenbrechwert → flacherer Radius bei höherem n', () => {
    const a = vogelBaseCurve(-4, 1.5);
    const b = vogelBaseCurve(-4, 1.74);
    expect(a.power).toBeCloseTo(4, 6);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(vogelBaseCurve(3, 1.5).power).toBeCloseTo(9, 6);
  });

  it('Gewicht aus Volumen und Dichte: Planplatte V = A·t', () => {
    const doc = createEmptyScene('T');
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, outline: 'round', diameter: 50, frontRadius: 0, backRadius: 0, thicknessMode: 'manual', centerThickness: 2 } };
    const m = lensMassProperties(el);
    expect(m.volume).toBeCloseTo(Math.PI * 25 * 25 * 2, -1);
    expect(m.mass!).toBeCloseTo((m.volume * 1.32) / 1000, 6);
  });

  it('Auto-Dicke hält den HSA fest (augenseitiger Scheitel ortsfest)', () => {
    const doc = eyeDoc(sph(-4));
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = placeAtVertexDistance({ ...el, lens: designLensForRx(el, sph(-4)).lens }, doc, 12);
    const hsa0 = placementOf(doc.eye, el).vertexDistance;
    const thicker = replaceLensKeepingBackVertex(el, withAutoThickness({ ...el, lens: { ...el.lens, minCenterThickness: 3 } }));
    expect(thicker.lens.centerThickness).toBeCloseTo(3, 3);
    expect(placementOf(doc.eye, thicker).vertexDistance).toBeCloseTo(hsa0, 6);
  });
});

describe('Geometrie-Konsistenz', () => {
  it('Wirkung wird mit derselben Mittendicke gerechnet wie Darstellung und Raytracing', () => {
    const doc = createEmptyScene('T');
    let el = createElement('biconvex', doc) as LensElement;
    // manuelle, zu dünne Mitte → Darstellung erhöht auf Mindestrand
    el = { ...el, lens: { ...el.lens, frontRadius: 40, backRadius: -40, diameter: 40, centerThickness: 1, thicknessMode: 'manual' } };
    const shape = resolveLensShape(el);
    expect(shape.centerThickness).toBeGreaterThan(1);
    const expected = thickLens(el.medium.n, 40, -40, shape.centerThickness).backVertexPower;
    expect(lensOptics(el).rx.sph).toBeCloseTo(expected, 6);
  });

  it('Dezentrierte Kontur: Radius vom optischen Mittelpunkt aus', () => {
    const o = { outline: 'round' as const, diameter: 40, width: 0, height: 0, cx: 5, cy: 0 };
    expect(outlineRadiusFrom(o, 0)).toBeCloseTo(25, 4);
    expect(outlineRadiusFrom(o, Math.PI)).toBeCloseTo(15, 4);
  });

  it('Torische Linse: Kennwerte aus der Matrixrechnung, nicht aus einem einzelnen Radius', () => {
    const doc = createEmptyScene('T');
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, { sph: 0, cyl: -2, axis: 30 }).lens };
    const v = computeElementOptics(el);
    expect(v.find((c) => c.id === 'Sv')!.value).toBeCloseTo(0, 2);
    expect(v.find((c) => c.id === 'Sv2')!.value).toBeCloseTo(-2, 2);
  });

  it('Snellius: n₁ sin ε₁ = n₂ sin ε₂ und Totalreflexion', () => {
    const e1 = (30 * Math.PI) / 180;
    const r = refract([Math.sin(e1), 0, Math.cos(e1)], [0, 0, -1], 1, 1.5);
    expect(Math.sin(e1)).toBeCloseTo(1.5 * r.dir[0], 9);
    const t = refract([Math.sin(1), 0, Math.cos(1)], [0, 0, -1], 1.5, 1);
    expect(t.totalInternalReflection).toBe(true);
  });

  it('Frame-Transformation entspricht bei reiner Verdrehung rotateMatrix', () => {
    const doc = createEmptyScene('T');
    const el = { ...(createElement('spectacle-lens', doc) as LensElement) };
    el.transform = { ...el.transform, rotation: [0, 0, 25] };
    const M = rxToMatrix({ sph: 1, cyl: -2, axis: 40 });
    const a = transformMatrix(M, elementFrameInEye(el, doc.eye).T);
    const b = rotateMatrix(M, -25);
    expect(a.a).toBeCloseTo(b.a, 9);
    expect(a.b).toBeCloseTo(b.b, 9);
    expect(a.c).toBeCloseTo(b.c, 9);
  });
});

describe('Gewendetes Glas (Rückfläche zeigt vom Auge weg)', () => {
  function flippedScene(rot: [number, number, number]) {
    let doc = eyeDoc(sph(0));
    const l = createLightSource(doc, 80);
    l.source.beamDiameter = 2;
    l.source.rayCount = 9;
    let el = createElement('spectacle-lens', doc) as LensElement;
    el = { ...el, lens: { ...el.lens, thicknessMode: 'manual', outline: 'round', diameter: 40 } };
    el = { ...el, lens: designLensForRx(el, { sph: 3, cyl: -2, axis: 30 }).lens };
    el = placeAtVertexDistance(el, doc, 12);
    el = { ...el, transform: { ...el.transform, rotation: rot } };
    doc = { ...doc, elements: [el], lights: [l] };
    return { doc, el };
  }

  it('Achse wird gespiegelt (30° → 150°) und die Vorderscheitelwirkung gilt', () => {
    const { doc, el } = flippedScene([0, 180, 0]);
    const c = computeCorrection(doc);
    expect(c.notes.some((n) => n.includes('gewendet'))).toBe(true);
    expect(c.elements[0].ownRx.axis).toBeCloseTo(150, 3);
    const o = lensOptics(el);
    const frontVertex = matrixToRx(backVertexMatrix(o.F2, o.F1, resolveLensShape(el).centerThickness, el.medium.n));
    expect(c.elements[0].ownRx.sph).toBeCloseTo(frontVertex.sph, 6);
  });

  it('Raytracing bestätigt die gespiegelten Hauptschnitte', () => {
    const { doc } = flippedScene([0, 180, 0]);
    const r = traceScene(doc);
    const degs = r.focus!.astigmatism!.lines.map((l) => Math.round(l.meridianDeg)).sort((a, b) => a - b);
    expect(Math.abs(degs[0] - 60)).toBeLessThanOrEqual(2);
    expect(Math.abs(degs[1] - 150)).toBeLessThanOrEqual(2);
  });
});

describe('Dispersion des Auges, Rot-Grün-Test und Akkommodation', () => {
  it('Chromatische Längsaberration F→C ≈ 0,9 dpt (Thibos: Chromatic Eye)', () => {
    const a = eyeDoc(sph(0)).eye.anatomy;
    const lca = chromaticRefractionShift(a, LAMBDA_C) - chromaticRefractionShift(a, LAMBDA_F);
    expect(lca).toBeGreaterThan(0.85);
    expect(lca).toBeLessThan(0.95);
    expect(chromaticRefractionShift(a, 620)).toBeGreaterThan(0.1);
    expect(chromaticRefractionShift(a, 535)).toBeLessThan(-0.25);
  });

  function duo(extraLens: number, accommodates: boolean) {
    const doc = eyeDoc(sph(-2), 25);
    doc.eye.patient = { age: 25, accommodates };
    // zusätzliches Glas am Hornhautscheitel (Minus = übermint); Prüfentfernung ∞ für klare Verhältnisse
    const st = patientViewState(doc, { testDistanceMm: 1e9, extra: { a: extraLens - 2, b: 0, c: extraLens - 2 } });
    return duochromeResponse(doc.eye.anatomy, st.E).answer;
  }

  it('untermint → Rot, übermint → Grün (auch wenn der Patient akkommodiert)', () => {
    expect(duo(+0.5, true)).toBe('red');
    expect(duo(+0.25, true)).toBe('red');
    expect(duo(-0.25, true)).toBe('green');
    expect(duo(-0.5, true)).toBe('green');
    expect(duo(-0.5, false)).toBe('green');
  });
});

describe('Skiaskopie: Hauptschnitt-Bewegung konsistent mit der Hauptanzeige', () => {
  for (const w of [150, 250, 667]) {
    it(`Konkavspiegel, E = −1 dpt, w = ${w} mm`, () => {
      const E = rxToMatrix(sph(-1));
      const m = buildReflexModel({ E, workingDistanceMm: w, pupilDiameterMm: 4, params: { ...DEFAULT_RETINOSCOPE, sleeve: 'concave' } });
      expect(m.principal[0].motion).toBe(m.motion);
      expect(m.principal[1].motion).toBe(m.motion);
    });
  }
});

describe('Weiche KL: Materialwechsel aktualisiert die angeschmiegte Geometrie', () => {
  it('kein veralteter Cache', () => {
    let doc = eyeDoc({ sph: -3, cyl: -1, axis: 180 });
    let el = createElement('soft-contact-lens', doc) as LensElement;
    el = { ...el, lens: designLensForRx(el, sph(-3)).lens, contact: { ...el.contact!, onEye: true } };
    doc = applyConstraints({ ...doc, elements: [el] });
    const on = doc.elements[0] as LensElement;
    const p1 = lensOptics(on, doc.eye).rx.sph;
    const changed = { ...on, medium: { ...on.medium, n: 1.5 } };
    const fresh = lensOptics({ ...changed, lens: { ...changed.lens } }, doc.eye).rx.sph;
    expect(lensOptics(changed, doc.eye).rx.sph).toBeCloseTo(fresh, 9);
    expect(Number.isFinite(p1)).toBe(true);
  });
});
