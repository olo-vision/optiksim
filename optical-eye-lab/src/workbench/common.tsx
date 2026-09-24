/**
 * Gemeinsame Bausteine der Arbeitsbereiche (Phase 4): Zugriff auf Messglas und Skiaskop,
 * kompakte Dioptrien-Steuerung, Readouts.
 */
import { useCallback, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { LensElement, LightSourceEntity, RetinoscopeParams } from '@/model/types';
import { useAppStore } from '@/state/store';
import { createRetinoscope, createTrialLens, setTrialRx, TRIAL_VERTEX_DISTANCE } from '@/model/instruments';
import { DEFAULT_RETINOSCOPE, findTrialLens, isRetinoscope } from '@/engine/optics/retinoscopy';
import { lensOptics } from '@/engine/physics/lensOptics';
import { normalizeAxis, type Rx } from '@/core/math/powerMatrix';
import { formatNumber } from '@/core/units';

/* ------------------------------ Messglas ------------------------------ */

export function useTrialLens() {
  const doc = useAppStore((s) => s.doc);
  const el = findTrialLens(doc);
  const rx: Rx = el ? lensOptics(el, doc.eye).rx : { sph: 0, cyl: 0, axis: 180 };
  const setRx = useCallback((next: Rx) => {
    const s = useAppStore.getState();
    const clean: Rx = { sph: round(next.sph), cyl: Math.min(0, round(next.cyl)), axis: normalizeAxis(Math.round(next.axis)) };
    s.commit((d) => {
      const cur = findTrialLens(d);
      if (!cur) return { ...d, elements: [...d.elements, createTrialLens(d, clean, TRIAL_VERTEX_DISTANCE)] };
      return { ...d, elements: d.elements.map((e) => (e.id === cur.id ? setTrialRx(d, cur, clean) : e)) };
    });
  }, []);
  const ensure = useCallback(() => {
    const s = useAppStore.getState();
    if (findTrialLens(s.doc)) return;
    s.commit((d) => ({ ...d, elements: [...d.elements, createTrialLens(d, { sph: 0, cyl: 0, axis: 180 }, TRIAL_VERTEX_DISTANCE)] }));
  }, []);
  const remove = useCallback(() => {
    const s = useAppStore.getState();
    const cur = findTrialLens(s.doc);
    if (cur) s.commit((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== cur.id) }));
  }, []);
  const setPrism = useCallback((prism: LensElement['trialPrism']) => {
    const s = useAppStore.getState();
    const cur = findTrialLens(s.doc);
    if (cur) s.updateEntity(cur.id, (e) => ({ ...e, trialPrism: prism }) as LensElement);
  }, []);
  return { el, rx, setRx, ensure, remove, setPrism };
}

const round = (v: number) => Math.round(v * 400) / 400; // 0,0025-Raster, Anzeige auf 0,01

/* ------------------------------ Skiaskop ------------------------------ */

export function useRetinoscope() {
  const scope = useAppStore((s) => s.doc.lights.find((l) => isRetinoscope(l)));
  const params: RetinoscopeParams = { ...DEFAULT_RETINOSCOPE, ...(scope?.retinoscope ?? {}) };
  const set = useCallback((patch: Partial<RetinoscopeParams>) => {
    const s = useAppStore.getState();
    const cur = s.doc.lights.find((l) => isRetinoscope(l));
    if (!cur) return;
    s.updateEntity(cur.id, (e) => ({ ...e, retinoscope: { ...DEFAULT_RETINOSCOPE, ...((e as LightSourceEntity).retinoscope ?? {}), ...patch } }) as LightSourceEntity);
  }, []);
  const ensure = useCallback(() => {
    const s = useAppStore.getState();
    if (s.doc.lights.some((l) => isRetinoscope(l))) return;
    s.commit((d) => ({ ...d, lights: [...d.lights, createRetinoscope(d, 667)] }));
    s.notify('Skiaskop im Arbeitsabstand 66,7 cm aufgestellt', 'success');
  }, []);
  return { scope, params, set, ensure };
}

/* ------------------------------ Steuerung ------------------------------ */

export function Stepper({
  label,
  value,
  onChange,
  step,
  bigStep,
  min,
  max,
  decimals = 2,
  unit = 'dpt',
  signed = true,
  disabled,
  testId,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  step: number;
  bigStep?: number;
  min?: number;
  max?: number;
  decimals?: number;
  unit?: string;
  signed?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const shown = `${signed && value > 0.0001 ? '+' : ''}${formatNumber(value, decimals)}`;
  return (
    <div className="wb-stepper" data-testid={testId}>
      <span className="wb-stepper__label">{label}</span>
      <div className="wb-stepper__ctrl">
        {bigStep && (
          <button type="button" className="wb-stepper__btn wb-stepper__btn--big" disabled={disabled} onClick={() => onChange(clamp(value - bigStep))} aria-label={`${label} −${bigStep}`}>
            −{formatNumber(bigStep, bigStep < 1 ? 2 : 0)}
          </button>
        )}
        <button type="button" className="wb-stepper__btn" disabled={disabled} onClick={() => onChange(clamp(value - step))} aria-label={`${label} verringern`}>
          <Minus size={13} />
        </button>
        <output className="wb-stepper__value">
          {shown}
          <small>{unit}</small>
        </output>
        <button type="button" className="wb-stepper__btn" disabled={disabled} onClick={() => onChange(clamp(value + step))} aria-label={`${label} erhöhen`}>
          <Plus size={13} />
        </button>
        {bigStep && (
          <button type="button" className="wb-stepper__btn wb-stepper__btn--big" disabled={disabled} onClick={() => onChange(clamp(value + bigStep))} aria-label={`${label} +${bigStep}`}>
            +{formatNumber(bigStep, bigStep < 1 ? 2 : 0)}
          </button>
        )}
      </div>
    </div>
  );
}

/** Sph / Cyl / Achse eines Messglases */
export function TrialLensControls({ rx, onChange, disabled, title = 'Messglas (HSA 12 mm)' }: { rx: Rx; onChange: (rx: Rx) => void; disabled?: boolean; title?: string }) {
  const step = useAppStore((s) => s.prefs.diopterStep);
  return (
    <div className="wb-group" data-testid="trial-lens">
      <div className="wb-group__title">{title}</div>
      <Stepper label="Sph" value={rx.sph} step={step} bigStep={1} min={-20} max={20} onChange={(v) => onChange({ ...rx, sph: v })} disabled={disabled} testId="trial-sph" />
      <Stepper label="Cyl" value={rx.cyl} step={step} bigStep={1} min={-8} max={0} onChange={(v) => onChange({ ...rx, cyl: v })} disabled={disabled} testId="trial-cyl" />
      <Stepper label="Achse" value={rx.axis} step={5} bigStep={45} unit="°" decimals={0} signed={false} onChange={(v) => onChange({ ...rx, axis: normalizeAxis(v) })} disabled={disabled} testId="trial-axis" />
    </div>
  );
}

export function Readout({ label, value, tone, hint }: { label: ReactNode; value: ReactNode; tone?: 'ok' | 'warn' | 'accent' | 'danger'; hint?: string }) {
  return (
    <div className={`wb-readout${tone ? ` wb-readout--${tone}` : ''}`} data-tip={hint}>
      <span className="wb-readout__label">{label}</span>
      <span className="wb-readout__value">{value}</span>
    </div>
  );
}

export function Hidden({ children }: { children?: ReactNode }) {
  return (
    <span className="wb-hidden" data-tip="Im Trainingsfall verborgen">
      {children ?? 'verborgen'}
    </span>
  );
}
