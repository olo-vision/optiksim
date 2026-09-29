/**
 * Phase 5 – Modul-Registry: jedes aktive Modul hat einen Arbeitsbereich und eine gültige Startszene.
 */
import { describe, expect, it } from 'vitest';
import { activeModules, findModule, MODULES, moduleForWorkbench } from '@/modules/registry';
import { migrateDocument } from '@/state/persistence';
import { computeCorrection } from '@/engine/physics/correction';
import { resolveLensShape } from '@/model/derived/elementShape';
import type { LensElement } from '@/model/types';

describe('Modul-Registry', () => {
  it('IDs eindeutig, Arbeitsbereiche eindeutig', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const wbs = activeModules().map((m) => m.workbench);
    expect(new Set(wbs).size).toBe(wbs.length);
  });

  it('aktive Module: Arbeitsbereich + Startszene mit gesetztem Arbeitsbereich, speicher-/ladbar', () => {
    for (const m of activeModules()) {
      expect(m.workbench, m.id).toBeTruthy();
      expect(m.createScene, m.id).toBeTypeOf('function');
      const doc = m.createScene!();
      expect(doc.display.workbench, m.id).toBe(m.workbench);
      const again = migrateDocument(JSON.parse(JSON.stringify(doc)))!;
      expect(again.display.workbench).toBe(m.workbench);
      expect(() => computeCorrection(again)).not.toThrow();
      expect(moduleForWorkbench(m.workbench)?.id).toBe(m.id);
    }
  });

  it('geplante Module sind deaktiviert (kein Arbeitsbereich, keine Startszene)', () => {
    for (const m of MODULES.filter((x) => x.status === 'planned')) {
      expect(m.workbench).toBeUndefined();
      expect(m.createScene).toBeUndefined();
    }
    expect(findModule('slit-lamp')?.status).toBe('planned');
  });

  it('Modul „Brillenglas“: Startszene mit automatischer Glasdicke', () => {
    const doc = findModule('spectacle-lens')!.createScene!();
    const lens = doc.elements.find((e): e is LensElement => e.family === 'lens' && e.kind === 'spectacle-lens')!;
    expect(lens.lens.thicknessMode).toBe('auto');
    // Minusglas → Mittendicke = Mindestmittendicke des Materials (ADC 2,0 mm)
    expect(resolveLensShape(lens).centerThickness).toBeCloseTo(2, 3);
    expect(Math.abs(computeCorrection(doc).residualRx.sph)).toBeLessThan(0.06);
  });
});
