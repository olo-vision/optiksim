/**
 * Fluoreszeinbild formstabiler Kontaktlinsen (Phase 4).
 *
 * Grundlage ist ausschließlich die Geometrie: lokale Tränenfilmdicke t(x, y) zwischen KL-Rückfläche
 * (optische Zone + periphere Kurven) und Hornhaut (Radius, Torizität, Asphärizität), Zentrierung und Neigung
 * (tearThicknessAt, contactSeat.ts).
 *
 * Fluoreszenz → Intensität (vereinfachtes Modell, dünne Schicht):
 *   I(t) = 1 − exp(−max(0, t − t₀) / τ)
 *   - linear bei dünnen Schichten (Beer-Lambert), Sättigung bei dicken Schichten
 *   - t₀ = 10 µm: darunter erscheint der Tränenfilm schwarz (Sichtbarkeitsgrenze ≈ 15–20 µm in der Praxis)
 *   - τ = 35 µm: bei ≈ 80–100 µm praktisch volle Helligkeit
 * Beobachtung mit Kobaltblau-Beleuchtung und Gelbfilter; Farbe = Emission von Fluoreszein (≈ 520 nm).
 *
 * Trennung: geometrische Messwerte (Dicke, Zone, Radien) ↔ didaktische Interpretation (Texte, Sitzklasse).
 */
import type { EyeEntity, LensElement } from '@/model/types';
import { computeTearProfile, tearThicknessAt } from '@/model/derived/contactSeat';
import { corneaSpec, effectiveLens } from '@/model/derived/effectiveLens';
import { radiusInMeridian } from '@/core/math/surfaces';

export const FLUO_T0 = 0.01;
export const FLUO_TAU = 0.035;

/** Fluoreszenzintensität 0…1 aus der Tränenfilmdicke [mm] */
export function fluoIntensity(tMm: number): number {
  if (!Number.isFinite(tMm)) return 0;
  return 1 - Math.exp(-Math.max(0, tMm - FLUO_T0) / FLUO_TAU);
}

export type FluoClass = 'touch' | 'thin' | 'alignment' | 'pooling' | 'heavy-pooling';

export function classifyThickness(tMm: number): { cls: FluoClass; label: string } {
  const um = tMm * 1000;
  if (um < 15) return { cls: 'touch', label: 'Auflage (dunkel)' };
  if (um < 25) return { cls: 'thin', label: 'dünner Tränenfilm (schwach grün)' };
  if (um < 40) return { cls: 'alignment', label: 'gleichmäßiger Tränenfilm (grün)' };
  if (um < 100) return { cls: 'pooling', label: 'Tränenansammlung (hellgrün)' };
  return { cls: 'heavy-pooling', label: 'starke Tränenansammlung / Blase möglich' };
}

export type FitVerdict = 'steep' | 'alignment' | 'flat' | 'unknown';

export const FIT_LABEL: Record<FitVerdict, string> = {
  steep: 'zu steil',
  alignment: 'parallel (Alignment)',
  flat: 'zu flach',
  unknown: 'nicht eindeutig',
};

export interface FluoZoneStats {
  central: number;
  /** Mittlere Dicke im mittelperipheren Ring (40–85 % der optischen Zone) */
  midPeriphery: number;
  /** Minimum im mittelperipheren Ring */
  midMin: number;
  /** Dicke am Übergang optische Zone → Peripherie */
  ozEdge: number;
  /** Randspalt (Mittel über den Umfang, 0,1 mm vor dem Rand) */
  edgeClearance: number;
  /** Anteil der Fläche mit Auflage (< 15 µm) */
  touchFraction: number;
}

export interface FluoAnalysis {
  applicable: boolean;
  reason?: string;
  stats: FluoZoneStats;
  verdict: FitVerdict;
  /** geometrische Fakten */
  facts: string[];
  /** didaktische Interpretation */
  interpretation: string[];
  /** Basiskurve − flacher K [mm] */
  deltaR: number;
  baseCurve: number;
  flatK: number;
  /** Merkmale für die Beschriftung */
  features: string[];
}

function ringMean(el: LensElement, eye: EyeEntity, r: number, n = 36) {
  let sum = 0;
  let min = Infinity;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const t = tearThicknessAt(el, eye, r * Math.cos(a), r * Math.sin(a));
    sum += t;
    min = Math.min(min, t);
  }
  return { mean: sum / n, min };
}

const um = (mm: number) => `${Math.round(mm * 1000)} µm`;

