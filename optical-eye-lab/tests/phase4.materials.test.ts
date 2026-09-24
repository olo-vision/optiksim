/**
 * Phase 4 – Materialien, Dispersion, optische Rechner, HSA und KL-Wirkung.
 */
import { describe, expect, it } from 'vitest';
import { MATERIALS, dkOverT, findMaterial, hydrogelDk, materialsForElement, oxygenRating } from '@/model/media';
import { indexAt, LAMBDA_C, LAMBDA_D, LAMBDA_F } from '@/engine/optics/dispersion';
import { backVertexPower, imaging, keratometry, magnifier, prentice, spectacleToContact, tearLensQuick, vertexConversion } from '@/engine/optics/calculators';
import { traceScene } from '@/engine/raytracing';
import { buildPreset } from '@/state/presets';
import { computeCorrection } from '@/engine/physics/correction';
import { rxToMatrix } from '@/core/math/powerMatrix';

describe('Materialbibliothek', () => {
  it('Kategorien sind getrennt und passen zum Element', () => {
    const spec = materialsForElement('spectacle-lens');
    expect(spec.every((m) => m.category === 'spectacle')).toBe(true);
    expect(spec.some((m) => m.subgroup === 'Mineral') && spec.some((m) => m.subgroup === 'Kunststoff')).toBe(true);
    expect(materialsForElement('rigid-contact-lens').every((m) => m.category === 'contact-rigid')).toBe(true);
    const soft = materialsForElement('soft-contact-lens');
    expect(soft.every((m) => m.category === 'contact-hydrogel' || m.category === 'contact-sihy')).toBe(true);
    expect(soft.some((m) => m.id === 'cr39')).toBe(false);
  });

  it('Phase-1/2-IDs bleiben mit identischem n erhalten', () => {
    const expected: Record<string, number> = { cr39: 1.5, crown: 1.523, glass: 1.52, hi160: 1.6, hi167: 1.67, hi174: 1.74, polycarbonate: 1.586, pmma: 1.49, rgp: 1.45, hydrogel: 1.43, sihy: 1.42, water: 1.333, bk7: 1.5168, flint: 1.648 };
    for (const [id, n] of Object.entries(expected)) expect(findMaterial(id)?.n).toBe(n);
  });

  it('Materialdaten sind plausibel', () => {
    for (const m of MATERIALS) {
      expect(m.n).toBeGreaterThanOrEqual(1);
      if (m.abbe) expect(m.abbe).toBeGreaterThan(20);
      if (m.category.startsWith('contact')) expect(m.dk).toBeGreaterThanOrEqual(0);
      if (m.category === 'contact-hydrogel' || m.category === 'contact-sihy') expect(m.waterContent).toBeGreaterThan(0);
      if (m.category === 'spectacle') expect(m.density).toBeGreaterThan(1);
    }
    // Hydrogel-Dk nach Wassergehalt (Fatt): 38 % ≈ 9,6; 70 % ≈ 35,8
    expect(hydrogelDk(38)).toBeCloseTo(9.6, 0);
    expect(hydrogelDk(70)).toBeCloseTo(35.8, 0);
    // Silikon-Hydrogel: hohes Dk trotz geringem Wassergehalt
    expect(findMaterial('sihy')!.dk!).toBeGreaterThan(findMaterial('hg-2')!.dk!);
  });

  it('Dk/t und Einordnung', () => {
    expect(dkOverT(100, 0.1)).toBeCloseTo(100);
    expect(dkOverT(60, 0.18)).toBeCloseTo(33.3, 1);
    expect(oxygenRating(33).tone).toBe('ok');
    expect(oxygenRating(10).tone).toBe('danger');
  });
});

