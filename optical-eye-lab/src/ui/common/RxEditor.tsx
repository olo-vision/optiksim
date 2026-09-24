/**
 * Eingabe einer sphäro-zylindrischen Wirkung (Sphäre / Zylinder / Achse).
 * Die angezeigten Werte werden immer aus der Geometrie abgeleitet; Änderungen werden als
 * vollständiges Rezept gemeldet und vom Aufrufer in Geometrie umgerechnet.
 * Plus- und Minuszylinder werden gleichwertig akzeptiert (Umschalter = nur Schreibweise).
 */
import { normalizeAxis, toCylForm, transposeRx, type CylForm, type Rx } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { useAppStore } from '@/state/store';
import { NumberField } from './fields';
import { Segmented } from './controls';

export function RxEditor({ value, onChange, disabled, sphLabel = 'Sphäre', hint }: { value: Rx; onChange: (rx: Rx) => void; disabled?: boolean; sphLabel?: string; hint?: string }) {
  const form = useAppStore((s) => s.prefs.cylForm);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const step = useAppStore((s) => s.prefs.diopterStep);
  const shown = toCylForm(value, form);
  const other = transposeRx(shown);
  const hasCyl = Math.abs(shown.cyl) > 0.004;
  const emit = (rx: Rx) => onChange({ ...rx, axis: normalizeAxis(rx.axis) });
  return (
    <div className="rx-editor" data-testid="rx-editor">
      <div className="rx-editor__top">
        <span className="rx-editor__hint">{hint}</span>
        <Segmented<CylForm>
          size="sm"
          value={form}
          onChange={(v) => setPrefs({ cylForm: v })}
          options={[
            { value: 'minus', label: '− Cyl', tip: 'Minuszylinder-Schreibweise' },
            { value: 'plus', label: '+ Cyl', tip: 'Pluszylinder-Schreibweise' },
          ]}
        />
      </div>
      <NumberField label={sphLabel} unit="dpt" step={step} decimals={2} min={-40} max={40} value={shown.sph} disabled={disabled} onChange={(v) => emit({ ...shown, sph: v })} />
      <NumberField label="Zylinder" unit="dpt" step={step} decimals={2} min={-15} max={15} value={shown.cyl} disabled={disabled} onChange={(v) => emit({ ...shown, cyl: v })} />
      <NumberField label="Achse" unit="deg" step={1} decimals={0} min={0} max={180} value={Math.round(shown.axis)} disabled={disabled} onChange={(v) => emit({ ...shown, axis: v })} />
      {hasCyl && (
        <div className="rx-editor__transposed" data-tip="Transponierte, physikalisch identische Schreibweise" data-tip-side="left">
          ≙ {formatPower(other.sph)} / {formatPower(other.cyl)} A {formatNumber(other.axis, 0)}°
        </div>
      )}
    </div>
  );
}
