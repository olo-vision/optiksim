/**
 * Maßeinheiten-System.
 *
 * Interne Konvention (verbindlich für das gesamte Projekt):
 *   - Längen:         Millimeter (1 Three.js-Einheit = 1 mm)
 *   - Winkel:         Grad im Datenmodell, Radiant nur in Rechenfunktionen
 *   - Brechkraft:     Dioptrien (1/m)
 *   - Prismenwirkung: Prismendioptrien (cm/m)
 *   - Brechungsindex: dimensionslos
 *
 * Umrechnungen und Formatierung laufen ausschließlich über dieses Modul,
 * damit später weitere Anzeigeeinheiten ergänzt werden können.
 */

export type UnitId = 'mm' | 'cm' | 'm' | 'deg' | 'rad' | 'dpt' | 'pdpt' | 'n' | 'pct' | 'none';

export interface UnitDefinition {
  id: UnitId;
  symbol: string;
  label: string;
  /** Faktor zur Umrechnung in die interne Basiseinheit der Dimension. */
  toBase: number;
  dimension: 'length' | 'angle' | 'power' | 'prism' | 'index' | 'ratio' | 'none';
}

export const UNITS: Record<UnitId, UnitDefinition> = {
  mm: { id: 'mm', symbol: 'mm', label: 'Millimeter', toBase: 1, dimension: 'length' },
  cm: { id: 'cm', symbol: 'cm', label: 'Zentimeter', toBase: 10, dimension: 'length' },
  m: { id: 'm', symbol: 'm', label: 'Meter', toBase: 1000, dimension: 'length' },
  deg: { id: 'deg', symbol: '°', label: 'Grad', toBase: 1, dimension: 'angle' },
  rad: { id: 'rad', symbol: 'rad', label: 'Radiant', toBase: 180 / Math.PI, dimension: 'angle' },
  dpt: { id: 'dpt', symbol: 'dpt', label: 'Dioptrien', toBase: 1, dimension: 'power' },
  pdpt: { id: 'pdpt', symbol: 'cm/m', label: 'Prismendioptrien', toBase: 1, dimension: 'prism' },
  n: { id: 'n', symbol: '', label: 'Brechungsindex', toBase: 1, dimension: 'index' },
  pct: { id: 'pct', symbol: '%', label: 'Prozent', toBase: 1, dimension: 'ratio' },
  none: { id: 'none', symbol: '', label: '', toBase: 1, dimension: 'none' },
};

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const MM_PER_M = 1000;

/** Konvertiert einen Wert zwischen zwei Einheiten derselben Dimension. */
export function convert(value: number, from: UnitId, to: UnitId): number {
  const a = UNITS[from];
  const b = UNITS[to];
  if (a.dimension !== b.dimension) throw new Error(`Einheiten ${from} und ${to} sind nicht kompatibel`);
  return (value * a.toBase) / b.toBase;
}

const formatters = new Map<number, Intl.NumberFormat>();
function nf(decimals: number) {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f;
}

/** Formatiert eine Zahl im deutschen Format (Dezimalkomma). */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '−∞' : '–';
  const s = nf(decimals).format(Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value);
  return s.replace('-', '−');
}

/** Formatiert mit Einheit, z. B. „12,0 mm“. */
export function formatValue(value: number, unit: UnitId, decimals = 2): string {
  const sym = UNITS[unit].symbol;
  const num = formatNumber(value, decimals);
  if (!sym) return num;
  return unit === 'deg' ? `${num}${sym}` : `${num} ${sym}`;
}

/** Brechkraft mit Vorzeichen, z. B. „+2,50 dpt“. */
export function formatPower(dpt: number, decimals = 2): string {
  if (!Number.isFinite(dpt)) return '–';
  const s = formatNumber(dpt, decimals);
  return `${dpt > 0 && s !== formatNumber(0, decimals) ? '+' : ''}${s} dpt`;
}

/** Tolerantes Parsen von Benutzereingaben (akzeptiert Komma und Punkt, Unicode-Minus). */
export function parseNumber(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, '').replace('−', '-').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

export function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

export function roundTo(v: number, step: number) {
  if (step <= 0) return v;
  const r = Math.round(v / step) * step;
  // Gleitkomma-Artefakte entfernen
  return Number(r.toFixed(Math.max(0, Math.ceil(-Math.log10(step)) + 1)));
}
