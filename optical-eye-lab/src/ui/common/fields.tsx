/**
 * Eingabefelder im CAD-Stil.
 *  - NumberField: Label ziehen = Wert „scrubben“ (Umschalt ×10, Alt ×0,1),
 *    Pfeiltasten ±Schritt, Eingabe mit Komma oder Punkt, Enter übernimmt, Esc verwirft.
 *  - Jede Scrub-Bewegung ist ein einzelner Undo-Schritt.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clamp, formatNumber, parseNumber, roundTo, UNITS, type UnitId } from '@/core/units';
import { useAppStore } from '@/state/store';
import type { Explanation } from '@/engine/physics/explain';
import { ExplainButton } from './Explain';

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  unit?: UnitId;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  zeroMeansInfinity?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  hint?: string;
  labelClass?: string;
  compact?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  unit = 'none',
  step = 0.1,
  min = -Infinity,
  max = Infinity,
  decimals = 2,
  zeroMeansInfinity,
  disabled,
  readOnly,
  hint,
  labelClass,
  compact,
}: NumberFieldProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrub = useRef<{ x: number; start: number; active: boolean } | null>(null);

  const display = zeroMeansInfinity && value === 0 ? '∞' : formatNumber(value, decimals);
  const sym = UNITS[unit].symbol;

  const commit = (raw: string) => {
    const t = raw.trim();
    if (zeroMeansInfinity && (t === '∞' || t.toLowerCase() === 'inf' || t.toLowerCase() === 'plan')) {
      onChange(0);
      return;
    }
    const v = parseNumber(t);
    if (v === null) return;
    onChange(clamp(v, min, max));
  };

  const nudge = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const f = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    onChange(clamp(roundTo(value + dir * step * f, step * (e.altKey ? 0.1 : 1)), min, max));
  };

  const startEdit = () => {
    setText(zeroMeansInfinity && value === 0 ? '∞' : String(Number(value.toFixed(Math.max(decimals, 4)))).replace('.', ','));
    setEditing(true);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const interactive = !disabled && !readOnly;

  return (
    <div className={`field field--number${disabled ? ' is-disabled' : ''}${readOnly ? ' is-readonly' : ''}${compact ? ' field--compact' : ''}`} data-tip={hint} data-tip-side="left">
      <span
        className={`field__label${interactive ? ' is-scrubbable' : ''}${labelClass ? ` ${labelClass}` : ''}`}
        onPointerDown={(e) => {
          if (!interactive || e.button !== 0) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, start: value, active: false };
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (!s.active && Math.abs(dx) < 3) return;
          if (!s.active) {
            s.active = true;
            useAppStore.getState().beginGesture();
            document.body.classList.add('is-scrubbing');
          }
          const f = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const v = s.start + Math.round(dx / 3) * step * f;
          onChange(clamp(roundTo(v, step * (e.altKey ? 0.1 : 1)), min, max));
        }}
        onPointerUp={(e) => {
          const s = scrub.current;
          scrub.current = null;
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
          if (s?.active) {
            useAppStore.getState().endGesture();
            document.body.classList.remove('is-scrubbing');
          } else if (interactive) startEdit();
        }}
      >
        {label}
      </span>
      <div className="field__control">
        {editing ? (
          <input
            ref={inputRef}
            className="field__input"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              commit(text);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit(text);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const v = parseNumber(text) ?? value;
                const f = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
                const nv = clamp(roundTo(v + (e.key === 'ArrowUp' ? 1 : -1) * step * f, step * (e.altKey ? 0.1 : 1)), min, max);
                setText(String(nv).replace('.', ','));
                onChange(nv);
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <button
            type="button"
            className="field__value"
            disabled={!interactive}
            onClick={() => interactive && startEdit()}
            onKeyDown={(e) => {
              if (!interactive) return;
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                nudge(e.key === 'ArrowUp' ? 1 : -1, e);
              }
            }}
          >
            <span className="field__number">{display}</span>
            {sym && !(zeroMeansInfinity && value === 0) && <span className="field__unit">{sym}</span>}
            {zeroMeansInfinity && value === 0 && <span className="field__unit">plan</span>}
          </button>
        )}
      </div>
    </div>
  );
}

export function Vec3Field({
  label,
  value,
  onChange,
  unit,
  step,
  decimals,
  disabled,
}: {
  label: string;
  value: readonly [number, number, number];
  onChange: (v: [number, number, number]) => void;
  unit: UnitId;
  step: number;
  decimals: number;
  disabled?: boolean;
}) {
  const axes = ['X', 'Y', 'Z'] as const;
  return (
    <div className="vec3">
      <div className="vec3__label">{label}</div>
      <div className="vec3__fields">
        {axes.map((a, i) => (
          <NumberField
            key={a}
            compact
            label={a}
            labelClass={`axis-${a.toLowerCase()}`}
            value={value[i]}
            unit={unit}
            step={step}
            decimals={decimals}
            disabled={disabled}
            onChange={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: ReactNode;
  value: string;
  options: Array<{ value: string; label: string; group?: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return (
    <label className={`field field--select${disabled ? ' is-disabled' : ''}`} data-tip={hint} data-tip-side="left">
      <span className="field__label">{label}</span>
      <div className="field__control">
        <select className="field__select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {groups.length > 1
            ? groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => (o.group ?? '') === g)
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))
            : options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
        </select>
      </div>
    </label>
  );
}

export function TextField({ label, value, onChange, disabled }: { label: ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field field--text">
      <span className="field__label">{label}</span>
      <div className="field__control">
        <input
          className="field__input"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== value && onChange(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(value);
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation();
          }}
        />
      </div>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: ReactNode; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field field--color">
      <span className="field__label">{label}</span>
      <div className="field__control">
        <span className="field__swatch" style={{ background: value }} />
        <span className="field__number">{value.toUpperCase()}</span>
        <input type="color" className="field__color-input" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

export function ToggleField({ label, value, onChange, disabled }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`field field--toggle${disabled ? ' is-disabled' : ''}`}>
      <span className="field__label">{label}</span>
      <div className="field__control field__control--right">
        <span className="toggle">
          <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span className="toggle__track">
            <span className="toggle__thumb" />
          </span>
        </span>
      </div>
    </label>
  );
}

/** Nur-Lese-Zeile für berechnete Werte. */
export function ReadoutRow({ label, value, formula, tone, explain }: { label: ReactNode; value: ReactNode; formula?: string; tone?: 'accent' | 'warn' | 'ok'; explain?: Explanation }) {
  return (
    <div className={`readout${tone ? ` readout--${tone}` : ''}`} data-tip={explain ? undefined : formula} data-tip-side="left">
      <span className="readout__label">{label}</span>
      <span className="readout__value">
        {value}
        {explain && <ExplainButton explanation={explain} />}
      </span>
    </div>
  );
}