export function analyzeFluorescein(el: LensElement, eye: EyeEntity): FluoAnalysis {
  const c = el.contact;
  const empty: FluoZoneStats = { central: 0, midPeriphery: 0, midMin: 0, ozEdge: 0, edgeClearance: 0, touchFraction: 0 };
  if (!c || !c.onEye)
    return { applicable: false, reason: 'Die Kontaktlinse sitzt nicht auf dem Auge.', stats: empty, verdict: 'unknown', facts: [], interpretation: [], deltaR: 0, baseCurve: 0, flatK: 0, features: [] };
  if (c.design === 'soft')
    return {
      applicable: false,
      reason: 'Weiche Kontaktlinsen nehmen Fluoreszein auf (Verfärbung) – die Sitzbeurteilung mit Fluoreszein ist formstabilen Linsen vorbehalten. Ggf. hochmolekulares Fluoreszein verwenden.',
      stats: empty,
      verdict: 'unknown',
      facts: [],
      interpretation: [],
      deltaR: 0,
      baseCurve: 0,
      flatK: 0,
      features: [],
    };
  const R = el.lens.diameter / 2;
  const oz = (c.opticZoneDiameter ?? el.lens.diameter * 0.8) / 2;
  const central = tearThicknessAt(el, eye, 0, 0);
  let midSum = 0;
  let midMin = Infinity;
  let rings = 0;
  for (let f = 0.4; f <= 0.851; f += 0.15) {
    const r = ringMean(el, eye, oz * f);
    midSum += r.mean;
    midMin = Math.min(midMin, r.min);
    rings++;
  }
  const ozEdge = ringMean(el, eye, oz).mean;
  const edge = ringMean(el, eye, Math.max(oz, R - 0.1)).mean;
  const prof = computeTearProfile(el, eye, 20);
  let inside = 0;
  let touch = 0;
  for (const v of prof.values) {
    if (Number.isNaN(v)) continue;
    inside++;
    if (v < 0.015) touch++;
  }
  const stats: FluoZoneStats = { central, midPeriphery: midSum / rings, midMin, ozEdge, edgeClearance: edge, touchFraction: inside ? touch / inside : 0 };

  const cornea = corneaSpec(eye);
  const r1 = cornea.R;
  const r2 = cornea.R2 ?? cornea.R;
  const flatK = Math.max(r1, r2);
  const flatMer = r1 >= r2 ? (cornea.axis ?? 180) : (cornea.axis ?? 180) + 90;
  const baseCurve = radiusInMeridian(effectiveLens(el).back, flatMer);
  const deltaR = baseCurve - flatK;

  // Sitzklasse aus der Geometrie (zentral vs. Mittelperipherie)
  let verdict: FitVerdict = 'unknown';
  if (central - stats.midPeriphery > 0.015 && stats.midMin < 0.02) verdict = 'steep';
  else if (stats.midPeriphery - central > 0.012 && central < 0.02) verdict = 'flat';
  else if (Math.abs(central - stats.midPeriphery) <= 0.015) verdict = 'alignment';
  else verdict = central > stats.midPeriphery ? 'steep' : 'flat';

  const features: string[] = [];
  if (central >= 0.04 && verdict === 'steep') features.push('zentrales Pooling');
  if (central < 0.015) features.push('zentrale Auflage');
  if (stats.midMin < 0.015 && verdict === 'steep') features.push('mittelperiphere Auflage');
  if (edge > 0.08) features.push('deutliche Randunterspülung');
  else if (edge < 0.03) features.push('geringer Randspalt');
  else features.push('Randunterspülung (Tränenaustausch)');

  const facts = [
    `Tränenfilm zentral ${um(central)}, Mittelperipherie Ø ${um(stats.midPeriphery)} (min. ${um(Math.max(0, midMin))}), Rand ${um(edge)}.`,
    `Basiskurve ${baseCurve.toFixed(2)} mm · flacher Hornhautradius ${flatK.toFixed(2)} mm · Differenz ${deltaR >= 0 ? '+' : '−'}${Math.abs(deltaR).toFixed(2)} mm.`,
    `Auflagefläche (< 15 µm): ${Math.round(stats.touchFraction * 100)} % der Linsenfläche.`,
  ];
  if ((eye.anatomy.corneaAsphericity ?? 0) !== 0) facts.push(`Hornhaut asphärisch (Q = ${(eye.anatomy.corneaAsphericity ?? 0).toFixed(2)}): flacht zur Peripherie ab.`);
  const cc = c.centration ?? { x: 0, y: 0 };
  if (Math.hypot(cc.x, cc.y) > 0.3) facts.push(`Dezentration ${Math.hypot(cc.x, cc.y).toFixed(1)} mm – das Bild wird asymmetrisch.`);

  const interpretation: string[] = [];
  if (verdict === 'steep')
    interpretation.push(
      'Zentrales Pooling mit mittelperipherer Auflage: Die Basiskurve ist steiler als die zentrale Hornhaut. Die Linse überbrückt den Apex und liegt ringförmig auf.',
      'Mögliche Folgen: geringer Tränenaustausch, Luftblasen, Abdrücke. Üblich: Basiskurve abflachen.',
    );
  else if (verdict === 'flat')
    interpretation.push(
      'Zentrale Auflage mit peripherer Tränenansammlung: Die Basiskurve ist flacher als die zentrale Hornhaut; die Linse liegt auf dem Apex auf und kippt leicht.',
      'Mögliche Folgen: Dezentration, starke Bewegung, zentrale Hornhautbelastung. Üblich: Basiskurve versteilen.',
    );
  else if (verdict === 'alignment')
    interpretation.push('Gleichmäßig dünner Tränenfilm unter der optischen Zone mit Randunterspülung: annähernd paralleler Sitz (Alignment).');
  if (edge < 0.03) interpretation.push('Geringer Randspalt: eingeschränkter Tränenaustausch, Linse kann „ansaugen“ – Peripherie abflachen/verbreitern.');
  if (edge > 0.12) interpretation.push('Sehr großer Randspalt: Rand kann abstehen (Fremdkörpergefühl, Lidanschlag) – Peripherie steiler/schmaler.');

  return { applicable: true, stats, verdict, facts, interpretation, deltaR, baseCurve, flatK, features };
}

