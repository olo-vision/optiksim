/**
 * Tarife (Anzeige). Verbindlich für die Abrechnung ist die serverseitige Zuordnung Tarif → Stripe Price ID
 * in supabase/functions/_shared/stripeConfig.ts – das Frontend übergibt nur den internen Tarif.
 */
import type { BillingInterval, InstitutionType, LegalAudience, LegalDocType, LicensePlan, LicenseSource, LicenseStatus, SubscriptionStatus } from './types';
import { PRODUCT_NAME } from '@/platform/branding';

export { PRODUCT_NAME };

export interface PlanInfo {
  id: LicensePlan;
  name: string;
  priceCents: number;
  priceLabel: string;
  /** Jahrespreis (Phase 8) – eigener Stripe-Preis, keine rechnerische Ableitung */
  yearlyPriceCents: number;
  yearlyPriceLabel: string;
  audience: string;
  locationNote?: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'private',
    name: `${PRODUCT_NAME} Private`,
    priceCents: 1990,
    priceLabel: '19,90 €',
    yearlyPriceCents: 19900,
    yearlyPriceLabel: '199,00 €',
    audience: 'Für private Nutzung, Lernen und Weiterbildung.',
    features: ['Vollständiger Simulator', 'Alle Module', 'Eigene Simulationen speichern'],
  },
  {
    id: 'business',
    name: `${PRODUCT_NAME} Business`,
    priceCents: 3990,
    priceLabel: '39,90 €',
    yearlyPriceCents: 39900,
    yearlyPriceLabel: '399,00 €',
    audience: 'Für Augenoptikbetriebe.',
    locationNote: 'Lizenz gilt für einen Betriebsstandort.',
    features: ['Vollständiger Simulator', 'Alle Module', 'Beratung und Ausbildung im Betrieb'],
  },
  {
    id: 'education',
    name: `${PRODUCT_NAME} Education`,
    priceCents: 9990,
    priceLabel: '99,90 €',
    yearlyPriceCents: 99900,
    yearlyPriceLabel: '999,00 €',
    audience: 'Für Schulen und Bildungseinrichtungen.',
    locationNote: 'Lizenz gilt für einen Bildungsstandort.',
    features: ['Vollständiger Simulator', 'Alle Module', 'Unterricht, Übungen und Trainingsfälle'],
  },
];

export const planInfo = (id: LicensePlan | null | undefined) => PLANS.find((p) => p.id === id);

/** Preis eines Pakets im gewählten Intervall */
/** B2B vorerst nur mit Sitz in Deutschland (gleicher Text wie in der Edge Function) */
export const B2B_COUNTRY_MESSAGE =
  'Buchungen für Unternehmen und Bildungseinrichtungen sind derzeit nur mit Sitz in Deutschland möglich. Bitte wende dich für ein Angebot an info@olo-vision.de.';

/** Alle Preise sind Endpreise inkl. 19 % USt. */
export const VAT_NOTE = 'inkl. 19 % USt.';

/**
 * Private Jahreslizenzen verlängern sich nicht automatisch (§ 309 Nr. 9 BGB); der Server setzt das Abo
 * direkt nach dem Kauf auf „endet zum Periodenende“. B2B-Jahresabos verlängern sich jährlich.
 */
export const endsAutomatically = (plan: LicensePlan, interval: BillingInterval) => plan === 'private' && interval === 'yearly';

export function planPrice(plan: PlanInfo, interval: BillingInterval): { label: string; unit: string; note: string; term: string } {
  if (interval === 'monthly') return { label: plan.priceLabel, unit: '/ Monat', note: `monatliche Abrechnung · ${VAT_NOTE}`, term: 'monatlich kündbar' };
  if (endsAutomatically(plan.id, interval)) return { label: plan.yearlyPriceLabel, unit: '/ 12 Monate', note: `einmalige Zahlung · ${VAT_NOTE}`, term: 'endet automatisch nach 12 Monaten – keine Verlängerung' };
  return { label: plan.yearlyPriceLabel, unit: '/ Jahr', note: `jährliche Abrechnung · ${VAT_NOTE}`, term: 'verlängert sich jährlich, jederzeit zum Laufzeitende kündbar' };
}

export const BILLING_INTERVAL_LABEL: Record<BillingInterval, string> = { monthly: 'monatlich', yearly: 'jährlich' };

