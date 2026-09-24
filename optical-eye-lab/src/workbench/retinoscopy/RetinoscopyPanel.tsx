/**
 * Arbeitsbereich Skiaskopie (Phase 4).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCw } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { MOTION_LABEL, retinoscopyState, scopeGeometry, workingDistanceCorrection } from '@/engine/optics/retinoscopy';
import { placeRetinoscope, TRIAL_VERTEX_DISTANCE } from '@/model/instruments';
import { formatNumber, formatPower } from '@/core/units';
import { formatRx } from '@/engine/physics/explain';
import { Segmented } from '@/ui/common/controls';
import { ExplainButton } from '@/ui/common/Explain';
import { PupilReflexView } from './PupilReflexView';
import { Readout, Stepper, TrialLensControls, useRetinoscope, useTrialLens } from '../common';
import { TrainingBox } from '../training/TrainingBox';

export function RetinoscopyPanel() {
  const doc = useAppStore((s) => s.doc);
  const expert = useAppStore((s) => s.prefs.expertMode);
  const { scope, params, set, ensure } = useRetinoscope();
  const trial = useTrialLens();
  const hidden = !!doc.training?.hidden;
  const [sweep, setSweep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [guides, setGuides] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!scope) ensure();
  }, [scope, ensure]);

  // automatischer Schwenk (±3 mm, 1,6 s)
  useEffect(() => {
    if (!auto) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      setSweep(3 * Math.sin(((t - t0) / 1600) * Math.PI * 2));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [auto]);

  const base = useMemo(() => (scope ? retinoscopyState(doc, scope) : null), [doc, scope]);
  const model = useMemo(() => (base ? { ...base, params: { ...base.params, sweep } } : null), [base, sweep]);

  if (!scope || !model || !base) {
    return <div className="wb-empty">{scope ? 'Das Skiaskop muss vor dem Auge stehen (Arbeitsabstand mindestens 5 cm).' : 'Skiaskop wird aufgestellt …'}</div>;
  }

  const geo = scopeGeometry(doc, scope);
  const w = geo.workingDistance;
  const wd = workingDistanceCorrection(trial.rx, w, TRIAL_VERTEX_DISTANCE);
  const setWorkingDistance = (mm: number) => {
    const s = useAppStore.getState();
    s.updateEntity(scope.id, (e) => placeRetinoscope(s.doc, e as typeof scope, mm, [geo.local[0], geo.local[1]]));
  };
  const motion = model.motion;
  const speed = Number.isFinite(model.speed) ? Math.abs(model.speed) : Infinity;
  const k = model.principal;

  return (
    <div className="wb-panel wb-panel--retinoscopy">
      <section className="wb-col wb-col--view">
        <PupilReflexView model={model} irisColor={doc.eye.irisColor} onSweep={(d) => setSweep((v) => Math.max(-8, Math.min(8, v + d)))} showGuides={guides && !hidden} />
        <div className="wb-row">
          <button type="button" className={`btn${auto ? ' is-active' : ''}`} onClick={() => setAuto(!auto)} data-testid="auto-sweep">
            {auto ? <Pause size={14} /> : <Play size={14} />}
            <span>{auto ? 'Schwenk stoppen' : 'Automatisch schwenken'}</span>
          </button>
          <input
            className="wb-range"
            type="range"
            min={-8}
            max={8}
            step={0.05}
            value={sweep}
            onChange={(e) => {
              setAuto(false);
              setSweep(Number(e.target.value));
            }}
            aria-label="Schwenk"
            data-testid="sweep"
          />
        </div>
        <p className="wb-hint">Im Bild ziehen oder den Regler bewegen, um das Lichtband über die Pupille zu schwenken. Beobachte, ob der Reflex mit oder gegen das Lichtband läuft.</p>
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">Skiaskop</div>
          <Stepper label="Abstand" value={w / 10} step={1} bigStep={10} min={10} max={200} decimals={1} unit="cm" signed={false} onChange={(v) => setWorkingDistance(v * 10)} testId="working-distance" />
          <div className="wb-chips">
            {[50, 66.7, 100].map((cm) => (
              <button key={cm} type="button" className={`chip${Math.abs(w / 10 - cm) < 0.2 ? ' is-on' : ''}`} onClick={() => setWorkingDistance(cm * 10)}>
                {formatNumber(cm, cm % 1 ? 1 : 0)} cm
              </button>
            ))}
          </div>
          <div className="wb-field">
            <span>Strichlage</span>
            <input className="wb-range" type="range" min={0} max={180} step={1} value={params.streakAxis} onChange={(e) => set({ streakAxis: Number(e.target.value) || 180 })} aria-label="Strichlage" data-testid="streak-axis" />
            <output className="wb-num">{Math.round(params.streakAxis)}°</output>
            <button type="button" className="icon-btn icon-btn--ghost icon-btn--sm" onClick={() => set({ streakAxis: params.streakAxis >= 90 ? params.streakAxis - 90 : params.streakAxis + 90 })} data-tip="Strich um 90° drehen">
              <RotateCw size={13} />
            </button>
          </div>
          <div className="wb-field">
            <span>Spiegel</span>
            <Segmented
              size="sm"
              value={params.sleeve}
              onChange={(v) => set({ sleeve: v })}
              options={[
                { value: 'plane', label: 'Plan', tip: 'Divergentes Bündel (Standard)' },
                { value: 'concave', label: 'Konkav', tip: 'Konvergentes Bündel – Bewegungen kehren sich um' },
              ]}
            />
          </div>
          <Stepper label="Strichbreite" value={params.streakWidth} step={0.5} min={0.5} max={8} decimals={1} unit="mm" signed={false} onChange={(v) => set({ streakWidth: v })} />
          <Stepper label="Intensität" value={params.intensity * 100} step={10} min={10} max={100} decimals={0} unit="%" signed={false} onChange={(v) => set({ intensity: v / 100 })} />
          {expert && <Stepper label="Guckloch Ø" value={params.peephole} step={0.5} min={1} max={5} decimals={1} unit="mm" signed={false} onChange={(v) => set({ peephole: v })} />}
          <Stepper
            label="Pupille Ø"
            value={doc.eye.anatomy.pupilDiameter}
            step={0.5}
            min={1.5}
            max={8}
            decimals={1}
            unit="mm"
            signed={false}
            onChange={(v) => useAppStore.getState().updateEntity(doc.eye.id, (e) => ({ ...e, anatomy: { ...(e as typeof doc.eye).anatomy, pupilDiameter: v } }) as typeof e)}
          />
        </div>
      </section>

      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">
            Beobachtung
            <ExplainButton
              explanation={{
                title: 'Reflexbewegung',
                formula: 'E = A_Auge − L_HS(Guckloch);   k = (d/s) / (1 + w·R)',
                substitution: `w = ${formatNumber(w / 1000, 3)} m, Neutralpunkt: Fernpunkt im Guckloch (E = 0)`,
                result: hidden ? '—' : `${MOTION_LABEL[motion]} im geschwenkten Meridian`,
                text: 'Liegt der Fernpunkt des Systems (Auge + Glas) hinter dem Untersucher oder hinter dem Auge, bewegt sich der Reflex mit dem Lichtband (Mitbewegung). Liegt er zwischen Auge und Untersucher, entsteht Gegenbewegung. Liegt er genau im Guckloch, leuchtet die Pupille ganz auf (Neutralisation). Je näher am Neutralpunkt, desto schneller, breiter und heller der Reflex.',
              }}
            />
          </div>
          {hidden ? (
            <p className="wb-hint">Trainingsfall: Bewegung selbst beobachten. Tipp: Strich drehen, bis Reflex und Lichtband parallel laufen (kein Knick) – dann liegt der Strich in einem Hauptschnitt.</p>
          ) : (
            <>
              <Readout label="Bewegung" value={MOTION_LABEL[motion]} tone={motion === 'neutral' ? 'ok' : 'accent'} />
              <Readout label="Reflexgeschwindigkeit" value={speed === Infinity ? '∞ (Aufleuchten)' : `${formatNumber(speed, 2)} × Lichtband`} />
              <Readout label="Reflexbreite" value={Number.isFinite(model.bandWidth) ? `${formatNumber(Math.min(model.bandWidth, 99), 1)} mm` : 'ganze Pupille'} />
              <Readout label="Helligkeit" value={`${Math.round(model.brightness * 100)} %`} />
              <Readout label="Knick (Break/Skew)" value={`${formatNumber(model.skew, 0)}°`} tone={model.skew > 3 ? 'warn' : undefined} hint="Winkel zwischen Reflexband und Lichtstrich – > 0°: Strich liegt nicht im Hauptschnitt" />
              <label className="wb-check">
                <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Reflexrichtung einzeichnen
              </label>
              {expert && (
                <>
                  <Readout label={`Hauptschnitt ${formatNumber(k[0].meridian, 0)}°`} value={`${formatPower(k[0].error)} · ${MOTION_LABEL[k[0].motion]}`} />
                  <Readout label={`Hauptschnitt ${formatNumber(k[1].meridian, 0)}°`} value={`${formatPower(k[1].error)} · ${MOTION_LABEL[k[1].motion]}`} />
                </>
              )}
            </>
          )}
          {base.notes.map((n) => (
            <p key={n} className="wb-hint">
              {n}
            </p>
          ))}
        </div>
      </section>

      <section className="wb-col">
        <TrialLensControls rx={trial.rx} onChange={trial.setRx} title="Neutralisationsglas (HSA 12 mm)" />
        <div className="wb-group">
          <div className="wb-group__title">
            Arbeitsabstand berücksichtigen
            <ExplainButton
              explanation={{
                title: 'Arbeitsabstandskorrektur',
                formula: 'Refraktion = Neutralisationswert − 1/(w − HSA)',
                substitution: `1/(${formatNumber((w - TRIAL_VERTEX_DISTANCE) / 1000, 3)} m) = ${formatPower(wd.workingLens)}`,
                result: formatRx(wd.net),
                text: 'Bei Neutralisation liegt der Fernpunkt im Guckloch, nicht im Unendlichen. Das Glas enthält deshalb zusätzlich +1/w. Diesen Anteil zieht man ab (z. B. +1,50 dpt bei 66,7 cm) – gemessen ab Brillenglasebene.',
              }}
            />
          </div>
          <Readout label="Brutto (Glas)" value={formatRx(trial.rx)} />
          <Readout label="Arbeitsabstandsglas" value={formatPower(wd.workingLens)} />
          <Readout label="Netto (Refraktion)" value={formatRx(wd.net)} tone="accent" />
        </div>
        <TrainingBox source="retinoscopy" netRx={wd.net} grossSph={trial.rx.sph} />
      </section>
    </div>
  );
}