export type FluoZone = 'optic' | 'periphery' | 'edge' | 'outside';

export interface FluoProbe {
  /** Position im TABO-Rahmen relativ zur Linsenmitte [mm] */
  x: number;
  y: number;
  r: number;
  zone: FluoZone;
  zoneLabel: string;
  thickness: number;
  intensity: number;
  classLabel: string;
  interpretation: string;
}

/** Einzelner Messpunkt (Klick in die Fluo-Ansicht) mit Messwert und getrennter Interpretation. */
export function probeFluorescein(el: LensElement, eye: EyeEntity, x: number, y: number): FluoProbe {
  const r = Math.hypot(x, y);
  const R = el.lens.diameter / 2;
  const oz = (el.contact?.opticZoneDiameter ?? el.lens.diameter * 0.8) / 2;
  const zone: FluoZone = r > R ? 'outside' : r > R - 0.25 ? 'edge' : r > oz && (el.contact?.peripheralCurves?.length ?? 0) > 0 ? 'periphery' : 'optic';
  const zoneLabel = { optic: 'optische Zone', periphery: 'periphere Kurven', edge: 'Randzone', outside: 'außerhalb der Linse' }[zone];
  if (zone === 'outside')
    return { x, y, r, zone, zoneLabel, thickness: NaN, intensity: 0, classLabel: 'freier Tränenfilm der Hornhaut (≈ 3–7 µm)', interpretation: 'Außerhalb der Linse ist nur der natürliche Tränenfilm vorhanden – er erscheint dunkel; am Linsenrand sammelt sich ein heller Tränenmeniskus.' };
  const t = tearThicknessAt(el, eye, x, y);
  const k = classifyThickness(t);
  let interpretation = '';
  if (zone === 'optic') {
    if (k.cls === 'touch') interpretation = r < oz * 0.35 ? 'Zentrale Auflage: Basiskurve flacher als die zentrale Hornhaut.' : 'Mittelperiphere Auflage: typisch für eine zu steile Linse (Ringauflage) oder asphärische/dezentrierte Hornhautpartie.';
    else if (k.cls === 'pooling' || k.cls === 'heavy-pooling') interpretation = r < oz * 0.4 ? 'Zentrales Pooling: Basiskurve steiler als die zentrale Hornhaut.' : 'Tränenansammlung in der optischen Zone – Linse überbrückt diesen Bereich.';
    else interpretation = 'Gleichmäßiger Tränenfilm – Rückfläche verläuft hier annähernd parallel zur Hornhaut.';
  } else if (zone === 'periphery') interpretation = k.cls === 'touch' ? 'Periphere Auflage: Peripherie zu steil oder Linse dezentriert.' : 'Peripherie hebt ab: Tränenreservoir für den Austausch beim Lidschlag.';
  else interpretation = k.cls === 'touch' ? 'Rand liegt auf: kaum Tränenaustausch, Gefahr des Ansaugens.' : 'Randunterspülung: ermöglicht Tränenaustausch und Linsenbewegung.';
  return { x, y, r, zone, zoneLabel, thickness: t, intensity: fluoIntensity(t), classLabel: k.label, interpretation };
}
