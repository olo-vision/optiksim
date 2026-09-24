/**
 * Arbeitsbereich Kontaktlinse (Phase 4): Fluoreszeinbild, Sitzbeurteilung, Linsengeometrie,
 * Hornhaut (K, Asphärizität), Material (Dk, Dk/t) und Tränenlinse.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import type { LensElement, PeripheralCurve } from '@/model/types';
import { useAppStore } from '@/state/store';
import { createElement } from '@/model/sceneFactory';
import { applyConstraints, isOnEye, tearThicknessForBearing } from '@/model/derived/contactSeat';
import { analyzeFluorescein, FIT_LABEL } from '@/engine/optics/fluorescein';
import { tearLens } from '@/engine/physics/contactLens';
import { lensOptics } from '@/engine/physics/lensOptics';
import { dkOverT, findMaterial, materialsForElement, oxygenRating } from '@/model/media';
import { formatNumber } from '@/core/units';
import { formatRx } from '@/engine/physics/explain';
import { EYE_ID } from '@/model/types';
import { ExplainButton } from '@/ui/common/Explain';
import { FluoView } from './FluoView';
import { Readout, Stepper, useTrialLens } from '../common';

function useOnEyeLens() {
  const doc = useAppStore((s) => s.doc);
  const selected = useAppStore((s) => s.selectedId);
  const lenses = doc.elements.filter((e): e is LensElement => e.family === 'lens' && isOnEye(e) && e.visible);
  const el = lenses.find((l) => l.id === selected) ?? lenses[0];
  return { doc, el, lenses };
}

/** Linse ändern und (formstabil) neu aufsetzen: Auflage in der optischen Zone */
function updateLens(id: string, fn: (el: LensElement) => LensElement, reseat: boolean) {
  const s = useAppStore.getState();
  s.commit((d) => {
    const elements = d.elements.map((e) => {
      if (e.id !== id || e.family !== 'lens') return e;
      let next = fn(e);
      if (reseat && next.contact?.design === 'rigid') next = { ...next, contact: { ...next.contact!, tearFilmThickness: Number(tearThicknessForBearing(next, d.eye).toFixed(4)) } };
      return next;
    });
    return applyConstraints({ ...d, elements });
  });
}

