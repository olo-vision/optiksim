import { describe, expect, it } from 'vitest';
import {
  rxToMatrix, matrixToRx, transposeRx, toCylForm, principalMeridians, powerInMeridian, rotateMatrix,
  effectivityMatrix, backVertexMatrix, frontMatrixForBackVertex, backMatrixForBackVertex, rxEquals, normalizeAxis,
} from '@/core/math/powerMatrix';
import { curvatureMatrix, specFromCurvatureMatrix, sagXY, radiusInMeridian, surfacePowerMatrix } from '@/core/math/surfaces';
import { effectivePower, thickLens } from '@/engine/physics/formulas';

const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

describe('Sph/Cyl/Achse', () => {
  it('Matrix ↔ Rezept (Minuszylinder)', () => {
    const rx = { sph: -3, cyl: -1.75, axis: 134 };
    const back = matrixToRx(rxToMatrix(rx), 'minus');
    close(back.sph, -3); close(back.cyl, -1.75); close(back.axis, 134);
  });
  it('Transposition -3,00/-1,75 A134 = -4,75/+1,75 A44', () => {
    const t = transposeRx({ sph: -3, cyl: -1.75, axis: 134 });
    close(t.sph, -4.75); close(t.cyl, 1.75); close(t.axis, 44);
    expect(rxEquals(t, { sph: -3, cyl: -1.75, axis: 134 })).toBe(true);
  });
  it('Plus-Schreibweise aus Matrix', () => {
    const p = matrixToRx(rxToMatrix({ sph: -3, cyl: -1.75, axis: 134 }), 'plus');
    close(p.sph, -4.75); close(p.cyl, 1.75); close(p.axis, 44);
  });
  it('Pluszylinder +1,50/+0,75 A90 ↔ +2,25/−0,75 A180', () => {
    const m = toCylForm({ sph: 1.5, cyl: 0.75, axis: 90 }, 'minus');
    close(m.sph, 2.25); close(m.cyl, -0.75); expect(m.axis).toBe(180);
  });
  it('Hauptschnitte', () => {
    const [a, b] = principalMeridians({ sph: -3, cyl: -1.75, axis: 134 });
    expect(a).toEqual({ meridian: 134, power: -3 });
    expect(b.meridian).toBe(44); close(b.power, -4.75);
  });
  it('Wirkung in beliebigem Meridian', () => {
    const rx = { sph: -3, cyl: -1.75, axis: 134 };
    close(powerInMeridian(rx, 134), -3); close(powerInMeridian(rx, 44), -4.75);
    close(powerInMeridian(rx, 89), -3.875);
  });
  it('Achsen normalisieren (0 → 180)', () => {
    expect(normalizeAxis(0)).toBe(180); expect(normalizeAxis(-10)).toBe(170); expect(normalizeAxis(225)).toBe(45);
  });
  it('Achsenrotation: Drehung um ψ addiert ψ zur Achse', () => {
    const r = matrixToRx(rotateMatrix(rxToMatrix({ sph: 1, cyl: -2, axis: 30 }), 20));
    close(r.axis, 50); close(r.sph, 1); close(r.cyl, -2);
  });
});

describe('Effektivität & dicke Linse (Matrix)', () => {
  it('HSA: sphärisch identisch zu effectivePower', () => {
    const e = effectivityMatrix(rxToMatrix({ sph: -3, cyl: 0, axis: 180 }), 12);
    close(e.a, effectivePower(-3, 12)); close(e.a, -3 / (1 + 0.036));
  });
  it('HSA: Zylinder je Hauptschnitt', () => {
    const r = matrixToRx(effectivityMatrix(rxToMatrix({ sph: -3, cyl: -1.75, axis: 134 }), 12));
    close(r.sph, effectivePower(-3, 12)); close(r.sph + r.cyl, effectivePower(-4.75, 12)); close(r.axis, 134);
  });
  it('Scheitelbrechwert-Matrix = thickLens für sphärische Flächen', () => {
    const F1 = surfacePowerMatrix({ R: 87 }, 1, 1.5);
    const F2 = surfacePowerMatrix({ R: 133.3 }, 1.5, 1);
    close(backVertexMatrix(F1, F2, 3.5, 1.5).a, thickLens(1.5, 87, 133.3, 3.5).backVertexPower);
  });
  it('Lösung Vorder-/Rückfläche torisch', () => {
    const T = rxToMatrix({ sph: -3, cyl: -1.75, axis: 134 });
    const F1 = surfacePowerMatrix({ R: 250 }, 1, 1.5);
    const F2 = backMatrixForBackVertex(T, F1, 2, 1.5);
    const S = backVertexMatrix(F1, F2, 2, 1.5);
    expect(rxEquals(matrixToRx(S), { sph: -3, cyl: -1.75, axis: 134 }, 1e-6)).toBe(true);
    const Fb = surfacePowerMatrix({ R: 7.8 }, 1.45, 1);
    const Ff = frontMatrixForBackVertex(T, Fb, 0.2, 1.45);
    expect(rxEquals(matrixToRx(backVertexMatrix(Ff, Fb, 0.2, 1.45)), { sph: -3, cyl: -1.75, axis: 134 }, 1e-6)).toBe(true);
  });
});

describe('Torische Flächen', () => {
  const s = { R: 7.8, R2: 7.4, axis: 134 };
  it('Krümmungsmatrix ↔ Fläche', () => {
    const back = specFromCurvatureMatrix(curvatureMatrix(s));
    const r = [back.R, back.R2!].sort();
    close(r[0], 7.4); close(r[1], 7.8);
    close(radiusInMeridian(back, 134), 7.8); close(radiusInMeridian(back, 44), 7.4);
  });
  it('Pfeilhöhe in den Hauptschnitten entspricht der Kugel mit dem jeweiligen Radius', () => {
    // TABO 134° in lokalen Koordinaten: (−cos134, sin134)
    const h = 3; const a = (134 * Math.PI) / 180;
    close(sagXY(s, -Math.cos(a) * h, Math.sin(a) * h), 7.8 - Math.sqrt(7.8 ** 2 - 9), 9);
    const b = (44 * Math.PI) / 180;
    close(sagXY(s, -Math.cos(b) * h, Math.sin(b) * h), 7.4 - Math.sqrt(7.4 ** 2 - 9), 9);
  });
});
