/**
 * Inspector für Linsen, Brillengläser, Kontaktlinsen und Lupen (Phase 2).
 *
 * Zwei Bedienmodi auf demselben Objekt:
 *   „Optische Werte“: Sph/Cyl/A, Basiskurve, Dicke, Durchmesser, n – Geometrie wird gelöst,
 *                     die Wirkung bleibt bei Änderungen von Basiskurve/Dicke/n erhalten.
 *   „Geometrie“:      Radien (torisch je Hauptschnitt), Achslage, Dicke, n – die Wirkung wird berechnet.
 * Source of Truth ist immer die gespeicherte Geometrie.
 */
import { useMemo } from 'react';
import { AlertTriangle, Crosshair, LocateFixed, Ruler } from 'lucide-react';
import type { LensElement, LensParams, OpticalElement, SurfaceFinish } from '@/model/types';
import { getElementDefinition, isContactLens } from '@/model/elementRegistry';
import { CUSTOM_MEDIUM_ID, matchMediumByIndex } from '@/model/media';
import { MaterialReadouts, MaterialSelect } from './MaterialFields';
import { resolveLensShape } from '@/model/derived/elementShape';
import { computeMeasurements } from '@/model/derived/measurements';
import { entityInfo } from '@/model/derived/infoCards';
import { computeTearProfile, DEFAULT_TEAR_INDEX, tearThicknessForBearing } from '@/model/derived/contactSeat';
import { centerOnAxis, moveToVertexDistance, seatOnCornea } from '@/model/sceneFactory';
import {
  computeCorrection,
  designLensForRx,
  explainBackVertex,
  explainEffectivePower,
  explainPrincipalMeridians,
  explainResidual,
  explainTearLens,
  explainTransposition,
  formatRx,
  lensOptics,
  solvedSurface,
  tearLens,
  computeElementOptics,
} from '@/engine/physics';
import { principalMeridians, type Rx } from '@/core/math/powerMatrix';
import { isToric } from '@/core/math/surfaces';
import { formatNumber, formatPower, formatValue } from '@/core/units';
import { useAppStore } from '@/state/store';
import { useTraceResultStore } from '@/scene/overlays/traceResultStore';
import { Badge, Section, Segmented } from '../common/controls';
import { ColorField, NumberField, ReadoutRow, SelectField, ToggleField } from '../common/fields';
import { RxEditor } from '../common/RxEditor';
import { ElementGlyph } from '../common/ElementGlyph';
import { InfoCardView, InspectorHeader, TransformSection } from './shared';

const FINISH_OPTIONS: Array<{ value: SurfaceFinish; label: string }> = [
  { value: 'clear', label: 'Klar' },
  { value: 'coated', label: 'Entspiegelt' },
  { value: 'tinted', label: 'Getönt' },
  { value: 'frosted', label: 'Mattiert' },
];

const OUTLINE_OPTIONS = [
  { value: 'round', label: 'Rund' },
  { value: 'oval', label: 'Oval' },
  { value: 'rect', label: 'Rechteckig' },
];

const nearZero = (rx: Rx) => Math.abs(rx.sph) < 0.125 && Math.abs(rx.cyl) < 0.125;