describe('Dispersion', () => {
  it('n(λ) reproduziert n_d und die Abbe-Zahl', () => {
    const nd = 1.6;
    const V = 42;
    expect(indexAt(nd, V, LAMBDA_D)).toBe(nd);
    const nF = indexAt(nd, V, LAMBDA_F);
    const nC = indexAt(nd, V, LAMBDA_C);
    expect((nd - 1) / (nF - nC)).toBeCloseTo(V, 6);
    expect(nF).toBeGreaterThan(nd);
    expect(nC).toBeLessThan(nd);
    expect(indexAt(1.0, 50, 450)).toBe(1.0);
  });

  it('Raytracing: blaues Licht fokussiert vor rotem (chromatische Längsaberration)', () => {
    const doc = buildPreset('normal-eye');
    const at = (nm: number) => {
      const d = { ...doc, lights: doc.lights.map((l) => ({ ...l, source: { ...l.source, wavelength: nm } })) };
      return traceScene(d).focus!.paraxialDefocusMm;
    };
    const blue = at(LAMBDA_F);
    const ref = at(LAMBDA_D);
    const red = at(LAMBDA_C);
    expect(blue).toBeLessThan(ref);
    expect(red).toBeGreaterThan(ref);
    // ≈ 1 dpt F–C entspricht ≈ 0,3–0,5 mm Bildlage im Auge
    expect(red - blue).toBeGreaterThan(0.2);
    expect(red - blue).toBeLessThan(0.7);
  });

  it('d-Linie: Raytracing unverändert gegenüber Phase 2', () => {
    const doc = buildPreset('eye-spectacle');
    const ref = traceScene(doc).focus!.paraxialDefocusMm;
    const explicit = traceScene({ ...doc, lights: doc.lights.map((l) => ({ ...l, source: { ...l.source, wavelength: 587.56 } })) }).focus!.paraxialDefocusMm;
    expect(explicit).toBe(ref);
    expect(Math.abs(ref)).toBeLessThan(0.1);
  });
});

describe('Optische Rechner', () => {
  it('HSA-Umrechnung: −8,00 von 12 mm auf 20 mm → Minusglas muss stärker werden (≈ −8,55)', () => {
    const r = vertexConversion({ sph: -8, cyl: 0, axis: 180 }, 12, 20);
    const Fc = -8 / (1 + 0.012 * 8);
    expect(r.value.atCornea.sph).toBeCloseTo(Fc, 6);
    expect(r.value.converted.sph).toBeCloseTo(Fc / (1 + 0.02 * Fc), 6);
    expect(r.value.converted.sph).toBeLessThan(-8);
    expect(r.explanation.formula).toMatch(/F_HS/);
  });

  it('HSA-Umrechnung stimmt mit der Simulation überein (Demo „HSA-Änderung“)', () => {
    const doc = buildPreset('hsa-change');
    const c = computeCorrection(doc);
    // Restrefraktion ≠ 0, weil das Glas für 12 mm berechnet, aber in 20 mm getragen wird
    expect(Math.abs(c.residualRx.sph)).toBeGreaterThan(0.3);
  });

  it('Brille → KL (Plus stärker, Minus schwächer)', () => {
    expect(spectacleToContact({ sph: -6, cyl: 0, axis: 180 }, 12).value.sph).toBeCloseTo(-6 / 1.072, 6);
    expect(spectacleToContact({ sph: 6, cyl: 0, axis: 180 }, 12).value.sph).toBeCloseTo(6 / 0.928, 6);
  });

  it('Prentice: +4 dpt, 5 mm oberhalb des OZ → 2 cm/m Basis unten (270°)', () => {
    const r = prentice({ sph: 4, cyl: 0, axis: 180 }, 0, 5);
    expect(r.value.amount).toBeCloseTo(2, 6);
    expect(r.value.base).toBeCloseTo(270, 6);
    const minus = prentice({ sph: -4, cyl: 0, axis: 180 }, 0, 5);
    expect(minus.value.base).toBeCloseTo(90, 6);
  });

  it('Scheitelbrechwert, Abbildung, Lupe, Keratometer, Tränenlinse', () => {
    const bv = backVertexPower(50, 0, 1.5, 5);
    expect(bv.value.S).toBeCloseTo(10 / (1 - (0.005 / 1.5) * 10), 6);
    const im = imaging(10, -200);
    expect(im.value.a2).toBeCloseTo(200, 6);
    expect(im.value.beta).toBeCloseTo(-1, 6);
    expect(magnifier(20).value).toBe(5);
    expect(keratometry(7.5).value).toBeCloseTo(45, 6);
    expect(tearLensQuick(7.7, 7.8).value).toBeCloseTo(0.336 * (1000 / 7.7 - 1000 / 7.8), 6);
    expect(tearLensQuick(7.7, 7.8).value).toBeGreaterThan(0.5);
  });

  it('Kontaktlinsenwirkung in der Simulation: Myopie + KL vollkorrigiert', () => {
    const c = computeCorrection(buildPreset('eye-contact'));
    expect(Math.abs(c.residualRx.sph)).toBeLessThan(0.1);
    expect(rxToMatrix(c.residualRx).a).toBeDefined();
  });
});
