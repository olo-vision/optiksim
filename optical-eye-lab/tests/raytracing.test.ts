import { describe, expect, it } from 'vitest';
import { traceScene } from '@/engine/raytracing';
import { buildPreset } from '@/state/presets';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { createEmptyScene, createElement, createLightSource } from '@/model/sceneFactory';

describe('Raytracing', () => {
  it('emmetropes Auge: Fokus nahe der Retina (schmales Bündel ≈ paraxial)', () => {
    const doc = createEmptyScene();
    const l = createLightSource(doc, 80);
    l.source.beamDiameter = 1;
    doc.lights = [l];
    const r = traceScene(doc);
    expect(r.stats.retina).toBe(l.source.rayCount);
    const parax = summarizeEye(doc.eye.anatomy).defocusMm;
    expect(r.focus!.defocusMm).toBeCloseTo(parax, 1);
  });
  it('Preset Brillenglas korrigiert das kurzsichtige Auge', () => {
    const doc = buildPreset('eye-spectacle');
    const uncorrected = traceScene({ ...doc, elements: [] });
    const corrected = traceScene(doc);
    expect(Math.abs(corrected.focus!.defocusMm)).toBeLessThan(Math.abs(uncorrected.focus!.defocusMm) / 3);
  });
  it('Preset Kontaktlinse korrigiert das kurzsichtige Auge', () => {
    const doc = buildPreset('eye-contact');
    const uncorrected = traceScene({ ...doc, elements: [] });
    const corrected = traceScene(doc);
    expect(Math.abs(corrected.focus!.defocusMm)).toBeLessThan(Math.abs(uncorrected.focus!.defocusMm) / 3);
  });
  it('Kepler-System liefert Bild nahe der Retina', () => {
    const doc = buildPreset('eye-two-lenses');
    const r = traceScene(doc);
    expect(r.stats.retina).toBeGreaterThan(0);
    expect(Math.abs(r.focus!.defocusMm)).toBeLessThan(0.6);
  });
  it('Prisma lenkt zur Basis hin ab', () => {
    const doc = createEmptyScene();
    const p = createElement('prism', doc);
    doc.elements = [p];
    const l = createLightSource(doc, 150);
    l.source.rayCount = 1;
    doc.lights = [l];
    const r = traceScene({ ...doc, eye: { ...doc.eye, visible: false } });
    const last = r.paths[0].points.at(-1)!;
    // Basis unten (270°) → Ablenkung nach −Y
    expect(last[1]).toBeLessThan(-1);
  });
});

describe('Fokusanalyse', () => {
  it('achsnaher Fokus des korrigierten Presets liegt auf der Retina (±0,1 mm)', () => {
    const r = traceScene(buildPreset('eye-spectacle'));
    expect(Math.abs(r.focus!.paraxialDefocusMm)).toBeLessThan(0.1);
  });
  it('achsnaher Fokus des Normalauges stimmt mit der paraxialen Rechnung überein', () => {
    const doc = buildPreset('normal-eye');
    const r = traceScene(doc);
    expect(r.focus!.paraxialDefocusMm).toBeCloseTo(summarizeEye(doc.eye.anatomy).defocusMm, 1);
  });
});
