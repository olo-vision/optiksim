import { describe, expect, it } from 'vitest';
import { thickLens, frontRadiusForBackVertexPower, backRadiusForBackVertexPower, prismMinimumDeviation } from '@/engine/physics/formulas';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { DEFAULT_EYE_ANATOMY } from '@/model/derived/eyeGeometry';
import { refract } from '@/engine/raytracing/refraction';
import { checkLensShape, sag } from '@/core/math/surfaces';
import { parseNumber, formatNumber } from '@/core/units';

describe('Einheiten', () => {
  it('parst deutsche Dezimalzahlen', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('−3,25')).toBe(-3.25);
    expect(parseNumber('abc')).toBeNull();
  });
  it('formatiert mit Dezimalkomma', () => {
    expect(formatNumber(12, 1)).toBe('12,0');
  });
});

describe('Flächen', () => {
  it('Pfeilhöhe', () => {
    expect(sag(100, 0)).toBe(0);
    expect(sag(10, 10)).toBeCloseTo(10);
    expect(sag(-50, 5)).toBeCloseTo(-(50 - Math.sqrt(2475)));
  });
  it('erkennt negative Randdicke', () => {
    const c = checkLensShape(20, -20, 1, 10);
    expect(c.warnings.length).toBeGreaterThan(0);
    expect(c.edgeThickness).toBeGreaterThan(0);
  });
});

describe('Dicke Linse', () => {
  it('bikonvex 100/−100, n=1,5, d=0 → +10 dpt', () => {
    expect(thickLens(1.5, 100, -100, 0).F).toBeCloseTo(10, 6);
  });
  it('Scheitelbrechwert-Umkehrung (Vorder- und Rückfläche)', () => {
    const R1 = frontRadiusForBackVertexPower(-3, 1.45, 7.8, 0.18);
    expect(thickLens(1.45, R1, 7.8, 0.18).backVertexPower).toBeCloseTo(-3, 6);
    const R2 = backRadiusForBackVertexPower(4, 1.5, 87, 4);
    expect(thickLens(1.5, 87, R2, 4).backVertexPower).toBeCloseTo(4, 6);
  });
  it('Prisma: Minimalablenkung 60°, n=1,5 ≈ 37,18°', () => {
    expect(prismMinimumDeviation(1.5, 60)).toBeCloseTo(37.18, 1);
  });
});

describe('Modellauge (Le Grand)', () => {
  const s = summarizeEye(DEFAULT_EYE_ANATOMY);
  it('Gesamtbrechwert ≈ 59,9 dpt', () => {
    expect(s.totalPower).toBeGreaterThan(59.5);
    expect(s.totalPower).toBeLessThan(60.5);
  });
  it('Hornhautbrechwert ≈ 42,4 dpt', () => {
    expect(s.corneaPower).toBeGreaterThan(42);
    expect(s.corneaPower).toBeLessThan(43);
  });
  it('annähernd emmetrop', () => {
    expect(Math.abs(s.refractionAtCornea)).toBeLessThan(0.25);
  });
  it('längeres Auge ist kurzsichtig', () => {
    const m = summarizeEye({ ...DEFAULT_EYE_ANATOMY, axialLength: 25.3 });
    expect(m.refractionAtCornea).toBeLessThan(-2.5);
    expect(m.defocusMm).toBeLessThan(0);
  });
});

describe('Snellius', () => {
  it('senkrechter Einfall bleibt unabgelenkt', () => {
    const r = refract([0, 0, 1], [0, 0, -1], 1, 1.5);
    expect(r.dir[2]).toBeCloseTo(1);
  });
  it('n1·sinε1 = n2·sinε2', () => {
    const a = (30 * Math.PI) / 180;
    const r = refract([Math.sin(a), 0, Math.cos(a)], [0, 0, -1], 1, 1.5);
    expect(Math.sin(a)).toBeCloseTo(1.5 * r.dir[0], 6);
  });
  it('Totalreflexion', () => {
    const a = (60 * Math.PI) / 180;
    expect(refract([Math.sin(a), 0, Math.cos(a)], [0, 0, 1], 1.5, 1).totalInternalReflection).toBe(true);
  });
});
