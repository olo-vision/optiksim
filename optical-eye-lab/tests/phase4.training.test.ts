/**
 * Phase 4 – Schema-Migration v2 → v3 und fallbasiertes Training.
 */
import { describe, expect, it } from 'vitest';
import { migrateDocument } from '@/state/persistence';
import { createEmptyScene } from '@/model/sceneFactory';
import { SCHEMA_VERSION } from '@/model/types';
import { applyCase, evaluateCase, generateCase } from '@/engine/optics/training';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { matrixToRx } from '@/core/math/powerMatrix';
import { refractionAtVertex } from '@/engine/optics/calculators';

describe('Migration Schema v2 → v3', () => {
  it('hebt ein v2-Dokument an und setzt den Arbeitsbereich „frei“', () => {
    const v2 = JSON.parse(JSON.stringify(createEmptyScene('Alt')));
    v2.schemaVersion = 2;
    delete v2.display.workbench;
    const out = migrateDocument(v2)!;
    expect(SCHEMA_VERSION).toBe(3);
    expect(out.schemaVersion).toBe(3);
    expect(out.display.workbench).toBe('free');
    expect(out.training).toBeUndefined();
  });

  it('lässt ein v3-Dokument mit Arbeitsbereich unverändert', () => {
    const v3 = createEmptyScene('Neu');
    v3.display = { ...v3.display, workbench: 'retinoscopy' };
    expect(migrateDocument(JSON.parse(JSON.stringify(v3)))!.display.workbench).toBe('retinoscopy');
  });
});

describe('Trainingsfälle', () => {
  it('erzeugt reproduzierbare Fälle (gleicher Seed → gleicher Fall)', () => {
    expect(generateCase('mixed', 42)).toEqual(generateCase('mixed', 42));
    const m = generateCase('myopia', 7);
    expect(m.rx.sph).toBeLessThan(0);
    expect(m.rx.cyl).toBe(0);
    expect(generateCase('hyperopia', 7).rx.sph).toBeGreaterThan(0);
  });

  it('stellt das Auge auf die Fallrefraktion ein, verbirgt Werte und entfernt Messgläser', () => {
    const c = generateCase('astigmatism', 11);
    const doc = applyCase(createEmptyScene('T'), c, 500);
    const rx = matrixToRx(eyeRefractionState(doc.eye.anatomy).matrix, 'minus');
    expect(rx.sph).toBeCloseTo(c.rx.sph, 1);
    expect(rx.cyl).toBeCloseTo(c.rx.cyl, 1);
    expect(doc.training?.hidden).toBe(true);
    expect(doc.training?.workingDistance).toBe(500);
    expect(doc.display.showRays).toBe(false);
    expect(doc.elements.some((e) => e.family === 'lens' && e.role === 'trial')).toBe(false);
  });

  it('bewertet die exakte Lösung als „sehr gut“ und große Abweichungen als „deutlich“', () => {
    const doc = applyCase(createEmptyScene('T'), generateCase('myopia', 3));
    const truth = refractionAtVertex(eyeRefractionState(doc.eye.anatomy).matrix, 12);
    const exact = evaluateCase(doc, truth, 12);
    expect(exact.grade).toBe('excellent');
    expect(exact.error).toBeLessThan(0.01);
    const off = evaluateCase(doc, { ...truth, sph: truth.sph + 2 }, 12);
    expect(off.grade).toBe('poor');
    expect(off.error).toBeCloseTo(2, 5);
    expect(off.steps.length).toBeGreaterThanOrEqual(4);
  });
});
