/**
 * Phase 4 – Fluoreszein: Tränenfilmdicke aus der Geometrie, Intensität, Sitzbeurteilung.
 */
import { describe, expect, it } from 'vitest';
import { createElement, createEmptyScene } from '@/model/sceneFactory';
import { tearThicknessAt, tearThicknessForBearing, applyConstraints, corneaSagXY } from '@/model/derived/contactSeat';
import { analyzeFluorescein, classifyThickness, fluoIntensity, probeFluorescein } from '@/engine/optics/fluorescein';
import type { LensElement, SceneDocument } from '@/model/types';

function fit(bc: number, opts: { Q?: number; pcs?: boolean; centration?: { x: number; y: number } } = {}) {
  const doc: SceneDocument = createEmptyScene('F');
  if (opts.Q !== undefined) doc.eye = { ...doc.eye, anatomy: { ...doc.eye.anatomy, corneaAsphericity: opts.Q } };
  let el = createElement('rigid-contact-lens', doc) as LensElement;
  el = { ...el, lens: { ...el.lens, backRadius: bc }, contact: { ...el.contact!, onEye: true, peripheralCurves: opts.pcs === false ? [] : el.contact!.peripheralCurves } };
  el = { ...el, contact: { ...el.contact!, tearFilmThickness: tearThicknessForBearing(el, doc.eye) } };
  if (opts.centration) el = { ...el, contact: { ...el.contact!, centration: opts.centration } };
  const d = applyConstraints({ ...doc, elements: [el] });
  return { el: d.elements[0] as LensElement, eye: d.eye };
}

describe('Fluoreszenzintensität', () => {
  it('dunkel bei Auflage, hell bei Pooling, monoton', () => {
    expect(fluoIntensity(0.005)).toBe(0);
    expect(fluoIntensity(0.02)).toBeLessThan(fluoIntensity(0.05));
    expect(fluoIntensity(0.15)).toBeGreaterThan(0.9);
    expect(classifyThickness(0.005).cls).toBe('touch');
    expect(classifyThickness(0.06).cls).toBe('pooling');
  });
});

describe('Sitzbeurteilung aus der Geometrie', () => {
  it('Basiskurve = K (sphärische Hornhaut): paralleler Sitz, gleichmäßige optische Zone', () => {
    const { el, eye } = fit(7.8);
    const a = analyzeFluorescein(el, eye);
    expect(a.verdict).toBe('alignment');
    expect(Math.abs(a.stats.central - a.stats.midPeriphery)).toBeLessThan(0.005);
  });

  it('steile Basiskurve (7,50 auf 7,80): zentrales Pooling + mittelperiphere Auflage', () => {
    const f = fit(7.5);
    const a = analyzeFluorescein(f.el, f.eye);
    expect(a.verdict).toBe('steep');
    expect(a.stats.central).toBeGreaterThan(0.03);
    expect(a.features).toContain('zentrales Pooling');
  });

  it('flache Basiskurve (8,20 auf 7,80): zentrale Auflage, Tränen peripher', () => {
    const { el, eye } = fit(8.2);
    const a = analyzeFluorescein(el, eye);
    expect(a.verdict).toBe('flat');
    expect(a.stats.central).toBeLessThan(0.015);
    expect(a.stats.midPeriphery).toBeGreaterThan(a.stats.central);
  });

  it('periphere Kurven erzeugen Randunterspülung', () => {
    const withPc = fit(7.8);
    const noPc = fit(7.8, { pcs: false });
    const r = withPc.el.lens.diameter / 2 - 0.1;
    expect(tearThicknessAt(withPc.el, withPc.eye, r, 0)).toBeGreaterThan(tearThicknessAt(noPc.el, noPc.eye, r, 0) + 0.02);
  });

  it('asphärische Hornhaut (Q = −0,26) flacht ab: Peripherie wird bei gleicher BK dicker', () => {
    const sph = fit(7.8, { pcs: false });
    const asph = fit(7.8, { pcs: false, Q: -0.26 });
    expect(corneaSagXY(asph.eye, 3, 0)).toBeLessThan(corneaSagXY(sph.eye, 3, 0));
    expect(tearThicknessAt(asph.el, asph.eye, 3.5, 0)).toBeGreaterThan(tearThicknessAt(sph.el, sph.eye, 3.5, 0));
  });

  it('Dezentration auf asphärischer Hornhaut macht das Bild asymmetrisch (auf einer Kugel nicht)', () => {
    const sphere = fit(7.8, { centration: { x: 1.2, y: 0 } });
    expect(Math.abs(tearThicknessAt(sphere.el, sphere.eye, -3.5, 0) - tearThicknessAt(sphere.el, sphere.eye, 3.5, 0))).toBeLessThan(0.002);
    const { el, eye } = fit(7.8, { centration: { x: 1.2, y: 0 }, Q: -0.3 });
    const left = tearThicknessAt(el, eye, -3.5, 0);
    const right = tearThicknessAt(el, eye, 3.5, 0);
    expect(Math.abs(left - right)).toBeGreaterThan(0.002);
  });

  it('Messpunkt trennt Messwert und Interpretation; weiche Linse: nicht anwendbar', () => {
    const { el, eye } = fit(7.5);
    const p = probeFluorescein(el, eye, 0, 0);
    expect(p.zone).toBe('optic');
    expect(p.thickness).toBeGreaterThan(0.03);
    expect(p.interpretation).toMatch(/steiler/);
    const doc = createEmptyScene('S');
    const soft = createElement('soft-contact-lens', doc) as LensElement;
    expect(analyzeFluorescein(soft, doc.eye).applicable).toBe(false);
  });
});
