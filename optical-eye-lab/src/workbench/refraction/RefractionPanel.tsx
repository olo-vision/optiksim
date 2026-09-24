/**
 * Arbeitsbereich Refraktion (Phase 4): Messglas (Phoropter), Sehzeichen, Nebeln, Kreuzzylinder,
 * Lochblende, Rot-Grün-Test, Fächer, Prisma, Visus-Schätzung und Vergleich vorher/nachher.
 * Der „Patient“ antwortet aus der berechneten Netzhautunschärfe (keine Zufallsantworten).
 */
import { useEffect, useMemo, useState } from 'react';
import { CloudFog, Columns2, Crosshair, ScanEye } from 'lucide-react';
import type { RefractionSetup, SceneDocument } from '@/model/types';
import { useAppStore } from '@/state/store';
import { accommodationAmplitude, blurStrength, chromaticRefractionShift, DUOCHROME, formatVisus, jccMatrix, patientViewState, type PatientViewOptions } from '@/engine/optics/vision';
import { refractionAtVertex } from '@/engine/optics/calculators';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { eigen2, normalizeAxis, type Mat2 } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { formatRx } from '@/engine/physics/explain';
import { ExplainButton } from '@/ui/common/Explain';
import { PatientImage } from '../patient/PatientImage';
import { CHART_LABEL, type ChartKind } from '../patient/charts';
import { prismShiftArcmin, psfSpecs } from '../patient/psfSpecs';
import { Readout, Stepper, TrialLensControls, useTrialLens } from '../common';
import { TrainingBox } from '../training/TrainingBox';

export const DEFAULT_SETUP: RefractionSetup = { testDistance: 6000, chart: 'landolt', pinhole: false, pinholeDiameter: 1.2 };

export function useRefractionSetup() {
  const raw = useAppStore((s) => s.doc.refraction);
  const setup = useMemo(() => ({ ...DEFAULT_SETUP, ...(raw ?? {}) }), [raw]);
  const set = (patch: Partial<RefractionSetup>) => useAppStore.getState().commit((d) => ({ ...d, refraction: { ...DEFAULT_SETUP, ...(d.refraction ?? {}), ...patch } }));
  return { setup, set };
}

/** Optionen für die Patientensicht aus dem Testaufbau */
export function viewOptions(setup: RefractionSetup, jccPos?: 1 | 2): PatientViewOptions {
  const o: PatientViewOptions = { testDistanceMm: setup.testDistance };
  if (setup.pinhole) o.pupilDiameterMm = setup.pinholeDiameter;
  if (setup.jcc && jccPos) o.extra = jccMatrix(setup.jcc.power, setup.jcc.axis, jccPos === 2);
  return o;
}

function compare(a: number, b: number, tol = 0.03): 0 | 1 | 2 {
  if (Math.abs(a - b) < tol) return 0;
  return a < b ? 1 : 2;
}

/** Welche Fächerlinie erscheint am schärfsten? Linienrichtung ⟂ zur Richtung mit der geringsten Unschärfe */
function sharpestFanLine(E: Mat2): number | null {
  const e = eigen2(E);
  if (Math.abs(Math.abs(e.l1) - Math.abs(e.l2)) < 0.12) return null;
  // Richtung mit kleinstem |λ| (geringste Unschärfe senkrecht zur Linie) → Linie senkrecht dazu
  const nDeg = Math.abs(e.l1) < Math.abs(e.l2) ? e.deg1 : e.deg1 + 90;
  return normalizeAxis(nDeg + 90);
}