export function ContactLensPanel() {
  const { doc, el } = useOnEyeLens();
  const expert = useAppStore((s) => s.prefs.expertMode);
  const viewMode = doc.eye.viewMode;
  const [yellow, setYellow] = useState(true);
  const [zones, setZones] = useState(true);
  const [reseat, setReseat] = useState(true);
  const analysis = useMemo(() => (el ? analyzeFluorescein(el, doc.eye) : null), [el, doc.eye]);
  const tl = useMemo(() => (el ? tearLens(el, doc.eye) : null), [el, doc.eye]);
  const trial = useTrialLens();

  if (!el || !analysis) {
    return (
      <div className="wb-empty">
        <p>Für das Fluoreszeinbild wird eine formstabile Kontaktlinse auf dem Auge benötigt.</p>
        <button
          type="button"
          className="btn btn--accent"
          data-testid="add-rgp"
          onClick={() => {
            const s = useAppStore.getState();
            let cl = createElement('rigid-contact-lens', s.doc) as LensElement;
            cl = { ...cl, contact: { ...cl.contact!, tearFilmThickness: Number(tearThicknessForBearing(cl, s.doc.eye).toFixed(4)) } };
            s.commit((d) => applyConstraints({ ...d, elements: [...d.elements, cl] }));
            s.select(cl.id);
          }}
        >
          <Plus size={14} /> Formstabile KL aufsetzen
        </button>
      </div>
    );
  }

  const c = el.contact!;
  const pcs = c.peripheralCurves ?? [];
  const setC = (patch: Partial<NonNullable<LensElement['contact']>>, re = reseat) => updateLens(el.id, (e) => ({ ...e, contact: { ...e.contact!, ...patch } }), re);
  const setLens = (patch: Partial<LensElement['lens']>) => updateLens(el.id, (e) => ({ ...e, lens: { ...e.lens, ...patch } }), reseat);
  const a = doc.eye.anatomy;
  const setAnat = (patch: Partial<typeof a>) =>
    useAppStore.getState().commit((d) => {
      const eye = { ...d.eye, anatomy: { ...d.eye.anatomy, ...patch } };
      const elements = d.elements.map((e) => (e.family === 'lens' && e.id === el.id && reseat && e.contact?.design === 'rigid' ? { ...e, contact: { ...e.contact!, tearFilmThickness: Number(tearThicknessForBearing(e, eye).toFixed(4)) } } : e));
      return applyConstraints({ ...d, eye, elements });
    });
  const mat = findMaterial(el.medium.presetId);
  const dkt = mat?.dk !== undefined ? dkOverT(mat.dk, el.lens.centerThickness) : null;
  const rating = dkt !== null ? oxygenRating(dkt) : null;
  const optics = lensOptics(el, doc.eye);
  const standardPeriphery = () => setC({ opticZoneDiameter: Number((el.lens.diameter - 1.8).toFixed(1)), peripheralCurves: [{ radius: Number((el.lens.backRadius + 0.8).toFixed(2)), width: 0.6 }, { radius: Number((el.lens.backRadius + 2.6).toFixed(2)), width: 0.3 }] }, true);

  return (
    <div className="wb-panel wb-panel--contact">
      <section className="wb-col wb-col--view">
        {analysis.applicable ? (
          <FluoView el={el} eye={doc.eye} yellowFilter={yellow} showZones={zones} />
        ) : (
          <div className="wb-empty wb-empty--inline">{analysis.reason}</div>
        )}
        <div className="wb-chips">
          <button type="button" className={`chip${yellow ? ' is-on' : ''}`} onClick={() => setYellow(!yellow)}>
            Gelbfilter
          </button>
          <button type="button" className={`chip${zones ? ' is-on' : ''}`} onClick={() => setZones(!zones)}>
            Optische Zone
          </button>
          <button
            type="button"
            className={`chip${viewMode === 'fluorescein' ? ' is-on' : ''}`}
            onClick={() => useAppStore.getState().updateEntity(EYE_ID, (e) => ({ ...e, viewMode: viewMode === 'fluorescein' ? 'normal' : 'fluorescein' }) as typeof e)}
            data-testid="fluo-3d"
          >
            Fluo in 3D
          </button>
        </div>
        <p className="wb-hint">Klick ins Bild: lokale Tränenfilmdicke (Messwert) und Deutung (Interpretation).</p>
        {trial.el && (
          <div className="wb-note">
            <span>
              Messglas {formatRx(trial.rx)} steht noch vor dem Auge – die Restrefraktion ist damit eine Überrefraktion über der Kontaktlinse.
            </span>
            <button type="button" className="btn" onClick={trial.remove}>
              Messglas entfernen
            </button>
          </div>
        )}
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">{el.name}</div>
          <Stepper label="Basiskurve r₀" value={el.lens.backRadius} step={0.05} bigStep={0.2} min={6} max={10} decimals={2} unit="mm" signed={false} onChange={(v) => setLens({ backRadius: v })} testId="cl-bc" />
          <Stepper label="Gesamt-Ø" value={el.lens.diameter} step={0.1} min={7} max={16} decimals={1} unit="mm" signed={false} onChange={(v) => setLens({ diameter: v })} />
          <Stepper label="Optische Zone Ø" value={c.opticZoneDiameter ?? el.lens.diameter * 0.8} step={0.1} min={5} max={el.lens.diameter} decimals={1} unit="mm" signed={false} onChange={(v) => setC({ opticZoneDiameter: v })} />
          <Stepper label="Dezentration →" value={c.centration?.x ?? 0} step={0.1} min={-3} max={3} decimals={1} unit="mm" onChange={(v) => setC({ centration: { x: v, y: c.centration?.y ?? 0 } }, false)} />
          <Stepper label="Dezentration ↑" value={c.centration?.y ?? 0} step={0.1} min={-3} max={3} decimals={1} unit="mm" onChange={(v) => setC({ centration: { x: c.centration?.x ?? 0, y: v } }, false)} />
          <label className="wb-check">
            <input type="checkbox" checked={reseat} onChange={(e) => setReseat(e.target.checked)} /> Linse nach Änderung neu aufsetzen (Auflage)
          </label>
        </div>
        <div className="wb-group">
          <div className="wb-group__title">
            Periphere Kurven
            <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={standardPeriphery} data-tip="Standard-Peripherie: r₀ + 0,8 / r₀ + 2,6 mm">
              <Wand2 size={13} />
            </button>
          </div>
          {pcs.length === 0 && <p className="wb-hint">Keine – Rückfläche sphärisch bis zum Rand.</p>}
          {pcs.map((pc, i) => (
            <div key={i} className="wb-pc">
              <Stepper label={`PK${i + 1} r`} value={pc.radius} step={0.1} min={6} max={16} decimals={2} unit="mm" signed={false} onChange={(v) => setC({ peripheralCurves: pcs.map((p, k) => (k === i ? { ...p, radius: v } : p)) })} />
              <Stepper label="Breite" value={pc.width} step={0.05} min={0.05} max={2} decimals={2} unit="mm" signed={false} onChange={(v) => setC({ peripheralCurves: pcs.map((p, k) => (k === i ? { ...p, width: v } : p)) })} />
              <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={() => setC({ peripheralCurves: pcs.filter((_, k) => k !== i) })} aria-label="Kurve entfernen">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost" onClick={() => setC({ peripheralCurves: [...pcs, { radius: (pcs.at(-1)?.radius ?? el.lens.backRadius) + 1, width: 0.3 } as PeripheralCurve] })}>
            <Plus size={13} /> Kurve hinzufügen
          </button>
        </div>
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">Hornhaut</div>
          <Stepper label="Radius (flach)" value={a.corneaFrontRadius} step={0.05} bigStep={0.2} min={6.5} max={9.5} decimals={2} unit="mm" signed={false} onChange={(v) => setAnat({ corneaFrontRadius: v })} />
          <Stepper label="Asphärizität Q" value={a.corneaAsphericity ?? 0} step={0.05} min={-1} max={0.5} decimals={2} unit="" onChange={(v) => setAnat({ corneaAsphericity: Math.abs(v) < 1e-6 ? 0 : v })} />
          {a.corneaFrontRadius2 !== undefined && <Readout label="Torisch" value={`${formatNumber(a.corneaFrontRadius, 2)} / ${formatNumber(a.corneaFrontRadius2, 2)} mm A ${formatNumber(a.corneaAxis ?? 180, 0)}°`} />}
          <p className="wb-hint">Q wirkt auf Sitz und Fluoreszein (typisch −0,26). Die Refraktion ist paraxial und hängt nur vom Scheitelradius ab.</p>
        </div>
        <div className="wb-group">
          <div className="wb-group__title">Material & Tränenlinse</div>
          <select
            className="wb-select"
            value={el.medium.presetId}
            onChange={(e) => {
              const m = findMaterial(e.target.value);
              if (m) updateLens(el.id, (x) => ({ ...x, medium: { presetId: m.id, n: m.n, abbe: m.abbe } }), false);
            }}
            aria-label="Material"
            data-testid="cl-material"
          >
            {materialsForElement(el.kind, c.design).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {mat && <Readout label="n / Dk" value={`${formatNumber(mat.n, 3)} / ${mat.dk !== undefined ? formatNumber(mat.dk, 0) : '—'}`} />}
          {dkt !== null && rating && <Readout label="Dk/t (zentral)" value={`${formatNumber(dkt, 0)}`} tone={rating.tone === 'ok' ? 'ok' : 'warn'} hint={`Holden & Mertz: ${rating.label}`} />}
          <Readout label="KL-Wirkung" value={formatRx(optics.rx)} />
          {tl && <Readout label="Tränenlinse" value={formatRx(tl.rx)} hint={tl.fitLabel} />}
        </div>
      </section>

      <section className="wb-col">
        {analysis.applicable && (
          <div className="wb-group" data-testid="fit-analysis">
            <div className="wb-group__title">
              Sitz: <span className={`fit-badge fit-badge--${analysis.verdict}`}>{FIT_LABEL[analysis.verdict]}</span>
              <ExplainButton
                explanation={{
                  title: 'Fluoreszeinbild aus der Geometrie',
                  formula: 'I(t) = 1 − exp(−(t − t₀)/τ),   t₀ = 10 µm, τ = 35 µm',
                  substitution: `t zentral = ${Math.round(analysis.stats.central * 1000)} µm → I = ${formatNumber(1 - Math.exp(-Math.max(0, analysis.stats.central - 0.01) / 0.035), 2)}`,
                  result: FIT_LABEL[analysis.verdict],
                  text: 'Die lokale Tränenfilmdicke ergibt sich aus Hornhautform (Radius, Torizität, Q) und KL-Rückfläche (Basiskurve, optische Zone, periphere Kurven) bei gegebener Lage. Dünne Schichten fluoreszieren schwach (dunkel = Auflage), dicke Schichten hell.',
                }}
              />
            </div>
            <div className="wb-chips">
              {analysis.features.map((f) => (
                <span key={f} className="chip is-static">
                  {f}
                </span>
              ))}
            </div>
            <div className="wb-group__sub">Messwerte (Geometrie)</div>
            <ul className="wb-list">
              {analysis.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="wb-group__sub">Interpretation (didaktisch)</div>
            <ul className="wb-list wb-list--interp">
              {analysis.interpretation.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {expert && (
              <>
                <Readout label="Auflagefläche" value={`${Math.round(analysis.stats.touchFraction * 100)} %`} />
                <Readout label="Randspalt" value={`${Math.round(analysis.stats.edgeClearance * 1000)} µm`} />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
