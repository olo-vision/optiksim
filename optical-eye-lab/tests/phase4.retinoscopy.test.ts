/**
 * Phase 4 – Skiaskopie: Reflexbewegung aus der Vergenzrechnung.
 */
import { describe, expect, it } from 'vitest';
import { buildPreset } from '@/state/presets';
import { createEmptyScene } from '@/model/sceneFactory';
import { solveEyeForRefraction } from '@/engine/physics/eyeRefraction';
import { buildReflexModel, DEFAULT_RETINOSCOPE, neutralizingLens, reflexAt, retinoscopyState, workingDistanceCorrection } from '@/engine/optics/retinoscopy';
import { createRetinoscope, createTrialLens, setTrialRx } from '@/model/instruments';
import { matrixToRx, rxToMatrix, type Rx } from '@/core/math/powerMatrix';
import { applyConstraints } from '@/model/derived/contactSeat';
import type { SceneDocument } from '@/model/types';

function eyeDoc(rx: Rx, mode: 'auto' | 'axial' | 'refractive' = 'axial'): SceneDocument {
  const doc = createEmptyScene('T');
  doc.eye = { ...doc.eye, anatomy: solveEyeForRefraction(doc.eye.anatomy, rx, mode).anatomy };
  return doc;
}

function withScope(doc: SceneDocument, w = 667, patch: Partial<typeof DEFAULT_RETINOSCOPE> = {}) {
  const s = createRetinoscope(doc, w);
  s.retinoscope = { ...s.retinoscope!, ...patch };
  return { doc: { ...doc, lights: [...doc.lights, s] }, scope: s };
}

const sph = (s: number): Rx => ({ sph: s, cyl: 0, axis: 180 });

describe('Reflexbewegung (sphärisch)', () => {
  it('Emmetropie bei 66,7 cm: Mitbewegung (Fehler = +1/w = +1,50 dpt)', () => {
    const { doc, scope } = withScope(eyeDoc(sph(0)));
    const r = retinoscopyState(doc, scope)!;
    expect(r.motion).toBe('with');
    expect(r.sweepMeridianError).toBeCloseTo(1.5, 2);
    expect(r.speed).toBeGreaterThan(0);
  });

  it('Myopie −1,50 bei 66,7 cm: Neutralisation (Fernpunkt im Guckloch)', () => {
    const { doc, scope } = withScope(eyeDoc(sph(-1.5)));
    const r = retinoscopyState(doc, scope)!;
    expect(r.motion).toBe('neutral');
    expect(Math.abs(r.sweepMeridianError)).toBeLessThan(0.02);
  });

  it('Myopie −3,00: Gegenbewegung; Hyperopie +2,00: Mitbewegung, langsamer als emmetrop', () => {
    const m3 = withScope(eyeDoc(sph(-3)));
    const my = retinoscopyState(m3.doc, m3.scope)!;
    expect(my.motion).toBe('against');
    const hy = withScope(eyeDoc(sph(2)));
    const em = withScope(eyeDoc(sph(0)));
    const rh = retinoscopyState(hy.doc, hy.scope)!;
    const re = retinoscopyState(em.doc, em.scope)!;
    expect(rh.motion).toBe('with');
    expect(rh.speed).toBeLessThan(re.speed);
  });

  it('Arbeitsabstand bestimmt den Neutralpunkt: −2,00 dpt neutral bei 50 cm', () => {
    const { doc, scope } = withScope(eyeDoc(sph(-2)), 500);
    expect(retinoscopyState(doc, scope)!.motion).toBe('neutral');
    const far = withScope(eyeDoc(sph(-2)), 667);
    expect(retinoscopyState(far.doc, far.scope)!.motion).toBe('against');
  });

  it('Reflex wird zur Neutralisation hin schneller, breiter und heller', () => {
    const rs = [-0.5, -1.0, -1.3].map((s) => {
      const { doc, scope } = withScope(eyeDoc(sph(s)));
      return retinoscopyState(doc, scope)!;
    });
    expect(rs[1].speed).toBeGreaterThan(rs[0].speed);
    expect(rs[2].speed).toBeGreaterThan(rs[1].speed);
    expect(rs[2].bandWidth).toBeGreaterThan(rs[0].bandWidth);
    expect(rs[2].brightness).toBeGreaterThanOrEqual(rs[0].brightness);
  });

  it('Skalare Kontrollformel k = (d/s)/(1 + w·R)', () => {
    const w = 0.667;
    const R = 2;
    const m = buildReflexModel({ E: rxToMatrix(sph(R + 1 / w)), workingDistanceMm: 667, pupilDiameterMm: 5, params: { ...DEFAULT_RETINOSCOPE } });
    const d = DEFAULT_RETINOSCOPE.sourceDistance / 1000;
    expect(m.speed).toBeCloseTo(d / (w + d) / (1 + w * R), 6);
  });

  it('Konkavspiegel kehrt die Bewegung um', () => {
    const { doc, scope } = withScope(eyeDoc(sph(0)), 667, { sleeve: 'concave', sourceDistance: 200 });
    expect(retinoscopyState(doc, scope)!.motion).toBe('against');
  });

  it('Reflexband wandert mit dem Schwenk (Mitbewegung: gleiche Richtung)', () => {
    const base = withScope(eyeDoc(sph(0)), 667, { streakAxis: 90, sweep: 0 });
    const moved = withScope(eyeDoc(sph(0)), 667, { streakAxis: 90, sweep: 1 });
    const r0 = retinoscopyState(base.doc, base.scope)!;
    const r1 = retinoscopyState(moved.doc, moved.scope)!;
    // Strich 90° → Schwenk entlang 180°/0° (x-Richtung)
    const along = (r: typeof r0) => (r.offset * (r.g[0] * r.m[0] + r.g[1] * r.m[1])) / Math.hypot(r.g[0], r.g[1]);
    expect(along(r1)).toBeGreaterThan(along(r0));
    expect(along(r1)).toBeGreaterThan(0);
    // Reflex leuchtet an der erwarteten Stelle
    const cx = r1.offset * (r1.g[0] / Math.hypot(...r1.g));
    expect(reflexAt(r1, cx, 0, 0.01)).toBeGreaterThan(0);
    const lit = (r: typeof r0, x: number) => reflexAt(r, x, 0, 0.01);
    expect(lit(r0, 0)).toBeGreaterThan(0);
  });
});

