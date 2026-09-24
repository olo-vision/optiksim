/**
 * Medien- und Materialbibliothek (Phase 4).
 *
 * Getrennte Kategorien – ein Material erscheint nur dort, wo es fachlich hingehört:
 *   AUGENMEDIEN        Luft, Tränenfilm, Hornhaut, Kammerwasser, Augenlinse, Glaskörper (Le-Grand-Werte)
 *   BRILLENGLÄSER      Kunststoff · Mineral   (n_d, ν_d, Dichte, UV-Grenze)
 *   KONTAKTLINSEN      formstabil · Hydrogel · Silikon-Hydrogel   (n, Dk, Wassergehalt, Modul …)
 *   WEITERE OPTIK      Wasser, Optikgläser, Acryl, frei definierbar
 *
 * Alle Werte sind GENERISCHE, typische Werte (gerundet) – keine Markenprodukte.
 * Brechungsindizes gelten für die d-Linie (587,6 nm). Die Dispersion wird aus ν_d berechnet
 * (engine/optics/dispersion.ts). Die IDs der Phase-1/2-Presets bleiben unverändert (gespeicherte Szenen).
 */
import type { ElementKind } from './types';

export type MaterialCategory = 'eye' | 'spectacle' | 'contact-rigid' | 'contact-hydrogel' | 'contact-sihy' | 'other';

export interface OpticalMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Untergruppe für die Auswahl (z. B. „Kunststoff“, „Mineral“, „FDA-Gruppe I“) */
  subgroup: string;
  /** Brechungsindex n_d */
  n: number;
  /** Abbe-Zahl ν_d */
  abbe?: number;
  /** Dichte [g/cm³] */
  density?: number;
  /** UV-Kante (50-%-Transmission) [nm] – Richtwert */
  uvCutoff?: number;
  /** Sauerstoffdurchlässigkeit Dk [×10⁻¹¹ (cm²/s)·(ml O₂/(ml·mmHg))] („barrer“) */
  dk?: number;
  /** Wassergehalt [%] (weiche Linsen) */
  waterContent?: number;
  /** Elastizitätsmodul [MPa] (weiche Linsen) */
  modulus?: number;
  /** Benetzungswinkel [°] (formstabil, Richtwert) */
  wettingAngle?: number;
  note?: string;
}

/** Gruppierung für bestehende Auswahlfelder (Phase 1–3) */
export type LegacyGroup = 'Grundmedien' | 'Auge' | 'Brillenglas' | 'Kontaktlinse' | 'Sonstige';

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  eye: 'Augenmedien',
  spectacle: 'Brillenglas',
  'contact-rigid': 'Kontaktlinse formstabil',
  'contact-hydrogel': 'Kontaktlinse Hydrogel',
  'contact-sihy': 'Kontaktlinse Silikon-Hydrogel',
  other: 'Weitere Optik',
};

/** Dk von Hydrogelen aus dem Wassergehalt (Fatt/Morgan-Efron-Beziehung): Dk ≈ 2,0·e^(0,0411·WG) */
export const hydrogelDk = (waterContent: number) => 2.0 * Math.exp(0.0411 * waterContent);

