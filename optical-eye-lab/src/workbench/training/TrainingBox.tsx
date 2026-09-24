/**
 * Trainingsfall (Phase 4): unbekannten Patienten starten, Ergebnis eingeben, Auswertung mit Rechenweg.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, GraduationCap, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { applyCase, CASE_KIND_LABEL, evaluateCase, generateCase, type CaseEvaluation, type CaseKind } from '@/engine/optics/training';
import { createRetinoscope } from '@/model/instruments';
import { isRetinoscope } from '@/engine/optics/retinoscopy';
import { formatRx } from '@/engine/physics/explain';
import { normalizeAxis, type Rx } from '@/core/math/powerMatrix';
import { Stepper } from '../common';

export function TrainingBox({ source, netRx, grossSph }: { source: 'retinoscopy' | 'refraction'; netRx?: Rx; grossSph?: number }) {
  const training = useAppStore((s) => s.doc.training);
  const step = useAppStore((s) => s.prefs.diopterStep);
  const [kind, setKind] = useState<CaseKind>('random');
  const [answer, setAnswer] = useState<Rx>({ sph: 0, cyl: 0, axis: 180 });
  const [result, setResult] = useState<CaseEvaluation | null>(null);
  const doc = useAppStore((s) => s.doc);
  const evaluation = useMemo(() => result, [result]);

  const start = () => {
    const s = useAppStore.getState();
    const c = generateCase(kind);
    s.commit((d) => {
      let next = applyCase(d, c);
      if (source === 'retinoscopy' && !next.lights.some((l) => isRetinoscope(l))) next = { ...next, lights: [...next.lights, createRetinoscope(next, 667)] };
      return next;
    });
    setResult(null);
    setAnswer({ sph: 0, cyl: 0, axis: 180 });
    s.notify(`Trainingsfall gestartet: ${c.title}`, 'info');
  };

  if (!training)
    return (
      <div className="wb-group wb-group--training">
        <div className="wb-group__title">
          <GraduationCap size={14} /> Training
        </div>
        <p className="wb-hint">Unbekannter Patient: Die Refraktion wird verborgen und muss {source === 'retinoscopy' ? 'skiaskopisch' : 'subjektiv'} bestimmt werden.</p>
        <div className="wb-row">
          <select className="wb-select" value={kind} onChange={(e) => setKind(e.target.value as CaseKind)} aria-label="Art des Falls">
            {(Object.keys(CASE_KIND_LABEL) as CaseKind[]).map((k) => (
              <option key={k} value={k}>
                {CASE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--accent" onClick={start} data-testid="start-training">
            Fall starten
          </button>
        </div>
      </div>
    );

  const submit = () => {
    const ev = evaluateCase(doc, answer, 12, source === 'retinoscopy' ? grossSph : undefined);
    setResult(ev);
    useAppStore.getState().commit((d) => (d.training ? { ...d, training: { ...d.training, submitted: { ...answer, at: new Date().toISOString(), grossSph } } } : d));
  };

  return (
    <div className="wb-group wb-group--training" data-testid="training-box">
      <div className="wb-group__title">
        <GraduationCap size={14} /> {training.title}
      </div>
      <p className="wb-quote">{training.complaint}</p>
      <div className="wb-group__sub">Ihr Ergebnis (Brillenglasebene)</div>
      <Stepper label="Sph" value={answer.sph} step={step} bigStep={1} onChange={(v) => setAnswer({ ...answer, sph: v })} testId="answer-sph" />
      <Stepper label="Cyl" value={answer.cyl} step={step} max={0} onChange={(v) => setAnswer({ ...answer, cyl: Math.min(0, v) })} />
      <Stepper label="Achse" value={answer.axis} step={5} bigStep={45} unit="°" decimals={0} signed={false} onChange={(v) => setAnswer({ ...answer, axis: normalizeAxis(v) })} />
      <div className="wb-row">
        {netRx && (
          <button type="button" className="btn" onClick={() => setAnswer({ sph: Math.round(netRx.sph * 4) / 4, cyl: Math.round(netRx.cyl * 4) / 4, axis: normalizeAxis(Math.round(netRx.axis / 5) * 5) })}>
            Messung übernehmen
          </button>
        )}
        <button type="button" className="btn btn--accent" onClick={submit} data-testid="evaluate">
          <CheckCircle2 size={14} /> Auswerten
        </button>
      </div>
      {evaluation && (
        <div className={`wb-eval wb-eval--${evaluation.grade}`} data-testid="evaluation">
          <strong>{evaluation.gradeLabel}</strong>
          <div>Korrekt: {formatRx(evaluation.truth)}</div>
          <div>Differenz: {formatRx(evaluation.difference)}</div>
          <ol>
            {evaluation.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="wb-row">
        {training.hidden && (
          <button type="button" className="btn btn--ghost" onClick={() => useAppStore.getState().commit((d) => (d.training ? { ...d, training: { ...d.training, hidden: false } } : d))}>
            <Eye size={14} /> Werte zeigen
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={start}>
          <RefreshCw size={14} /> Neuer Fall
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            useAppStore.getState().commit((d) => ({ ...d, training: undefined }));
            setResult(null);
          }}
        >
          <X size={14} /> Beenden
        </button>
      </div>
    </div>
  );
}