export function LensInspector({ el }: { el: LensElement }) {
  const doc = useAppStore((s) => s.doc);
  const commit = useAppStore((s) => s.commit);
  const notify = useAppStore((s) => s.notify);
  const prefs = useAppStore((s) => s.prefs);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const trace = useTraceResultStore((s) => s.result);
  const form = prefs.cylForm;
  const decimals = prefs.decimals;
  const def = getElementDefinition(el.kind);
  const locked = el.locked;
  const cl = isContactLens(el);
  const spectacle = el.kind === 'spectacle-lens';
  const mode = prefs.paramMode;

  const free = useMemo(() => lensOptics(el, undefined, form), [el, form]);
  const onEye = useMemo(() => lensOptics(el, doc.eye, form), [el, doc.eye, form]);
  const correction = useMemo(() => computeCorrection(doc, form), [doc, form]);
  const me = correction.elements.find((c) => c.id === el.id);
  const report = useMemo(() => computeMeasurements(doc), [doc]);
  const placement = report.placements.find((p) => p.id === el.id);
  const shape = resolveLensShape(el);
  const extra = useMemo(() => computeElementOptics(el, placement?.tiltDeg ?? 0), [el, placement?.tiltDeg]);
  const tl = useMemo(() => (cl && el.contact?.onEye ? tearLens(el, doc.eye, form) : null), [cl, el, doc.eye, form]);
  const profile = useMemo(() => (cl && el.contact?.onEye ? computeTearProfile(el, doc.eye, 16) : null), [cl, el, doc.eye]);

  const update = (fn: (e: LensElement) => LensElement) =>
    commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? (fn(e as LensElement) as OpticalElement) : e)) }));

  /** Rezept → Geometrie */
  const applyRx = (rx: Rx, base: LensElement = el) => {
    const r = designLensForRx(base, rx);
    if (!r.ok) {
      notify(r.notes[0], 'warning');
      return;
    }
    update((e) => ({ ...e, medium: base.medium, lens: r.lens }));
    r.notes.forEach((n) => notify(n, 'info'));
  };
  /** Im Optik-Modus: Parameter ändern, Wirkung beibehalten */
  const setKeepRx = (patch: Partial<LensParams>, medium = el.medium) => {
    const tmp: LensElement = { ...el, medium, lens: { ...el.lens, ...patch } };
    if (mode === 'optical') applyRx(free.rx, tmp);
    else update((e) => ({ ...e, medium, lens: { ...e.lens, ...patch } }));
  };
  const setLens = (patch: Partial<LensParams>) => update((e) => ({ ...e, lens: { ...e.lens, ...patch } }));
  const setContact = (patch: Partial<NonNullable<LensElement['contact']>>) => update((e) => ({ ...e, contact: { ...e.contact!, ...patch } }));

  const [pm1, pm2] = principalMeridians(free.rx);
  const bothToric = free.front && free.back && isToric(free.front) && isToric(free.back) && Math.abs((free.front.axis ?? 0) - (free.back.axis ?? 0)) % 180 > 0.5;
  const solved = solvedSurface(el);
  const p = el.lens;
  const fmtMm = (v: number) => formatValue(v, 'mm', decimals);
  const onCornea = cl && !!el.contact?.onEye;

  // Scheitelbrechwert-Erklärung im ersten Hauptschnitt (für torische Gläser je Hauptschnitt gültig)
  const F1m1 = 1000 * (el.medium.n - 1) / (Math.abs(p.frontRadius) > 1e-9 ? p.frontRadius : Infinity);
  const backR1 = p.backRadius;
  const F2m1 = 1000 * (1 - el.medium.n) / (Math.abs(backR1) > 1e-9 ? backR1 : Infinity);

  const material = (
    <Section title="Material">
      <MaterialSelect el={el} disabled={locked} onChange={(m) => setKeepRx({}, m)} />
      <NumberField
        label="Brechungsindex n"
        unit="n"
        step={0.001}
        decimals={4}
        min={1}
        max={3}
        value={el.medium.n}
        disabled={locked}
        hint={mode === 'optical' ? 'Optik-Modus: Die Wirkung bleibt erhalten, die Geometrie wird neu berechnet.' : 'Geometrie-Modus: Die Wirkung ändert sich mit n.'}
        onChange={(n) => setKeepRx({}, { presetId: matchMediumByIndex(n)?.id ?? CUSTOM_MEDIUM_ID, n, abbe: matchMediumByIndex(n)?.abbe })}
      />
      <MaterialReadouts el={el} thickness={el.lens.centerThickness} />
    </Section>
  );

  const dimensionFields = (
    <>
      {spectacle || el.kind === 'custom-lens' ? (
        <SelectField label="Form" value={p.outline} options={OUTLINE_OPTIONS} disabled={locked} onChange={(v) => setKeepRx({ outline: v as LensParams['outline'] })} />
      ) : null}
      {p.outline === 'round' ? (
        <NumberField label={cl ? 'Gesamtdurchmesser Ø' : 'Durchmesser'} unit="mm" step={cl ? 0.1 : 0.5} decimals={1} min={1} max={120} value={p.diameter} disabled={locked} onChange={(v) => setKeepRx({ diameter: v })} />
      ) : (
        <>
          <NumberField label="Scheibenbreite" unit="mm" step={0.5} decimals={1} min={5} max={120} value={p.width} disabled={locked} onChange={(v) => setKeepRx({ width: v })} />
          <NumberField label="Scheibenhöhe" unit="mm" step={0.5} decimals={1} min={5} max={120} value={p.height} disabled={locked} onChange={(v) => setKeepRx({ height: v })} />
        </>
      )}
      <NumberField label="Mittendicke" unit="mm" step={cl ? 0.01 : 0.1} decimals={2} min={0.02} max={60} value={p.centerThickness} disabled={locked} onChange={(v) => setKeepRx({ centerThickness: v })} />
    </>
  );

  const surfaceEditor = (which: 'front' | 'back') => {
    const R = which === 'front' ? p.frontRadius : p.backRadius;
    const R2 = which === 'front' ? p.frontRadius2 : p.backRadius2;
    const ax = which === 'front' ? p.frontAxis : p.backAxis;
    const toric = R2 !== undefined;
    const key = which === 'front' ? { R: 'frontRadius', R2: 'frontRadius2', ax: 'frontAxis' } : { R: 'backRadius', R2: 'backRadius2', ax: 'backAxis' };
    const title = which === 'front' ? (cl ? 'Vorderfläche' : 'Vorderfläche r₁') : cl ? 'Rückfläche (Basiskurve)' : 'Rückfläche r₂';
    return (
      <>
        <div className="subhead">{title}</div>
        <NumberField
          label={toric ? 'Radius Hauptschnitt 1' : 'Radius'}
          unit="mm"
          step={cl ? 0.01 : 0.5}
          decimals={cl ? 3 : 2}
          min={-10000}
          max={10000}
          zeroMeansInfinity
          value={R}
          disabled={locked}
          hint="r > 0: Krümmungsmittelpunkt in Lichtrichtung hinter dem Scheitel. 0 = plan."
          onChange={(v) => setLens({ [key.R]: v } as Partial<LensParams>)}
        />
        <ToggleField
          label="Torisch"
          value={toric}
          disabled={locked}
          onChange={(v) => setLens((v ? { [key.R2]: R, [key.ax]: ax ?? 180 } : { [key.R2]: undefined, [key.ax]: undefined }) as Partial<LensParams>)}
        />
        {toric && (
          <>
            <NumberField label="Radius Hauptschnitt 2" unit="mm" step={cl ? 0.01 : 0.5} decimals={cl ? 3 : 2} min={-10000} max={10000} zeroMeansInfinity value={R2!} disabled={locked} onChange={(v) => setLens({ [key.R2]: v } as Partial<LensParams>)} />
            <NumberField label="Achslage HS 1 (TABO)" unit="deg" step={1} decimals={0} min={0} max={180} value={ax ?? 180} disabled={locked} onChange={(v) => setLens({ [key.ax]: v } as Partial<LensParams>)} />
          </>
        )}
      </>
    );
  };

  const traceFocus = trace?.focus;
  const astig = traceFocus?.astigmatism;

  return (
    <>
      <InspectorHeader entity={el} typeLabel={def.label} icon={<ElementGlyph kind={el.kind} size={18} />} />

      <div className="mode-switch">
        <span className="mode-switch__label">Parameter</span>
        <Segmented
          size="sm"
          value={mode}
          onChange={(v) => setPrefs({ paramMode: v })}
          options={[
            { value: 'optical', label: 'Optische Werte', tip: 'Sphäre, Zylinder, Achse – Geometrie wird berechnet' },
            { value: 'geometry', label: 'Geometrie', tip: 'Radien, torische Hauptschnitte, Dicke – Wirkung wird berechnet' },
          ]}
        />
      </div>

      {mode === 'optical' ? (
        <>
          <Section title={cl ? 'Linse' : spectacle ? 'Refraktion' : 'Optische Wirkung'}>
            <RxEditor value={free.rx} disabled={locked} onChange={(rx) => applyRx(rx)} hint="Scheitelbrechwert S'∞ (in Luft)" />
            <div className="insp-callout">
              Berechnet wird die {solved === 'back' ? 'Rückfläche (innentorisch)' : 'Vorderfläche'}; {solved === 'back' ? 'die Vorderfläche (Basiskurve)' : 'die Basiskurve'} bleibt erhalten.
            </div>
            {cl ? (
              <NumberField label="Basiskurve r₀" unit="mm" step={0.05} decimals={2} min={5} max={12} value={p.backRadius} disabled={locked} hint="Rückflächen-Scheitelradius (BOZR). Die Wirkung bleibt erhalten." onChange={(v) => setKeepRx({ backRadius: v, backRadius2: undefined, backAxis: undefined })} />
            ) : (
              <NumberField label="Basiskurve (Vorderfläche)" unit="mm" step={1} decimals={1} min={-10000} max={10000} zeroMeansInfinity value={p.frontRadius} disabled={locked} hint="Vorderflächenradius. Die Wirkung bleibt erhalten; die Rückfläche wird neu berechnet." onChange={(v) => setKeepRx({ frontRadius: v, frontRadius2: undefined, frontAxis: undefined })} />
            )}
            {dimensionFields}
          </Section>
          {material}
        </>
      ) : (
        <>
          <Section title="Flächen">
            {surfaceEditor('front')}
            {surfaceEditor('back')}
            {bothToric && <div className="insp-callout">Beide Flächen torisch mit unterschiedlichen Achsen: Die Gesamtwirkung ergibt sich aus der Matrixrechnung (schräg gekreuzte Zylinder).</div>}
          </Section>
          <Section title="Abmessungen">{dimensionFields}</Section>
          {material}
        </>
      )}

      {shape.warnings.length > 0 && (
        <div className="insp-warning">
          <AlertTriangle size={14} />
          <div>
            {shape.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {cl && (
        <>
          <Section title="Tränenlinse">
            <ToggleField label="Tränenfilm als Medium" value={el.contact?.tearFilm ?? true} disabled={locked || !onCornea} onChange={(v) => setContact({ tearFilm: v })} />
            <NumberField label="Tränenfilm zentral" unit="mm" step={0.005} decimals={3} min={0} max={0.5} value={el.contact?.tearFilmThickness ?? 0} disabled={locked} onChange={(v) => setContact({ tearFilmThickness: v })} />
            <NumberField label="Brechungsindex Tränen" unit="n" step={0.001} decimals={3} min={1.3} max={1.4} value={el.contact?.nTear ?? DEFAULT_TEAR_INDEX} disabled={locked} onChange={(v) => setContact({ nTear: v })} />
            {onCornea && tl ? (
              <>
                <ReadoutRow
                  label="Wirkung der Tränenlinse"
                  value={formatRx(tl.rx)}
                  tone="accent"
                  explain={explainTearLens(tl.nTear, tl.baseCurve, tl.flatK, tl.thickness, tl.rx.sph)}
                />
                <ReadoutRow label="Basiskurve / flaches K" value={`${formatNumber(tl.baseCurve, 2)} / ${formatNumber(tl.flatK, 2)} mm`} />
                <ReadoutRow label="Differenz r₀ − K_flach" value={`${tl.deltaR > 0 ? '+' : tl.deltaR < 0 ? '−' : ''}${formatNumber(Math.abs(tl.deltaR), 2)} mm`} />
                <ReadoutRow label="Sitz (vereinfacht)" value={tl.fitLabel} />
                {profile && (
                  <>
                    <ReadoutRow label="Tränenfilm min / max" value={`${formatNumber(profile.min * 1000, 0)} / ${formatNumber(profile.max * 1000, 0)} µm`} />
                    <ReadoutRow label="Spalt am Rand der optischen Zone" value={`${formatNumber(profile.edgeClearance * 1000, 0)} µm`} />
                    <ReadoutRow label="Auflageanteil" value={`${formatNumber(profile.bearingFraction * 100, 0)} %`} tone={profile.bearingFraction > 0.3 ? 'warn' : undefined} />
                  </>
                )}
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={locked || el.contact?.design === 'soft'}
                    onClick={() => setContact({ tearFilmThickness: Number(tearThicknessForBearing(el, doc.eye).toFixed(3)) })}
                    data-tip="Zentrale Tränenfilmdicke so wählen, dass die Linse innerhalb der optischen Zone gerade aufliegt (Mindestspalt 5 µm)"
                  >
                    <Ruler size={14} />
                    <span>Tränenfilm aus Auflage berechnen</span>
                  </button>
                </div>
                <p className="insp-hint">Das räumliche Tränenraumprofil ist Grundlage für das Fluoreszeinbild (Phase 3). Periphere Kurven sind noch nicht berücksichtigt.</p>
              </>
            ) : (
              <p className="insp-hint">Die Tränenlinse entsteht, sobald die Linse auf dem Auge sitzt.</p>
            )}
          </Section>

          <Section title="Sitz auf dem Auge">
            <ToggleField
              label="Auf der Hornhaut"
              value={onCornea}
              disabled={locked}
              onChange={(v) => (v ? update((e) => seatOnCornea(e, doc)) : setContact({ onEye: false }))}
            />
            {onCornea ? (
              <>
                <NumberField label="Zentrierung horizontal" unit="mm" step={0.1} decimals={2} min={-5} max={5} value={el.contact?.centration?.x ?? 0} disabled={locked} hint="Dezentration im TABO-Rahmen: + = Richtung 0° (in der Frontansicht rechts)" onChange={(v) => setContact({ centration: { x: v, y: el.contact?.centration?.y ?? 0 } })} />
                <NumberField label="Zentrierung vertikal" unit="mm" step={0.1} decimals={2} min={-5} max={5} value={el.contact?.centration?.y ?? 0} disabled={locked} hint="+ = nach oben (90°)" onChange={(v) => setContact({ centration: { x: el.contact?.centration?.x ?? 0, y: v } })} />
                <NumberField label="Neigung um horizontale Achse" unit="deg" step={0.5} decimals={1} min={-20} max={20} value={el.contact?.tilt?.x ?? 0} disabled={locked} onChange={(v) => setContact({ tilt: { x: v, y: el.contact?.tilt?.y ?? 0 } })} />
                <NumberField label="Neigung um vertikale Achse" unit="deg" step={0.5} decimals={1} min={-20} max={20} value={el.contact?.tilt?.y ?? 0} disabled={locked} onChange={(v) => setContact({ tilt: { x: el.contact?.tilt?.x ?? 0, y: v } })} />
                <p className="insp-hint">Die Linse folgt dem Auge. Verschieben im 3D-Raum ändert die Zentrierung.</p>
              </>
            ) : (
              <div className="btn-row">
                <button type="button" className="btn btn--ghost" disabled={locked} onClick={() => update((e) => seatOnCornea(e, doc))}>
                  <LocateFixed size={14} />
                  <span>Auf Hornhaut setzen</span>
                </button>
              </div>
            )}
          </Section>

          <Section title="KL-Geometrie" defaultOpen={false} badge={<Badge tone="dev">vorbereitet</Badge>}>
            <SelectField
              label="Linsentyp"
              value={el.contact?.design ?? 'rigid'}
              options={[
                { value: 'rigid', label: 'Formstabil' },
                { value: 'soft', label: 'Weich (schmiegt sich an)' },
              ]}
              disabled={locked}
              onChange={(v) => setContact({ design: v as 'rigid' | 'soft' })}
            />
            <NumberField label="Optische Zone Ø" unit="mm" step={0.1} decimals={1} min={4} max={16} value={el.contact?.opticZoneDiameter ?? p.diameter * 0.8} disabled={locked} onChange={(v) => setContact({ opticZoneDiameter: v })} />
            <NumberField label="Randdicke (nominal)" unit="mm" step={0.01} decimals={2} min={0.02} max={0.5} value={el.contact?.edgeThicknessNominal ?? 0.1} disabled={locked} onChange={(v) => setContact({ edgeThicknessNominal: v })} />
            <NumberField label="Exzentrizität" unit="none" step={0.05} decimals={2} min={0} max={1.5} value={el.contact?.eccentricity ?? 0} disabled={locked} onChange={(v) => setContact({ eccentricity: v })} />
            {(el.contact?.peripheralCurves ?? []).map((pc, i) => (
              <ReadoutRow key={i} label={`Periphere Kurve ${i + 1}`} value={`r ${formatNumber(pc.radius, 2)} mm · Breite ${formatNumber(pc.width, 2)} mm`} />
            ))}
            <ReadoutRow label="Randdicke (Geometrie)" value={fmtMm(shape.edgeThickness)} />
            <p className="insp-hint">Optische Zone, periphere Kurven, Randdicke und Exzentrizität werden gespeichert, gehen aber erst mit der Sitzsimulation (Phase 3) in Geometrie und Raytracing ein.</p>
          </Section>
        </>
      )}

      {!onCornea && placement && (
        <Section title="Position">
          <NumberField
            label={spectacle ? 'HSA' : 'Abstand zum Hornhautscheitel'}
            hint="Axialer Abstand Hornhautscheitel → augenseitiger Scheitel. Eingabe verschiebt das Element entlang der optischen Achse."
            unit="mm"
            step={0.5}
            decimals={decimals}
            value={placement.vertexDistance}
            disabled={locked}
            onChange={(v) => update((e) => moveToVertexDistance(e, doc, placement.vertexDistance, v))}
          />
          <ReadoutRow label="Dezentration horizontal / vertikal" value={`${formatNumber(placement.decentration.x, 2)} / ${formatNumber(placement.decentration.y, 2)} mm`} />
          <ReadoutRow label="Neigung zur Achse" value={formatValue(placement.tiltDeg, 'deg', 1)} />
          {me && Math.abs(me.rollDeg) > 0.05 && <ReadoutRow label="Verdrehung gegen das Auge" value={formatValue(me.rollDeg, 'deg', 1)} />}
          <div className="btn-row">
            <button type="button" className="btn btn--ghost" disabled={locked} onClick={() => update((e) => centerOnAxis(e, doc))} data-tip="Auf optische Achse zentrieren und parallel zum Auge ausrichten">
              <Crosshair size={14} />
              <span>Auf Achse zentrieren</span>
            </button>
          </div>
        </Section>
      )}

      <Section title="Berechnet">
        <div className="subhead">Wirkung der Linse</div>
        <ReadoutRow label={`Hauptschnitt 1 (${formatNumber(pm1.meridian, 0)}°)`} value={formatPower(pm1.power)} explain={explainPrincipalMeridians(free.rx)} />
        <ReadoutRow label={`Hauptschnitt 2 (${formatNumber(pm2.meridian, 0)}°)`} value={formatPower(pm2.power)} />
        <ReadoutRow
          label="Scheitelbrechwert S'∞"
          value={formatRx(free.rx)}
          tone="accent"
          explain={explainBackVertex(F1m1, F2m1, p.centerThickness, el.medium.n, free.rx.sph)}
        />
        {Math.abs(free.rx.cyl) > 0.004 && <ReadoutRow label="Transponiert" value={formatRx({ sph: free.rx.sph + free.rx.cyl, cyl: -free.rx.cyl, axis: (free.rx.axis + 90) % 180 || 180 })} explain={explainTransposition(free.rx)} />}
        {onEye.conformed && <ReadoutRow label="Auf dem Auge (angeschmiegt)" value={formatRx(onEye.rx)} formula="Weiche Linse: Rückfläche übernimmt die Hornhautform, Nennwirkung bleibt erhalten (vereinfacht)" />}
        {extra
          .filter((c) => c.id === 'edge' || c.id === 'gamma')
          .map((c) => (
            <ReadoutRow key={c.id} label={c.label} value={c.unit === 'none' ? `${formatNumber(c.value, c.decimals)}×` : formatValue(c.value, c.unit === 'dpt' ? 'dpt' : 'mm', c.decimals)} formula={c.formula} />
          ))}

        {me && (
          <>
            <div className="subhead">Am Auge</div>
            <ReadoutRow
              label={onCornea ? 'KL + Tränenlinse am Hornhautscheitel' : 'Wirksam am Hornhautscheitel'}
              value={formatRx(me.effectiveRx)}
              tone="accent"
              explain={onCornea ? undefined : explainEffectivePower(me.ownRx.sph, me.vertexDistance, me.effectiveRx.sph)}
            />
            <ReadoutRow label="Refraktion des Auges (HS)" value={formatRx(correction.eye.rx)} />
            <ReadoutRow
              label="Restrefraktion (gesamt)"
              value={formatRx(correction.residualRx)}
              tone={nearZero(correction.residualRx) ? 'ok' : 'warn'}
              explain={explainResidual(correction.eye.rx, correction.correctionRx, correction.residualRx)}
            />
          </>
        )}
        {doc.display.showRays && traceFocus && (
          <>
            <div className="subhead">Raytracing</div>
            {astig ? (
              astig.lines.map((l, i) => (
                <ReadoutRow key={i} label={`Brennlinie ${i + 1} (Meridian ${formatNumber(l.meridianDeg, 0)}°)`} value={`${l.defocusMm > 0 ? '+' : l.defocusMm < 0 ? '−' : ''}${formatNumber(Math.abs(l.defocusMm), 2)} mm`} />
              ))
            ) : (
              <ReadoutRow label="Fokus relativ zur Retina" value={`${traceFocus.paraxialDefocusMm > 0 ? '+' : traceFocus.paraxialDefocusMm < 0 ? '−' : ''}${formatNumber(Math.abs(traceFocus.paraxialDefocusMm), 2)} mm`} tone={Math.abs(traceFocus.paraxialDefocusMm) < 0.05 ? 'ok' : undefined} />
            )}
          </>
        )}
        {correction.notes.length > 0 && <p className="insp-hint">{correction.notes.join(' ')}</p>}
      </Section>

      <TransformSection entity={el}>
        <p className="insp-hint">{onCornea ? 'Lage wird aus dem Auge abgeleitet (Sitz).' : 'Rotation um Z verdreht die Zylinderachse gegenüber dem Auge.'}</p>
      </TransformSection>

      <Section title="Darstellung" defaultOpen={false}>
        <SelectField label="Oberfläche" value={el.appearance.finish} disabled={locked} options={FINISH_OPTIONS} onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, finish: v as SurfaceFinish } }))} />
        <ColorField label="Farbton" value={el.appearance.tint} onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, tint: v } }))} />
        <NumberField label="Transparenz" unit="pct" step={1} decimals={0} min={0} max={100} value={el.appearance.transparency * 100} disabled={locked} onChange={(v) => update((e) => ({ ...e, appearance: { ...e.appearance, transparency: v / 100 } }))} />
      </Section>

      <InfoCardView card={entityInfo(el)} />
    </>
  );
}