export const MATERIALS: OpticalMaterial[] = [
  // ---------------------------- Augenmedien (Le Grand) ----------------------------
  { id: 'air', name: 'Luft', category: 'eye', subgroup: 'Umgebung', n: 1.0 },
  { id: 'tears', name: 'Tränenfilm', category: 'eye', subgroup: 'Auge', n: 1.336, abbe: 55.8 },
  { id: 'cornea', name: 'Hornhaut', category: 'eye', subgroup: 'Auge', n: 1.376, abbe: 55.8 },
  { id: 'aqueous', name: 'Kammerwasser', category: 'eye', subgroup: 'Auge', n: 1.336, abbe: 55.8 },
  { id: 'crystalline', name: 'Augenlinse (homogen)', category: 'eye', subgroup: 'Auge', n: 1.42, abbe: 55.8, note: 'Le-Grand-Modellauge, homogener Ersatzindex' },
  { id: 'vitreous', name: 'Glaskörper', category: 'eye', subgroup: 'Auge', n: 1.336, abbe: 55.8 },

  // ---------------------------- Brillenglas: Kunststoff ----------------------------
  { id: 'cr39', name: 'Standard-Kunststoff (ADC) 1,50', category: 'spectacle', subgroup: 'Kunststoff', n: 1.5, abbe: 58, density: 1.32, uvCutoff: 355 },
  { id: 'urethane153', name: 'Urethan-Kunststoff 1,53', category: 'spectacle', subgroup: 'Kunststoff', n: 1.53, abbe: 45, density: 1.11, uvCutoff: 394 },
  { id: 'polycarbonate', name: 'Polycarbonat 1,59', category: 'spectacle', subgroup: 'Kunststoff', n: 1.586, abbe: 30, density: 1.2, uvCutoff: 385 },
  { id: 'hi160', name: 'Kunststoff 1,60', category: 'spectacle', subgroup: 'Kunststoff', n: 1.6, abbe: 42, density: 1.3, uvCutoff: 395 },
  { id: 'hi167', name: 'Kunststoff 1,67', category: 'spectacle', subgroup: 'Kunststoff', n: 1.67, abbe: 32, density: 1.35, uvCutoff: 398 },
  { id: 'hi174', name: 'Kunststoff 1,74', category: 'spectacle', subgroup: 'Kunststoff', n: 1.74, abbe: 33, density: 1.46, uvCutoff: 398 },
  // ---------------------------- Brillenglas: Mineral ----------------------------
  { id: 'crown', name: 'Kronglas 1,523 (Mineral Standard)', category: 'spectacle', subgroup: 'Mineral', n: 1.523, abbe: 58.5, density: 2.54, uvCutoff: 320 },
  { id: 'glass', name: 'Mineralglas 1,52', category: 'spectacle', subgroup: 'Mineral', n: 1.52, abbe: 58, density: 2.5, uvCutoff: 320 },
  { id: 'min160', name: 'Mineral hochbrechend 1,60', category: 'spectacle', subgroup: 'Mineral', n: 1.6, abbe: 42, density: 2.6, uvCutoff: 335 },
  { id: 'min170', name: 'Mineral hochbrechend 1,70', category: 'spectacle', subgroup: 'Mineral', n: 1.7, abbe: 41, density: 3.2, uvCutoff: 340 },
  { id: 'min180', name: 'Mineral hochbrechend 1,80', category: 'spectacle', subgroup: 'Mineral', n: 1.8, abbe: 35, density: 3.6, uvCutoff: 345 },
  { id: 'min190', name: 'Mineral hochbrechend 1,90', category: 'spectacle', subgroup: 'Mineral', n: 1.9, abbe: 31, density: 4.0, uvCutoff: 350 },

  // ---------------------------- Kontaktlinse formstabil ----------------------------
  { id: 'pmma', name: 'PMMA', category: 'contact-rigid', subgroup: 'formstabil', n: 1.49, abbe: 57, density: 1.19, dk: 0.5, wettingAngle: 60, note: 'praktisch sauerstoffundurchlässig' },
  { id: 'sa-low', name: 'Silikonacrylat (Dk niedrig)', category: 'contact-rigid', subgroup: 'formstabil', n: 1.47, abbe: 50, density: 1.12, dk: 25, wettingAngle: 25 },
  { id: 'rgp', name: 'Fluorsilikonacrylat (Dk mittel)', category: 'contact-rigid', subgroup: 'formstabil', n: 1.45, abbe: 48, density: 1.16, dk: 60, wettingAngle: 30 },
  { id: 'fsa-high', name: 'Fluorsilikonacrylat (Dk hoch)', category: 'contact-rigid', subgroup: 'formstabil', n: 1.44, abbe: 47, density: 1.12, dk: 100, wettingAngle: 35 },
  { id: 'fsa-hyper', name: 'Fluorsilikonacrylat (Dk sehr hoch)', category: 'contact-rigid', subgroup: 'formstabil', n: 1.42, abbe: 46, density: 1.1, dk: 140, wettingAngle: 40 },

  // ---------------------------- Kontaktlinse Hydrogel ----------------------------
  { id: 'hydrogel', name: 'Hydrogel nichtionisch, 38 % (Gruppe I)', category: 'contact-hydrogel', subgroup: 'FDA-Gruppe I', n: 1.43, abbe: 55, waterContent: 38, dk: Math.round(hydrogelDk(38) * 10) / 10, modulus: 0.5 },
  { id: 'hg-2', name: 'Hydrogel nichtionisch, 70 % (Gruppe II)', category: 'contact-hydrogel', subgroup: 'FDA-Gruppe II', n: 1.39, abbe: 55, waterContent: 70, dk: Math.round(hydrogelDk(70) * 10) / 10, modulus: 0.3 },
  { id: 'hg-3', name: 'Hydrogel ionisch, 45 % (Gruppe III)', category: 'contact-hydrogel', subgroup: 'FDA-Gruppe III', n: 1.42, abbe: 55, waterContent: 45, dk: Math.round(hydrogelDk(45) * 10) / 10, modulus: 0.4 },
  { id: 'hg-4', name: 'Hydrogel ionisch, 58 % (Gruppe IV)', category: 'contact-hydrogel', subgroup: 'FDA-Gruppe IV', n: 1.4, abbe: 55, waterContent: 58, dk: Math.round(hydrogelDk(58) * 10) / 10, modulus: 0.35 },

  // ---------------------------- Kontaktlinse Silikon-Hydrogel ----------------------------
  { id: 'sihy', name: 'Silikon-Hydrogel, 33 % (hohes Dk)', category: 'contact-sihy', subgroup: 'Silikon-Hydrogel', n: 1.42, abbe: 52, waterContent: 33, dk: 110, modulus: 1.1 },
  { id: 'sihy-2', name: 'Silikon-Hydrogel, 24 % (sehr hohes Dk)', category: 'contact-sihy', subgroup: 'Silikon-Hydrogel', n: 1.43, abbe: 52, waterContent: 24, dk: 140, modulus: 1.4 },
  { id: 'sihy-3', name: 'Silikon-Hydrogel, 48 % (weich)', category: 'contact-sihy', subgroup: 'Silikon-Hydrogel', n: 1.41, abbe: 53, waterContent: 48, dk: 90, modulus: 0.6 },

  // ---------------------------- Weitere Optik ----------------------------
  { id: 'water', name: 'Wasser', category: 'other', subgroup: 'Flüssigkeit', n: 1.333, abbe: 55.8 },
  { id: 'bk7', name: 'Borosilikat-Kronglas (N-BK7-Typ)', category: 'other', subgroup: 'Optikglas', n: 1.5168, abbe: 64.2, density: 2.51 },
  { id: 'flint', name: 'Schwerflint (SF2-Typ)', category: 'other', subgroup: 'Optikglas', n: 1.648, abbe: 33.9, density: 3.86 },
  { id: 'acrylic', name: 'Acryl (PMMA, Optik)', category: 'other', subgroup: 'Kunststoff', n: 1.491, abbe: 57.4, density: 1.19 },
];

