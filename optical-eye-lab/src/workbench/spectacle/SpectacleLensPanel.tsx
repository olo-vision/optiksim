/**
 * Arbeitsbereich / Modul „Brillenglas“ (Phase 5).
 *
 * Alle Größen stammen aus der zentralen Geometrie (engine/physics/lensThickness.ts, lensEdit.ts):
 *  - Querschnitte in wahrem Maßstab (keine Überhöhung) durch den optischen Mittelpunkt
 *  - Formscheibe (Untersucheransicht) mit optischem Mittelpunkt, Kastenmitte, dünnster/dickster Randstelle
 *  - Materialvergleich: dasselbe Rezept, dieselbe Basiskurve, dieselbe Form – nur das Material wechselt
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { LensElement, LensOutline, LensParams, MediumRef, SceneDocument } from '@/model/types';
import { useAppStore } from '@/state/store';
import { createElement, placeAtVertexDistance } from '@/model/sceneFactory';
import { findMaterial, materialsForElement } from '@/model/media';
import { lensOutlineFn, lensSurfaces, resolveLensShape } from '@/model/derived/elementShape';
import { placementOf } from '@/model/derived/measurements';
import { designLensForRx, lensOptics } from '@/engine/physics/lensOptics';
import { editLens, type LensChange } from '@/engine/physics/lensEdit';
import { edgeProfile, lensMassProperties } from '@/engine/physics/lensThickness';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { refractionAtVertex } from '@/engine/optics/calculators';
import { formatRx } from '@/engine/physics/explain';
import { sagXY } from '@/core/math/surfaces';
import { formatNumber } from '@/core/units';
import type { Rx } from '@/core/math/powerMatrix';
import { MaterialReadouts, MaterialSelect } from '@/ui/inspector/MaterialFields';
import { LensThicknessFields } from '@/ui/inspector/LensThicknessFields';
import { Readout, Stepper, TrialLensControls } from '../common';

const HSA = 12;

/** Bearbeitetes Glas: ausgewähltes Brillenglas, sonst das erste (kein Messglas) */
function useSpectacleLens(): { doc: SceneDocument; el: LensElement | null } {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const lenses = doc.elements.filter((e): e is LensElement => e.family === 'lens' && e.kind === 'spectacle-lens' && e.role !== 'trial');
  const el = lenses.find((e) => e.id === selectedId) ?? lenses[0] ?? null;
  return { doc, el };
}

function commit(el: LensElement, change: LensChange, mode: 'optical' | 'geometry' = 'optical') {
  const s = useAppStore.getState();
  const r = editLens(el, change, mode);
  if (!r.ok) {
    s.notify(r.notes[0] ?? 'Nicht realisierbar', 'warning');
    return;
  }
  s.commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? r.el : e)) }));
}

export function SpectacleLensPanel() {
  const { doc, el } = useSpectacleLens();
  if (!el) return <InsertLens doc={doc} />;
  return <LensWorkbench key={el.id} el={el} doc={doc} />;
}

function InsertLens({ doc }: { doc: SceneDocument }) {
  return (
    <div className="wb-empty">
      <p>Für dieses Modul wird ein Brillenglas vor dem Auge benötigt.</p>
      <button
        type="button"
        className="btn btn--accent"
        data-testid="add-spectacle"
        onClick={() => {
          const s = useAppStore.getState();
          const A = eyeRefractionState(doc.eye.anatomy).matrix;
          let el = createElement('spectacle-lens', doc) as LensElement;
          el = { ...el, lens: designLensForRx(el, refractionAtVertex(A, HSA)).lens };
          el = placeAtVertexDistance(el, doc, HSA);
          s.commit((d) => ({ ...d, elements: [...d.elements, el] }));
          s.select(el.id);
        }}
      >
        <Plus size={14} /> Vollkorrigierendes Glas einsetzen (HSA {HSA} mm)
      </button>
    </div>
  );
}

const OUTLINES: Array<{ id: LensOutline; label: string }> = [
  { id: 'round', label: 'Rund' },
  { id: 'oval', label: 'Oval' },
  { id: 'rect', label: 'Rechteckig' },
];