describe('Astigmatismus: Hauptschnitte, Break und Skew', () => {
  const astig: Rx = { sph: -1.0, cyl: -2.0, axis: 30 };

  it('Hauptmeridiane entsprechen der Refraktion (+1/w)', () => {
    const { doc, scope } = withScope(eyeDoc(astig, 'auto'));
    const r = retinoscopyState(doc, scope)!;
    const errs = r.principal.map((p) => p.error).sort((a, b) => a - b);
    expect(errs[0]).toBeCloseTo(-3 + 1.5, 1);
    expect(errs[1]).toBeCloseTo(-1 + 1.5, 1);
    const withM = r.principal.find((p) => p.motion === 'with')!;
    const againstM = r.principal.find((p) => p.motion === 'against')!;
    expect(withM.meridian).toBeCloseTo(30, 0);
    expect(againstM.meridian).toBeCloseTo(120, 0);
  });

  it('Strich im Hauptschnitt: kein Skew; schräg dazu: Break/Skew', () => {
    const inMer = withScope(eyeDoc(astig, 'auto'), 667, { streakAxis: 30 });
    const oblique = withScope(eyeDoc(astig, 'auto'), 667, { streakAxis: 75 });
    expect(retinoscopyState(inMer.doc, inMer.scope)!.skew).toBeLessThan(0.5);
    expect(retinoscopyState(oblique.doc, oblique.scope)!.skew).toBeGreaterThan(5);
  });
});

describe('Neutralisation mit Messglas und Arbeitsabstandskorrektur', () => {
  it('berechnetes Neutralisationsglas neutralisiert beide Hauptschnitte', () => {
    const rx: Rx = { sph: 1.25, cyl: -1.5, axis: 170 };
    const base = eyeDoc(rx, 'auto');
    const A = rxToMatrix(rx);
    const F = matrixToRx(neutralizingLens(A, 667, 12), 'minus');
    let doc = applyConstraints({ ...base, elements: [createTrialLens(base, F, 12)] });
    const { doc: d2, scope } = withScope(doc, 667);
    const r = retinoscopyState(d2, scope)!;
    expect(r.principal.every((p) => p.motion === 'neutral')).toBe(true);
    // Brutto − 1/(w − HSA) = Refraktion in der Brillenglasebene
    const net = workingDistanceCorrection(F, 667, 12).net;
    const specRx = matrixToRx(rxToMatrix(F), 'minus');
    expect(net.sph).toBeCloseTo(specRx.sph - 1000 / 655, 6);
    // Nachstellen des Glases (setTrialRx) behält den HSA
    doc = { ...doc, elements: [setTrialRx(doc, doc.elements[0] as never, { sph: 0, cyl: 0, axis: 180 })] };
    expect(retinoscopyState({ ...doc, lights: d2.lights }, scope)!.principal.some((p) => p.motion !== 'neutral')).toBe(true);
  });

  it('Pupillengröße ändert Reflexbreite, nicht die Bewegungsrichtung', () => {
    const { doc, scope } = withScope(eyeDoc(sph(-3)));
    const small = retinoscopyState(doc, scope, 2)!;
    const large = retinoscopyState(doc, scope, 7)!;
    expect(small.motion).toBe(large.motion);
    expect(large.bandWidth).toBeGreaterThan(small.bandWidth);
  });

  it('bestehende Demo-Szene bleibt unverändert nutzbar', () => {
    const doc = buildPreset('myopia');
    const { doc: d2, scope } = withScope(doc, 333);
    expect(retinoscopyState(d2, scope)!.motion).toBe('neutral');
  });
});