export const CUSTOM_MEDIUM_ID = 'custom';

export function findMaterial(id: string | undefined): OpticalMaterial | undefined {
  return MATERIALS.find((m) => m.id === id);
}

/** Welche Materialkategorien passen zu einem Elementtyp? */
export function categoriesForElement(kind: ElementKind, contactDesign?: 'rigid' | 'soft'): MaterialCategory[] {
  if (kind === 'spectacle-lens') return ['spectacle'];
  if (kind === 'rigid-contact-lens' || (kind === 'contact-lens' && contactDesign === 'rigid')) return ['contact-rigid'];
  if (kind === 'soft-contact-lens' || (kind === 'contact-lens' && contactDesign === 'soft')) return ['contact-hydrogel', 'contact-sihy'];
  if (kind === 'contact-lens') return ['contact-rigid', 'contact-hydrogel', 'contact-sihy'];
  return ['other', 'spectacle'];
}

export function materialsForElement(kind: ElementKind, contactDesign?: 'rigid' | 'soft'): OpticalMaterial[] {
  const cats = categoriesForElement(kind, contactDesign);
  return MATERIALS.filter((m) => cats.includes(m.category));
}

/** Sauerstofftransmissibilität Dk/t [×10⁻⁹] bei Dicke t [mm]:  Dk/t = Dk / (10·t) */
export const dkOverT = (dk: number, thicknessMm: number) => (thicknessMm > 0 ? dk / (10 * thicknessMm) : 0);

/** Einordnung nach Holden & Mertz (1984): 24 (Tagestragen) bzw. 87 (verlängertes Tragen) */
export function oxygenRating(dkt: number): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  if (dkt >= 87) return { label: 'ausreichend auch für verlängertes Tragen (≥ 87)', tone: 'ok' };
  if (dkt >= 24) return { label: 'ausreichend für Tagestragen (≥ 24)', tone: 'ok' };
  if (dkt >= 12) return { label: 'unter dem Tagestragen-Kriterium (24)', tone: 'warn' };
  return { label: 'deutlich zu gering', tone: 'danger' };
}

/* ------------------ Kompatibilität Phase 1–3 (Auswahlfelder) ------------------ */

export interface OpticalMediumPreset {
  id: string;
  name: string;
  n: number;
  abbe?: number;
  group: LegacyGroup | string;
  note?: string;
}

/** Flache Liste (alle Materialien außer Augenmedien) – gruppiert nach Kategorie/Untergruppe. */
export const MEDIA_PRESETS: OpticalMediumPreset[] = MATERIALS.filter((m) => m.category !== 'eye' || m.id === 'air').map((m) => ({
  id: m.id,
  name: m.name,
  n: m.n,
  abbe: m.abbe,
  group: m.category === 'eye' ? 'Grundmedien' : m.category === 'spectacle' ? `Brillenglas · ${m.subgroup}` : CATEGORY_LABEL[m.category],
  note: m.note,
}));

export function findMedium(id: string | undefined): OpticalMediumPreset | undefined {
  const m = findMaterial(id);
  return m ? { id: m.id, name: m.name, n: m.n, abbe: m.abbe, group: CATEGORY_LABEL[m.category], note: m.note } : undefined;
}

/** Findet ein Material, das exakt zum Brechungsindex passt (bevorzugt in den erlaubten Kategorien). */
export function matchMediumByIndex(n: number, preferred?: MaterialCategory[]): OpticalMediumPreset | undefined {
  const pool = preferred ? MATERIALS.filter((m) => preferred.includes(m.category)) : MATERIALS;
  const m = pool.find((x) => Math.abs(x.n - n) < 1e-4) ?? MATERIALS.find((x) => Math.abs(x.n - n) < 1e-4);
  return m ? findMedium(m.id) : undefined;
}
