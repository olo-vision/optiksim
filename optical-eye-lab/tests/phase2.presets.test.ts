import { describe, expect, it } from 'vitest';
import { SCENE_PRESETS, buildPreset } from '@/state/presets';
import { traceScene } from '@/engine/raytracing';
import { computeCorrection } from '@/engine/physics/correction';
import { migrateDocument } from '@/state/persistence';
import { SCHEMA_VERSION } from '@/model/types';

describe('Demo-Szenen', () => {
  for (const p of SCENE_PRESETS) {
    it(`${p.name}: baut, verfolgt Strahlen, Korrektion berechenbar`, () => {
      const doc = buildPreset(p.id);
      const r = traceScene(doc);
      expect(r.stats.retina).toBeGreaterThan(0);
      expect(() => computeCorrection(doc)).not.toThrow();
    });
  }
  it('Vollkorrigierte Szenen: Restrefraktion ≈ 0', () => {
    for (const id of ['eye-spectacle', 'eye-contact', 'rgp-tear-lens']) {
      const c = computeCorrection(buildPreset(id));
      expect(Math.abs(c.residualRx.sph), id).toBeLessThan(0.06);
      expect(Math.abs(c.residualRx.cyl), id).toBeLessThan(0.06);
    }
  });
  it('HSA-Demo zeigt Restrefraktion', () => {
    expect(Math.abs(computeCorrection(buildPreset('hsa-change')).residualRx.sph)).toBeGreaterThan(0.3);
  });
});

describe('Migration', () => {
  it('Phase-1-Dokument (v1) mit aufgesetzter KL wird migriert', () => {
    const v1 = {
      schemaVersion: 1, id: 's', name: 'Alt', createdAt: '', updatedAt: '',
      eye: { entityType: 'eye', id: 'eye', name: 'Auge', visible: true, locked: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        anatomy: { corneaFrontRadius: 7.8, corneaBackRadius: 6.5, corneaThickness: 0.55, corneaDiameter: 11.8, nCornea: 1.3771, anteriorChamberDepth: 3.6, nAqueous: 1.3374, lensFrontRadius: 10.2, lensBackRadius: -6, lensThickness: 4, lensDiameter: 9, nLens: 1.42, axialLength: 25.3, nVitreous: 1.336, pupilDiameter: 4, globeRadius: 12 },
        viewMode: 'normal', irisColor: '#4f7a96', showLabels: true, physics: {} },
      elements: [{ entityType: 'element', id: 'cl', name: 'KL', visible: true, locked: false, kind: 'rigid-contact-lens', family: 'lens',
        transform: { position: [0, 0, -0.1], rotation: [0, 0, 0], scale: [1, 1, 1] }, medium: { presetId: 'rgp', n: 1.45 },
        appearance: { tint: '#fff', transparency: 0.9, finish: 'clear' }, physics: {},
        lens: { diameter: 9.6, centerThickness: 0.18, frontRadius: 8.28, backRadius: 7.8, outline: 'round', width: 50, height: 40 },
        contact: { design: 'rigid', tearFilmThickness: 0.01 } }],
      lights: [{ entityType: 'light', id: 'l', name: 'L', visible: true, locked: false, transform: { position: [0, 0, -60], rotation: [0, 0, 0], scale: [1, 1, 1] },
        source: { kind: 'parallel', beamDiameter: 6, rayCount: 13, wavelength: 587.6, color: '#ffd27a', sagittal: false } }],
      measurePoints: [], environment: {}, display: {},
    };
    const doc = migrateDocument(v1)!;
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    const cl = doc.elements[0] as any;
    expect(cl.contact.onEye).toBe(true);
    expect(cl.contact.tearFilm).toBe(true);
    expect(cl.lens.backRadius).toBe(7.8);
    expect(doc.lights[0].source.fanMode).toBe('principal');
    expect(doc.eye.ametropiaMode).toBe('auto');
    expect(traceScene(doc).stats.retina).toBeGreaterThan(0);
  });
  it('v2-Dokument bleibt unverändert ladbar', () => {
    const doc = buildPreset('astig-correction');
    const again = migrateDocument(JSON.parse(JSON.stringify(doc)))!;
    expect(again.eye.anatomy.corneaFrontRadius2).toBeCloseTo(doc.eye.anatomy.corneaFrontRadius2!, 9);
    expect((again.elements[0] as any).lens.backRadius2).toBeCloseTo((doc.elements[0] as any).lens.backRadius2, 9);
  });
});
