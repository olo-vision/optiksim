/**
 * Branding (White-Label-Vorbereitung): Produktname, Akzentfarbe, Logo, Firmenname.
 * Die Akzentfarbe wird als CSS-Variable gesetzt; abgeleitete Töne werden berechnet.
 */
import type { Branding } from './models';

export const PRODUCT_NAME = 'Optical Eye Lab';
export const DEFAULT_ACCENT = '#4cc2ff';

export const DEFAULT_BRANDING: Branding = { productName: PRODUCT_NAME, accentColor: DEFAULT_ACCENT };

export const ACCENT_PRESETS = ['#4cc2ff', '#45d6a0', '#7c8cff', '#c38bff', '#ff8a5c', '#ffb547', '#f06292', '#5ad1c9'];

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const isValidHex = (hex: string) => parseHex(hex) !== null;

function mix(c: [number, number, number], t: number): string {
  const [r, g, b] = c.map((v) => Math.round(v + (255 - v) * t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Setzt die Akzentfarbe global (Oberfläche). */
export function applyAccent(hex: string | undefined) {
  if (typeof document === 'undefined') return;
  const c = parseHex(hex ?? '') ?? parseHex(DEFAULT_ACCENT)!;
  const root = document.documentElement.style;
  const [r, g, b] = c;
  root.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  root.setProperty('--accent-strong', mix(c, 0.3));
  root.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.12)`);
  root.setProperty('--accent-bg-strong', `rgba(${r}, ${g}, ${b}, 0.2)`);
  root.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.38)`);
}

export function applyDocumentTitle(productName: string | undefined, page?: string) {
  if (typeof document === 'undefined') return;
  const name = productName?.trim() || PRODUCT_NAME;
  document.title = page ? `${page} · ${name}` : name;
}