function LensWorkbench({ el, doc }: { el: LensElement; doc: SceneDocument }) {
  const expert = useAppStore((s) => s.prefs.expertMode);
  const locked = el.locked;
  const optics = useMemo(() => lensOptics(el), [el]);
  const shape = resolveLensShape(el);
  const mass = useMemo(() => lensMassProperties(el, shape.centerThickness), [el, shape.centerThickness]);
  const p = el.lens;
  const hsa = placementOf(doc.eye, el).vertexDistance;
  const eyeA = eyeRefractionState(doc.eye.anatomy).matrix;
  const fullRx = refractionAtVertex(eyeA, hsa);
  const frontPower = (1000 * (el.medium.n - 1)) / (p.frontRadius || Infinity);
  const [compareN, setCompareN] = useState<number | null>(el.medium.n < 1.6 ? 1.74 : 1.5);

  const setRx = (rx: Rx) => commit(el, { rx });
  const setPatch = (patch: Partial<LensParams>) => commit(el, { patch });
  const setMedium = (m: MediumRef) => commit(el, { medium: m });

  return (
    <div className="wb-panel wb-panel--spectacle">
      <section className="wb-col wb-col--view">
        <LensProfiles el={el} compareN={compareN} />
        <div className="wb-chips" role="group" aria-label="Vergleichsglas">
          <span className="wb-chips__label">Vergleich (gestrichelt):</span>
          {[null, 1.5, 1.6, 1.67, 1.74].map((n) => (
            <button key={String(n)} type="button" className={`chip${compareN === n ? ' is-on' : ''}`} onClick={() => setCompareN(n)} data-testid={`compare-n-${n ?? 'off'}`}>
              {n === null ? 'aus' : `n ${formatNumber(n, 2)}`}
            </button>
          ))}
        </div>
        <p className="wb-hint">Querschnitte durch den optischen Mittelpunkt in wahrem Maßstab. Licht von links; links Vorderfläche (Basiskurve), rechts augenseitige Rückfläche.</p>
      </section>

      <section className="wb-col">
        <TrialLensControls rx={optics.rx} onChange={setRx} disabled={locked} title="Wirkung (Scheitelbrechwert S'∞)" testPrefix="spec" />
        <div className="wb-row">
          <button type="button" className="btn btn--ghost btn--xs" disabled={locked} onClick={() => setRx(fullRx)} data-tip={`Vollkorrektion für dieses Auge im HSA ${formatNumber(hsa, 1)} mm`}>
            Vollkorrektion {formatRx(fullRx)}
          </button>
        </div>
        <div className="wb-group">
          <div className="wb-group__title">Basiskurve (Vorderfläche)</div>
          <Stepper label="Radius r₁" value={p.frontRadius} step={5} bigStep={25} min={30} max={2000} decimals={1} unit="mm" signed={false} onChange={(v) => setPatch({ frontRadius: v, frontRadius2: undefined, frontAxis: undefined })} disabled={locked} testId="spec-base" />
          <Readout label="Flächenbrechwert F₁" value={`${formatNumber(frontPower, 2)} dpt`} hint="F₁ = (n − 1) / r₁" />
        </div>
        <div className="wb-group">
          <div className="wb-group__title">Material</div>
          <div data-testid="spec-material">
            <MaterialSelect el={el} disabled={locked} onChange={setMedium} />
          </div>
          <MaterialReadouts el={el} />
        </div>
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">Formscheibe</div>
          <div className="wb-chips">
            {OUTLINES.map((o) => (
              <button key={o.id} type="button" className={`chip${p.outline === o.id ? ' is-on' : ''}`} disabled={locked} onClick={() => setPatch({ outline: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
          {p.outline === 'round' ? (
            <Stepper label="Durchmesser" value={p.diameter} step={1} bigStep={5} min={20} max={80} decimals={0} unit="mm" signed={false} onChange={(v) => setPatch({ diameter: v })} disabled={locked} testId="spec-diameter" />
          ) : (
            <>
              <Stepper label="Breite" value={p.width} step={1} bigStep={5} min={20} max={80} decimals={0} unit="mm" signed={false} onChange={(v) => setPatch({ width: v })} disabled={locked} testId="spec-width" />
              <Stepper label="Höhe" value={p.height} step={1} bigStep={5} min={15} max={70} decimals={0} unit="mm" signed={false} onChange={(v) => setPatch({ height: v })} disabled={locked} testId="spec-height" />
            </>
          )}
        </div>
        <div className="wb-group" data-testid="spec-thickness">
          <div className="wb-group__title">Dicke & Zentrierung</div>
          <LensThicknessFields el={el} disabled={locked} onPatch={setPatch} compact={false} />
        </div>
      </section>

      <section className="wb-col">
        <div className="wb-group" data-testid="spec-result">
          <div className="wb-group__title">Ergebnis</div>
          <Readout label="Mittendicke" value={`${formatNumber(shape.centerThickness, 2)} mm`} tone="accent" />
          <Readout label="Randdicke min / max" value={`${formatNumber(mass.edgeMin, 2)} / ${formatNumber(mass.edgeMax, 2)} mm`} />
          <Readout label="Gewicht" value={mass.mass !== null ? `${formatNumber(mass.mass, 1)} g` : '–'} hint="Volumen aus der Geometrie × Dichte des Materials" />
          <Readout label="Wirkung" value={formatRx(optics.rx)} />
          {expert && <Readout label="Flächen F₁ / F₂ (HS 1)" value={`${formatNumber(frontPower, 2)} / ${formatNumber((1000 * (1 - el.medium.n)) / (p.backRadius || Infinity), 2)} dpt`} />}
        </div>
        <MaterialComparison el={el} onPick={setMedium} />
      </section>
    </div>
  );
}

/* -------------------------------- Querschnitte -------------------------------- */

interface Section {
  pts: Array<[number, number]>; // [z, s] Kontur (geschlossen)
}

/** Querschnitt entlang der lokalen Richtung φ (rad) durch den optischen Mittelpunkt. */
function crossSection(el: LensElement, phi: number, t: number): Section {
  const { front, back } = lensSurfaces(el);
  const out = lensOutlineFn(el);
  const rPos = out(phi);
  const rNeg = out(phi + Math.PI);
  const N = 60;
  const at = (s: number) => [s * Math.cos(phi), s * Math.sin(phi)] as const;
  const frontPts: Array<[number, number]> = [];
  const backPts: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const s = -rNeg + ((rPos + rNeg) * i) / N;
    const [x, y] = at(s);
    frontPts.push([-t / 2 + sagXY(front, x, y), s]);
    backPts.push([t / 2 + sagXY(back, x, y), s]);
  }
  return { pts: [...frontPts, ...backPts.reverse()] };
}

/** Querschnitte in wahrem Maßstab (mm) – horizontal und vertikal, optional Vergleich mit anderem Index. */
function LensProfiles({ el, compareN }: { el: LensElement; compareN: number | null }) {
  const t = resolveLensShape(el).centerThickness;
  const cmp = useMemo(() => {
    if (compareN === null || Math.abs(compareN - el.medium.n) < 1e-3) return null;
    const alt = { ...el, medium: { ...el.medium, n: compareN } };
    const lens = designLensForRx(alt, lensOptics(el).rx).lens;
    const e2 = { ...alt, lens };
    return { el: e2, t: resolveLensShape(e2).centerThickness };
  }, [el, compareN]);
  // TABO 0° = lokal −X: horizontaler Schnitt entlang φ = π (0° TABO) … φ = 0 (180° TABO); vertikal φ = π/2
  const sections = [
    { title: 'Horizontal 0°–180°', phi: Math.PI },
    { title: 'Vertikal 90°–270°', phi: Math.PI / 2 },
  ];
  const all = sections.flatMap((s) => [crossSection(el, s.phi, t), ...(cmp ? [crossSection(cmp.el, s.phi, cmp.t)] : [])]);
  const zMin = Math.min(...all.flatMap((c) => c.pts.map((p) => p[0])));
  const zMax = Math.max(...all.flatMap((c) => c.pts.map((p) => p[0])));
  const sMax = Math.max(...all.flatMap((c) => c.pts.map((p) => Math.abs(p[1]))));
  const pad = 2;
  const W = zMax - zMin + 2 * pad;
  const H = 2 * sMax + 2 * pad;
  const path = (c: Section) => c.pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - zMin + pad).toFixed(3)},${(sMax + pad - p[1]).toFixed(3)}`).join(' ') + ' Z';
  const edge = edgeProfile(lensSurfaces(el).front, lensSurfaces(el).back, lensOutlineFn(el));
  return (
    <div className="lens-profiles" data-testid="lens-profiles">
      {sections.map((s) => (
        <figure key={s.title} className="lens-profile">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Querschnitt ${s.title}`}>
            <line x1={0} x2={W} y1={sMax + pad} y2={sMax + pad} className="lens-profile__axis" />
            {cmp && <path d={path(crossSection(cmp.el, s.phi, cmp.t))} className="lens-profile__cmp" />}
            <path d={path(crossSection(el, s.phi, t))} className="lens-profile__glass" />
            {/* Maßstab 10 mm */}
            <line x1={pad * 0.5} x2={pad * 0.5} y1={H - pad * 0.5} y2={H - pad * 0.5 - 10} className="lens-profile__scale" />
          </svg>
          <figcaption>
            {s.title} <span>· maßstabsgetreu (Balken = 10 mm)</span>
          </figcaption>
        </figure>
      ))}
      <p className="wb-hint">
        Dünnste Randstelle bei {formatNumber(taboDeg(edge.thinPhi), 0)}°, dickste bei {formatNumber(taboDeg(edge.thickPhi), 0)}° (TABO).
        {cmp && ` Gleiches Glas mit n = ${formatNumber(compareN ?? 0, 2)}: Mitte ${formatNumber(cmp.t, 2)} mm, Rand max ${formatNumber(lensMassProperties(cmp.el, cmp.t).edgeMax, 2)} mm.`}
      </p>
    </div>
  );
}