export function RefractionPanel() {
  const doc = useAppStore((s) => s.doc);
  const quality = useAppStore((s) => s.prefs.visionQuality);
  const trial = useTrialLens();
  const { setup, set } = useRefractionSetup();
  const [compareMode, setCompareMode] = useState(false);
  const hidden = !!doc.training?.hidden;

  useEffect(() => {
    trial.ensure();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const st = useMemo(() => patientViewState(doc, viewOptions(setup)), [doc, setup]);
  const unc = useMemo(() => (compareMode ? patientViewState(doc, { ...viewOptions(setup), withoutTrialLens: true }) : null), [doc, setup, compareMode]);
  const chart = setup.chart as ChartKind;
  const specs = useMemo(() => psfSpecs(doc, st, chart, quality === 'high'), [doc, st, chart, quality]);
  const shift = useMemo(() => prismShiftArcmin(doc), [doc]);

  // simulierte Patientenantworten
  const responses = useMemo(() => patientResponses(doc, setup), [doc, setup]);
  const auto = useMemo(() => refractionAtVertex(eyeRefractionState(doc.eye.anatomy).matrix, 12), [doc.eye.anatomy]);

  const fog = (d: number) => trial.setRx({ ...trial.rx, sph: trial.rx.sph + d });

  return (
    <div className="wb-panel wb-panel--refraction">
      <section className="wb-col wb-col--view">
        <div className="patient-pair">
          <PatientImage
            chart={chart}
            psf={specs}
            shiftArcmin={shift}
            label={compareMode ? 'Mit Messglas' : 'Sicht des Patienten'}
            sublabel={`Visus ≈ ${formatVisus(st.acuity.decimal)} (Schätzung)`}
            visus={st.acuity.decimal}
            dim={setup.pinhole ? 0.6 : 1}
          />
          {compareMode && unc && (
            <PatientImage chart={chart} psf={psfSpecs(doc, unc, chart, quality === 'high')} label="Ohne Messglas" sublabel={`Visus ≈ ${formatVisus(unc.acuity.decimal)}`} visus={unc.acuity.decimal} dim={setup.pinhole ? 0.6 : 1} />
          )}
        </div>
        <div className="wb-chips">
          {(Object.keys(CHART_LABEL) as ChartKind[]).map((c) => (
            <button key={c} type="button" className={`chip${chart === c ? ' is-on' : ''}`} onClick={() => set({ chart: c })} data-testid={`chart-${c}`}>
              {CHART_LABEL[c]}
            </button>
          ))}
          <button type="button" className={`chip${compareMode ? ' is-on' : ''}`} onClick={() => setCompareMode(!compareMode)} data-testid="compare">
            <Columns2 size={12} /> Vorher/Nachher
          </button>
        </div>
      </section>

      <section className="wb-col">
        <TrialLensControls rx={trial.rx} onChange={trial.setRx} />
        <div className="wb-row">
          <button type="button" className="btn" onClick={() => fog(0.75)} data-tip="+0,75 dpt vorschalten: Akkommodation entspannen (Nebeln)">
            <CloudFog size={14} /> Nebeln +0,75
          </button>
          <button type="button" className="btn" onClick={() => fog(-0.25)} data-tip="Schrittweise entnebeln">
            −0,25
          </button>
          <button type="button" className="btn btn--ghost" disabled={hidden} onClick={() => trial.setRx({ sph: Math.round(auto.sph * 4) / 4, cyl: Math.round(auto.cyl * 4) / 4, axis: normalizeAxis(Math.round(auto.axis / 5) * 5) })} data-tip={hidden ? 'Im Training nicht verfügbar' : 'Objektiver Ausgangswert (idealisiertes Autorefraktometer)'}>
            <Crosshair size={14} /> Autorefraktometer
          </button>
        </div>
        <div className="wb-group">
          <div className="wb-group__title">Prüfaufbau</div>
          <Stepper label="Prüfentfernung" value={setup.testDistance / 1000} step={0.5} min={0.33} max={10} decimals={2} unit="m" signed={false} onChange={(v) => set({ testDistance: v * 1000 })} />
          <label className="wb-check">
            <input type="checkbox" checked={setup.pinhole} onChange={(e) => set({ pinhole: e.target.checked })} data-testid="pinhole" /> Lochblende (Ø {formatNumber(setup.pinholeDiameter, 1)} mm)
          </label>
          <Stepper label="Alter" value={doc.eye.patient?.age ?? 30} step={1} bigStep={10} min={5} max={90} decimals={0} unit="J." signed={false} onChange={(v) => setPatient({ age: v })} />
          <label className="wb-check">
            <input type="checkbox" checked={doc.eye.patient?.accommodates ?? false} onChange={(e) => setPatient({ accommodates: e.target.checked })} /> Patient akkommodiert (AB {formatNumber(doc.eye.patient?.amplitude ?? accommodationAmplitude(doc.eye.patient?.age ?? 30), 1)} dpt)
          </label>
          <Stepper label="Prisma" value={trial.el?.trialPrism?.amount ?? 0} step={0.5} min={0} max={10} decimals={1} unit="cm/m" signed={false} onChange={(v) => trial.setPrism({ amount: v, base: trial.el?.trialPrism?.base ?? 0 })} />
          {(trial.el?.trialPrism?.amount ?? 0) > 0 && (
            <Stepper label="Basislage" value={trial.el?.trialPrism?.base ?? 0} step={45} min={0} max={315} decimals={0} unit="°" signed={false} onChange={(v) => trial.setPrism({ amount: trial.el?.trialPrism?.amount ?? 0, base: v })} />
          )}
        </div>
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">
            Kreuzzylinder
            <ExplainButton
              explanation={{
                title: 'Jackson-Kreuzzylinder',
                formula: 'JCC ±p = +p sph −2p cyl;  Achsprüfung: Griff in Zylinderachse (Achsen ±45°), Stärkeprüfung: Achsen in Zylinderachse',
                substitution: setup.jcc ? `±${formatNumber(setup.jcc.power, 2)} dpt, Minusachse ${formatNumber(setup.jcc.axis, 0)}°` : '—',
                result: responses.jcc,
                text: 'Der Patient vergleicht zwei Stellungen. Bei der Achsprüfung wird die Zylinderachse zur Minusachse der besseren Stellung gedreht; bei der Stärkeprüfung wird der Zylinder in Richtung der besseren Stellung verändert.',
              }}
            />
          </div>
          <div className="wb-row">
            <button type="button" className={`chip${setup.jcc ? ' is-on' : ''}`} onClick={() => set({ jcc: setup.jcc ? undefined : { power: 0.25, axis: normalizeAxis(trial.rx.axis + 45), flipped: false } })} data-testid="jcc-toggle">
              {setup.jcc ? 'KZ aktiv' : 'KZ vorschalten'}
            </button>
            {setup.jcc && (
              <>
                <button type="button" className="chip" onClick={() => set({ jcc: { ...setup.jcc!, axis: normalizeAxis(trial.rx.axis + 45) } })}>
                  Achsprüfung
                </button>
                <button type="button" className="chip" onClick={() => set({ jcc: { ...setup.jcc!, axis: normalizeAxis(trial.rx.axis) } })}>
                  Stärkeprüfung
                </button>
                <button type="button" className="chip" onClick={() => set({ jcc: { ...setup.jcc!, power: setup.jcc!.power === 0.25 ? 0.5 : 0.25 } })}>
                  ±{formatNumber(setup.jcc.power, 2)}
                </button>
              </>
            )}
          </div>
          {setup.jcc && (
            <>
              <div className="patient-pair patient-pair--small">
                <PatientImage chart={chart === 'scene' ? 'landolt' : chart} psf={psfSpecs(doc, patientViewState(doc, viewOptions(setup, 1)), chart, false)} label="Stellung 1" showRows={false} />
                <PatientImage chart={chart === 'scene' ? 'landolt' : chart} psf={psfSpecs(doc, patientViewState(doc, viewOptions(setup, 2)), chart, false)} label="Stellung 2" showRows={false} />
              </div>
              <Readout label="Patient" value={responses.jcc} tone="accent" />
            </>
          )}
        </div>
        <div className="wb-group">
          <div className="wb-group__title">
            <ScanEye size={14} /> Patient sagt
          </div>
          <Readout label="Visus (Schätzung)" value={formatVisus(st.acuity.decimal)} hint="Empirische Näherung aus Blurstärke und Pupille (Smith 1991)" />
          {chart === 'duochrome' && <Readout label="Rot-Grün" value={responses.duochrome} tone="accent" />}
          {chart === 'fan' && <Readout label="Fächer" value={responses.fan} tone="accent" />}
          {st.accommodation > 0.01 && <Readout label="Akkommodation" value={`${formatPower(st.accommodation)} eingesetzt`} hint="Der Patient stellt aktiv scharf – Nebeln entspannt die Akkommodation" />}
          {!hidden && (
            <>
              <Readout label="Restfehler" value={formatRx(st.residualRx)} />
              <Readout label="Blurstärke" value={`${formatNumber(st.acuity.blurStrength, 2)} dpt`} />
            </>
          )}
        </div>
        <TrainingBox source="refraction" netRx={trial.rx} />
      </section>
    </div>
  );
}

function setPatient(patch: Partial<NonNullable<SceneDocument['eye']['patient']>>) {
  const s = useAppStore.getState();
  s.updateEntity(s.doc.eye.id, (e) => {
    const eye = e as SceneDocument['eye'];
    return { ...eye, patient: { age: 30, accommodates: false, ...(eye.patient ?? {}), ...patch } } as typeof e;
  });
}

function patientResponses(doc: SceneDocument, setup: RefractionSetup) {
  const base = patientViewState(doc, viewOptions(setup));
  // Rot-Grün
  const a = doc.eye.anatomy;
  const shift = (d: number): Mat2 => ({ a: base.E.a + d, b: base.E.b, c: base.E.c + d });
  const r = blurStrength(shift(chromaticRefractionShift(a, DUOCHROME.red)));
  const g = blurStrength(shift(chromaticRefractionShift(a, DUOCHROME.green)));
  const dc = compare(r, g, 0.05);
  const duochrome = dc === 0 ? '„Beide Seiten gleich deutlich.“' : dc === 1 ? '„Auf Rot deutlicher.“ (→ mehr Minus)' : '„Auf Grün deutlicher.“ (→ weniger Minus / mehr Plus)';
  // Fächer
  const line = sharpestFanLine(base.E);
  const fan = line === null ? '„Alle Linien gleich schwarz.“' : `„Die Linien bei ${formatNumber(line, 0)}° (TABO) sind am schwärzesten.“`;
  // Kreuzzylinder
  let jcc = '—';
  if (setup.jcc) {
    const p1 = blurStrength(patientViewState(doc, viewOptions(setup, 1)).E);
    const p2 = blurStrength(patientViewState(doc, viewOptions(setup, 2)).E);
    const c = compare(p1, p2);
    jcc = c === 0 ? '„Beide gleich.“' : c === 1 ? '„Stellung 1 ist besser.“' : '„Stellung 2 ist besser.“';
  }
  return { duochrome, fan, jcc };
}
