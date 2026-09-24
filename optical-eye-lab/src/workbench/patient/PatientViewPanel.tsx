/**
 * Arbeitsbereich Patientensicht (Phase 4): Wie sieht der Patient mit dieser Refraktion und Korrektion?
 * Zeigt Testbild, Vergleich unkorrigiert/korrigiert und die zugrunde liegende Punktbildfunktion.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneDocument } from '@/model/types';
import { useAppStore } from '@/state/store';
import { formatVisus, patientViewState } from '@/engine/optics/vision';
import { solveEyeForRefraction } from '@/engine/physics/eyeRefraction';
import { eigen2, type Rx } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { formatRx } from '@/engine/physics/explain';
import { ExplainButton } from '@/ui/common/Explain';
import { Segmented } from '@/ui/common/controls';
import { PatientImage } from './PatientImage';
import { CHART_LABEL, type ChartKind } from './charts';
import { prismShiftArcmin, psfSpecs } from './psfSpecs';
import { Readout, Stepper } from '../common';
import { useRefractionSetup, viewOptions } from '../refraction/RefractionPanel';

const EXAMPLES: Array<{ label: string; rx: Rx; age?: number }> = [
  { label: 'Emmetropie', rx: { sph: 0, cyl: 0, axis: 180 } },
  { label: 'Myopie −1', rx: { sph: -1, cyl: 0, axis: 180 } },
  { label: 'Myopie −3', rx: { sph: -3, cyl: 0, axis: 180 } },
  { label: 'Hyperopie +2 (25 J.)', rx: { sph: 2, cyl: 0, axis: 180 }, age: 25 },
  { label: 'Hyperopie +2 (60 J.)', rx: { sph: 2, cyl: 0, axis: 180 }, age: 60 },
  { label: 'Astig. A 180', rx: { sph: 0, cyl: -1.5, axis: 180 } },
  { label: 'Astig. A 90', rx: { sph: 0, cyl: -1.5, axis: 90 } },
  { label: 'Astig. A 45', rx: { sph: 0, cyl: -1.5, axis: 45 } },
];

function KernelView({ kernel }: { kernel?: { size: number; data: Float32Array } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !kernel) return;
    const S = 120;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    let max = 0;
    for (const v of kernel.data) max = Math.max(max, v);
    const c = (kernel.size - 1) / 2;
    const scale = Math.max(1, kernel.size / S);
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const x = Math.round(c + (i - S / 2) * scale);
        const y = Math.round(c + (j - S / 2) * scale);
        const v = x >= 0 && y >= 0 && x < kernel.size && y < kernel.size ? kernel.data[y * kernel.size + x] / (max || 1) : 0;
        const k = (j * S + i) * 4;
        const g = Math.pow(v, 0.5);
        img.data[k] = 255 * g;
        img.data[k + 1] = 210 * g;
        img.data[k + 2] = 120 * g;
        img.data[k + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [kernel]);
  return <canvas ref={ref} width={120} height={120} className="psf-view" aria-label="Punktbildfunktion" />;
}

export function PatientViewPanel() {
  const doc = useAppStore((s) => s.doc);
  const quality = useAppStore((s) => s.prefs.visionQuality);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const { setup, set } = useRefractionSetup();
  const [mode, setMode] = useState<'current' | 'compare'>('compare');
  const [kernel, setKernel] = useState<{ size: number; data: Float32Array }>();
  const hidden = !!doc.training?.hidden;
  const chart = setup.chart as ChartKind;
  const st = useMemo(() => patientViewState(doc, viewOptions(setup)), [doc, setup]);
  const unc = useMemo(() => patientViewState(doc, { ...viewOptions(setup), uncorrected: true }), [doc, setup]);
  const hasCorrection = doc.elements.some((e) => e.family === 'lens' && e.visible);
  const e = eigen2(st.E);
  const P = st.pupilDiameter / 2;
  const blurArcmin = (l: number) => ((2 * P * Math.abs(l)) / 1000) * (180 / Math.PI) * 60;

  const applyExample = (x: (typeof EXAMPLES)[number]) => {
    const s = useAppStore.getState();
    s.commit((d: SceneDocument) => ({
      ...d,
      eye: {
        ...d.eye,
        ametropiaMode: 'auto',
        anatomy: solveEyeForRefraction(d.eye.anatomy, x.rx, 'auto').anatomy,
        patient: { age: x.age ?? d.eye.patient?.age ?? 30, accommodates: x.age !== undefined ? true : (d.eye.patient?.accommodates ?? false) },
      },
    }));
    s.notify(`Auge: ${x.label}`, 'info');
  };

  return (
    <div className="wb-panel wb-panel--patient">
      <section className="wb-col wb-col--view">
        <div className="patient-pair">
          {mode === 'compare' && hasCorrection && (
            <PatientImage chart={chart} psf={psfSpecs(doc, unc, chart, quality === 'high')} label="Unkorrigiert" sublabel={`Visus ≈ ${formatVisus(unc.acuity.decimal)}`} visus={unc.acuity.decimal} />
          )}
          <PatientImage
            chart={chart}
            psf={psfSpecs(doc, st, chart, quality === 'high')}
            shiftArcmin={prismShiftArcmin(doc)}
            label={hasCorrection ? 'Mit Korrektion' : 'Sicht des Patienten'}
            sublabel={`Visus ≈ ${formatVisus(st.acuity.decimal)}`}
            visus={st.acuity.decimal}
            onStats={(s) => setKernel(s.kernel)}
          />
        </div>
        <div className="wb-chips">
          {(Object.keys(CHART_LABEL) as ChartKind[]).map((c) => (
            <button key={c} type="button" className={`chip${chart === c ? ' is-on' : ''}`} onClick={() => set({ chart: c })}>
              {CHART_LABEL[c]}
            </button>
          ))}
        </div>
      </section>
      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">Darstellung</div>
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'compare', label: 'Vergleich' },
              { value: 'current', label: 'Nur aktuell' },
            ]}
          />
          <Stepper label="Pupille Ø" value={doc.eye.anatomy.pupilDiameter} step={0.5} min={1} max={8} decimals={1} unit="mm" signed={false} onChange={(v) => useAppStore.getState().updateEntity(doc.eye.id, (x) => ({ ...x, anatomy: { ...(x as typeof doc.eye).anatomy, pupilDiameter: v } }) as typeof x)} />
          <Stepper label="Entfernung" value={setup.testDistance / 1000} step={0.5} min={0.25} max={10} decimals={2} unit="m" signed={false} onChange={(v) => set({ testDistance: v * 1000 })} />
          <label className="wb-check">
            <input type="checkbox" checked={quality === 'high'} onChange={(ev) => setPrefs({ visionQuality: ev.target.checked ? 'high' : 'standard' })} /> Farbsäume (chromatische Aberration) zeigen
          </label>
        </div>
        {!hidden && (
          <div className="wb-group">
            <div className="wb-group__title">Beispiele (Auge einstellen)</div>
            <div className="wb-chips">
              {EXAMPLES.map((x) => (
                <button key={x.label} type="button" className="chip" onClick={() => applyExample(x)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="wb-col">
        <div className="wb-group">
          <div className="wb-group__title">
            Punktbildfunktion
            <ExplainButton
              explanation={{
                title: 'Unschärfe aus Defokus und Astigmatismus',
                formula: 'Δθ = E·x   (x Pupillenpunkt, E Fehlermatrix)  →  Unschärfeellipse mit Durchmessern p·|λ₁|, p·|λ₂|',
                substitution: `p = ${formatNumber(st.pupilDiameter, 1)} mm, λ₁ = ${formatPower(e.l1)}, λ₂ = ${formatPower(e.l2)}`,
                result: `${formatNumber(blurArcmin(e.l1), 1)}′ × ${formatNumber(blurArcmin(e.l2), 1)}′`,
                text: 'Jeder Strahl durch die Pupille trifft die Netzhaut mit einer Abweichung, die proportional zu seiner Höhe und zum Brechungsfehler ist. Das Bild eines Punktes ist daher eine gleichmäßig ausgeleuchtete Ellipse (bei reinem Zylinder eine Linie), überlagert von der Beugung an der Pupille. Das Testbild wird mit dieser Punktbildfunktion gefaltet.',
              }}
            />
          </div>
          <div className="psf-row">
            <KernelView kernel={kernel} />
            <div>
              {!hidden && <Readout label="Restfehler" value={formatRx(st.residualRx)} />}
              <Readout label="Unschärfe" value={`${formatNumber(blurArcmin(e.l1), 1)}′ × ${formatNumber(blurArcmin(e.l2), 1)}′`} hint="Durchmesser der Unschärfeellipse in Winkelminuten" />
              <Readout label="Visus (Schätzung)" value={formatVisus(st.acuity.decimal)} />
              {st.accommodation > 0.01 && <Readout label="Akkommodation" value={formatPower(st.accommodation)} />}
            </div>
          </div>
          <p className="wb-hint">Vereinfachungen: keine Aberrationen höherer Ordnung, keine Streuung, Beugung als Gauß-Näherung. Visus nach empirischer Näherung.</p>
        </div>
      </section>
    </div>
  );
}