/** lokaler Polarwinkel → TABO-Grad (TABO 0° = lokal −X) */
function taboDeg(phi: number) {
  const d = ((180 - (phi * 180) / Math.PI) % 360 + 360) % 360;
  return d;
}

/* ------------------------------ Materialvergleich ------------------------------ */

/** „Standard-Kunststoff (ADC) 1,50“ → „Standard-Kunststoff“ (Index steht in eigener Spalte) */
const shortName = (name: string) => name.replace(/\s*\(.*\)/, '').replace(/\s*\d[,.]\d+.*$/, '');

function MaterialComparison({ el, onPick }: { el: LensElement; onPick: (m: MediumRef) => void }) {
  const rows = useMemo(() => {
    const rx = lensOptics(el).rx;
    return materialsForElement(el.kind)
      .filter((m) => m.category === 'spectacle')
      .map((m) => {
        const alt: LensElement = { ...el, medium: { presetId: m.id, n: m.n, abbe: m.abbe } };
        const r = designLensForRx(alt, rx);
        if (!r.ok) return { m, ok: false as const };
        const e2 = { ...alt, lens: r.lens };
        const t = resolveLensShape(e2).centerThickness;
        const mp = lensMassProperties(e2, t);
        return { m, ok: true as const, t, edgeMax: mp.edgeMax, mass: mp.mass };
      });
  }, [el]);
  const current = findMaterial(el.medium.presetId)?.id;
  return (
    <div className="wb-group" data-testid="material-comparison">
      <div className="wb-group__title">Materialvergleich (gleiche Wirkung, Basiskurve, Form)</div>
      <div className="mat-table-wrap">
      <table className="mat-table">
        <thead>
          <tr>
            <th>Material</th>
            <th>n</th>
            <th>Mitte</th>
            <th>Rand max</th>
            <th>g</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m.id} className={r.m.id === current ? 'is-current' : undefined} onClick={() => onPick({ presetId: r.m.id, n: r.m.n, abbe: r.m.abbe })} title={`${r.m.name} – Abbe ${r.m.abbe ?? '–'}`}>
              <td className="mat-table__name">{shortName(r.m.name)}</td>
              <td>{formatNumber(r.m.n, 3)}</td>
              {r.ok ? (
                <>
                  <td>{formatNumber(r.t, 2)}</td>
                  <td>{formatNumber(r.edgeMax, 2)}</td>
                  <td>{r.mass !== null ? formatNumber(r.mass, 1) : '–'}</td>
                </>
              ) : (
                <td colSpan={3}>nicht realisierbar</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="wb-hint">Mindestmittendicke je Material (Richtwert), sofern nicht oben fest eingestellt. Zeile anklicken, um das Material zu übernehmen.</p>
    </div>
  );
}
