/**
 * Optische Medien (Brechungsindex-Presets).
 * Werte für die d-Linie (λ ≈ 587,6 nm), gerundet. Abbe-Zahlen sind für die
 * spätere Dispersionsberechnung vorbereitet.
 */

export interface OpticalMediumPreset {
  id: string;
  name: string;
  n: number;
  abbe?: number;
  group: 'Grundmedien' | 'Auge' | 'Brillenglas' | 'Kontaktlinse' | 'Sonstige';
  note?: string;
}

export const MEDIA_PRESETS: OpticalMediumPreset[] = [
  { id: 'air', name: 'Luft', n: 1.0, group: 'Grundmedien' },
  { id: 'water', name: 'Wasser', n: 1.333, abbe: 55.8, group: 'Grundmedien' },
  { id: 'tears', name: 'Tränenflüssigkeit', n: 1.336, group: 'Auge' },
  { id: 'cornea', name: 'Hornhaut', n: 1.376, group: 'Auge' },
  { id: 'aqueous', name: 'Kammerwasser', n: 1.336, group: 'Auge' },
  { id: 'crystalline', name: 'Augenlinse (homogen)', n: 1.42, group: 'Auge', note: 'Le-Grand-Modellauge' },
  { id: 'vitreous', name: 'Glaskörper', n: 1.336, group: 'Auge' },
  { id: 'crown', name: 'Kronglas (B270)', n: 1.523, abbe: 58.5, group: 'Brillenglas' },
  { id: 'glass', name: 'Glas (Standard)', n: 1.52, abbe: 58, group: 'Brillenglas' },
  { id: 'cr39', name: 'CR-39 (Kunststoff)', n: 1.5, abbe: 58, group: 'Brillenglas' },
  { id: 'polycarbonate', name: 'Polycarbonat', n: 1.586, abbe: 30, group: 'Brillenglas' },
  { id: 'hi160', name: 'Hochbrechend 1.60', n: 1.6, abbe: 42, group: 'Brillenglas' },
  { id: 'hi167', name: 'Hochbrechend 1.67', n: 1.67, abbe: 32, group: 'Brillenglas' },
  { id: 'hi174', name: 'Hochbrechend 1.74', n: 1.74, abbe: 33, group: 'Brillenglas' },
  { id: 'pmma', name: 'PMMA', n: 1.49, abbe: 57, group: 'Kontaktlinse' },
  { id: 'rgp', name: 'Formstabil (Fluorsilikonacrylat)', n: 1.45, group: 'Kontaktlinse' },
  { id: 'hydrogel', name: 'Hydrogel (weich)', n: 1.43, group: 'Kontaktlinse' },
  { id: 'sihy', name: 'Silikon-Hydrogel', n: 1.42, group: 'Kontaktlinse' },
  { id: 'bk7', name: 'N-BK7 (Optikglas)', n: 1.5168, abbe: 64.2, group: 'Sonstige' },
  { id: 'flint', name: 'Flintglas (SF2)', n: 1.648, abbe: 33.9, group: 'Sonstige' },
];

export const CUSTOM_MEDIUM_ID = 'custom';

export function findMedium(id: string | undefined): OpticalMediumPreset | undefined {
  return MEDIA_PRESETS.find((m) => m.id === id);
}

/** Findet ein Preset, das exakt zum Brechungsindex passt. */
export function matchMediumByIndex(n: number): OpticalMediumPreset | undefined {
  return MEDIA_PRESETS.find((m) => Math.abs(m.n - n) < 1e-4);
}
