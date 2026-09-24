/**
 * Deklarative Beschreibung von Inspector-Feldern.
 * Neue Objektarten liefern ihre Felder als Daten – der Inspector rendert sie generisch.
 */
import type { UnitId } from '@/core/units';

export interface FieldOption {
  value: string;
  label: string;
}

interface FieldBase<T> {
  /** Pfad im Objekt, z. B. "lens.frontRadius" */
  path: string;
  label: string;
  hint?: string;
  /** Feld nur anzeigen, wenn Bedingung erfüllt */
  visibleIf?: (entity: T) => boolean;
  /** Feld schreibgeschützt */
  readOnly?: boolean;
}

export interface NumberFieldDef<T> extends FieldBase<T> {
  type: 'number';
  unit: UnitId;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  /** 0 als „∞ (plan)“ darstellen */
  zeroMeansInfinity?: boolean;
}

export interface SelectFieldDef<T> extends FieldBase<T> {
  type: 'select';
  options: FieldOption[];
}

export interface ToggleFieldDef<T> extends FieldBase<T> {
  type: 'toggle';
}

export interface ColorFieldDef<T> extends FieldBase<T> {
  type: 'color';
}

export type FieldDef<T = unknown> = NumberFieldDef<T> | SelectFieldDef<T> | ToggleFieldDef<T> | ColorFieldDef<T>;

export interface FieldGroup<T = unknown> {
  id: string;
  title: string;
  fields: FieldDef<T>[];
}

/** Liest einen Wert über einen Punkt-Pfad. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Setzt einen Wert unveränderlich (structural sharing) über einen Punkt-Pfad. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const rec = (o: unknown, i: number): unknown => {
    const k = keys[i];
    const base = (o ?? {}) as Record<string, unknown>;
    const copy: Record<string, unknown> = Array.isArray(base) ? ([...base] as unknown as Record<string, unknown>) : { ...base };
    copy[k] = i === keys.length - 1 ? value : rec(base[k], i + 1);
    return copy;
  };
  return rec(obj, 0) as T;
}