/** Kostenlose Demo (Phase 8): voller Funktionsumfang, 2 Stunden, einmal je Kundenkonto */
export const DEMO_PLAN = {
  name: `${PRODUCT_NAME} Demo`,
  durationLabel: '2 Stunden',
  durationMs: 2 * 60 * 60 * 1000,
  priceLabel: '0 €',
  highlights: ['2 Stunden kostenlos testen', 'Voller Funktionsumfang', 'Keine Zahlungsdaten erforderlich', 'Nur einmal pro Kundenkonto verfügbar'],
} as const;

/** Kundentyp: B2C (Privatperson) oder B2B (Unternehmen / Bildungseinrichtung) */
export const isB2B = (t: InstitutionType | null | undefined) => t === 'business' || t === 'education';
export const CUSTOMER_KIND_LABEL = (t: InstitutionType | null | undefined) => (isB2B(t) ? 'B2B' : 'B2C');

/** Anzeige hh:mm:ss */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

export const LEGAL_DOC_TYPE_LABEL: Record<LegalDocType, string> = {
  imprint: 'Impressum',
  terms: 'AGB',
  privacy: 'Datenschutzerklärung',
  withdrawal: 'Widerrufsbelehrung',
  withdrawal_form: 'Muster-Widerrufsformular',
  license_terms: 'Lizenz- und Nutzungsbedingungen',
  b2b_terms: 'B2B-Zusatzbedingungen',
  consent_immediate_performance: 'Verlangen des sofortigen Leistungsbeginns',
  consent_withdrawal_loss: 'Hinweis zum Wertersatz bei Widerruf',
  other: 'Weiteres Dokument',
};

export const LEGAL_AUDIENCE_LABEL: Record<LegalAudience, string> = { all: 'Alle', b2c: 'B2C (Privat)', b2b: 'B2B (Unternehmen/Bildung)' };

export const INSTITUTION_TYPE_LABEL: Record<InstitutionType, string> = {
  private: 'Privat',
  business: 'Betrieb / Business',
  education: 'Schule / Education',
};

/** Lizenzbeschreibung laut Vorgabe: „Business-Lizenz – 1 Betriebsstandort“ usw. */
export function licenseLabel(plan: LicensePlan | null | undefined, maxLocations = 1): string {
  if (!plan) return 'Keine Lizenz';
  if (plan === 'business') return `Business-Lizenz – ${maxLocations} Betriebsstandort${maxLocations === 1 ? '' : 'e'}`;
  if (plan === 'education') return `Education-Lizenz – ${maxLocations} Bildungsstandort${maxLocations === 1 ? '' : 'e'}`;
  return 'Private-Lizenz';
}

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  pending: 'Noch nicht aktiviert',
  active: 'Aktiv',
  past_due: 'Zahlung überfällig',
  suspended: 'Gesperrt',
  expired: 'Abgelaufen',
  cancelled: 'Gekündigt',
};

export const formatEuro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/* ------------------------------ Phase 7: Abo / Stripe ------------------------------ */

/**
 * Tarifregel (identisch zur Edge Function create-checkout-session): Buchbar ist nur der Tarif, der zum
 * bei der Registrierung gewählten Kontotyp passt – Privatkonto → Private, Betrieb → Business,
 * Bildungseinrichtung → Education. Der Server prüft das zusätzlich; die Oberfläche hebt den passenden
 * Tarif hervor und sperrt die anderen mit Begründung.
 */
export const planAllowedFor = (type: InstitutionType | null | undefined, plan: LicensePlan) => !!type && type === plan;

export const PLAN_ONLY_FOR: Record<LicensePlan, string> = {
  private: 'Nur für Privatkonten',
  business: 'Nur für Betriebe',
  education: 'Nur für Bildungseinrichtungen',
};

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  incomplete: 'Zahlung ausstehend',
  incomplete_expired: 'Bezahlvorgang abgelaufen',
  trialing: 'Testphase',
  active: 'Aktiv',
  past_due: 'Zahlung fehlgeschlagen',
  canceled: 'Beendet',
  unpaid: 'Unbezahlt',
  paused: 'Pausiert',
};

export const LICENSE_SOURCE_LABEL: Record<LicenseSource, string> = {
  stripe: 'Stripe-Abo',
  manual: 'Sonderlizenz (manuell)',
  demo: 'Kostenlose Demo',
};

export const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
