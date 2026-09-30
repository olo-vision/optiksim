/**
 * Serverseitige Stripe-Konfiguration (Edge Functions). Reines TypeScript ohne Deno-APIs → auch in
 * Vitest prüfbar.
 *
 * - Das Frontend übergibt NUR den internen Tarif ('private' | 'business' | 'education').
 *   Die Stripe Price ID wird ausschließlich hier bestimmt – ein Client kann Preis/Produkt nicht wählen.
 * - Die Price IDs sind keine Geheimnisse. Für einen anderen Stripe-Modus (z. B. Live statt Test) können sie
 *   über Function Secrets überschrieben werden: STRIPE_PRICE_PRIVATE / _BUSINESS / _EDUCATION (monatlich)
 *   und STRIPE_PRICE_PRIVATE_YEARLY / _BUSINESS_YEARLY / _EDUCATION_YEARLY (jährlich).
 */
import { isPlan, type InstitutionType, type LicensePlan } from './licenseStatus.ts';

/** Feste Stripe-API-Version für alle Anfragen (Stand 09/2026). Abo-Perioden liegen seit Basil an den Items. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

export type EnvGetter = (name: string) => string | undefined;
const noEnv: EnvGetter = () => undefined;

export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: BillingInterval[] = ['monthly', 'yearly'];
export const isBillingInterval = (v: unknown): v is BillingInterval => v === 'monthly' || v === 'yearly';

/** Interne Produktschlüssel – die EINZIGEN kaufbaren Kombinationen */
export type ProductKey = `${LicensePlan}_${BillingInterval}`;

/**
 * Serverseitige Whitelist: interner Produktschlüssel → Stripe Price ID.
 * Monatliche Preise unverändert aus Phase 7; Jahrespreise ab Phase 8.
 * Überschreibbar per Function Secret (z. B. für den Live-Modus), siehe PRICE_ENV.
 */
export const PRICE_IDS: Readonly<Record<ProductKey, string>> = Object.freeze({
  private_monthly: 'price_1UKgZZDi0mx4WWPoSxzWozbG',
  business_monthly: 'price_1UKgaqDi0mx4WWPo9VeQhU6Y',
  education_monthly: 'price_1UKgdWDi0mx4WWPoJaiYfQqu',
  private_yearly: 'price_1UKwPqDi0mx4WWPo6wJiRryZ',
  business_yearly: 'price_1UKwPZDi0mx4WWPoWV5rgRuI',
  education_yearly: 'price_1UKwP0Di0mx4WWPoJiOu2iDW',
});

/** Monatliche Price IDs (Kompatibilität mit Phase 7) */
export const DEFAULT_PRICE_IDS: Readonly<Record<LicensePlan, string>> = Object.freeze({
  private: PRICE_IDS.private_monthly,
  business: PRICE_IDS.business_monthly,
  education: PRICE_IDS.education_monthly,
});

/** Namen der optionalen Override-Secrets (monatliche Namen unverändert aus Phase 7) */
export const PRICE_ENV: Readonly<Record<ProductKey, string>> = Object.freeze({
  private_monthly: 'STRIPE_PRICE_PRIVATE',
  business_monthly: 'STRIPE_PRICE_BUSINESS',
  education_monthly: 'STRIPE_PRICE_EDUCATION',
  private_yearly: 'STRIPE_PRICE_PRIVATE_YEARLY',
  business_yearly: 'STRIPE_PRICE_BUSINESS_YEARLY',
  education_yearly: 'STRIPE_PRICE_EDUCATION_YEARLY',
});

const validPrice = (v: string | undefined) => (v && /^price_[A-Za-z0-9]+$/.test(v.trim()) ? v.trim() : undefined);

export const productKey = (plan: LicensePlan, interval: BillingInterval): ProductKey => `${plan}_${interval}`;

/** Stripe-Modus aus dem Secret Key: sk_live_/rk_live_ → live, sk_test_/rk_test_ → test */
export function stripeMode(env: EnvGetter = noEnv): 'live' | 'test' | 'none' {
  const k = env('STRIPE_SECRET_KEY')?.trim() ?? '';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return 'none';
}

/**
 * Tarif + Intervall → erlaubte Price ID; unbekannte Werte → null.
 * Im LIVE-Modus nur aus den Function Secrets – die eingebauten Test-Price-IDs werden nie live verwendet.
 */
export function priceIdFor(plan: unknown, interval: unknown, env: EnvGetter = noEnv): string | null {
  if (!isPlan(plan) || !isBillingInterval(interval)) return null;
  const key = productKey(plan, interval);
  const configured = validPrice(env(PRICE_ENV[key]));
  if (stripeMode(env) === 'live') return configured ?? null;
  return configured ?? PRICE_IDS[key];
}

/**
 * Konfigurationsprüfung für den Live-Betrieb (fail closed): alle sechs Price IDs, Steuersatz und
 * https-Adresse der Anwendung müssen gesetzt sein, keine Test-IDs. Leere Liste = in Ordnung.
 * Im Testmodus werden nur offensichtliche Fehler gemeldet.
 */
export function liveConfigProblems(env: EnvGetter = noEnv): string[] {
  const mode = stripeMode(env);
  const problems: string[] = [];
  if (mode === 'none') return ['STRIPE_SECRET_KEY fehlt oder hat ein unbekanntes Format'];
  if (mode !== 'live') return problems;
  for (const key of Object.keys(PRICE_ENV) as ProductKey[]) {
    const v = validPrice(env(PRICE_ENV[key]));
    if (!v) problems.push(`${PRICE_ENV[key]} fehlt`);
    else if (v === PRICE_IDS[key]) problems.push(`${PRICE_ENV[key]} enthält die Test-Price-ID`);
  }
  const tax = env('STRIPE_TAX_RATE_ID')?.trim();
  if (!tax || !/^txr_[A-Za-z0-9]+$/.test(tax)) problems.push('STRIPE_TAX_RATE_ID fehlt');
  const raw = (env('SITE_URL') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!raw.length) problems.push('SITE_URL fehlt');
  else if (!/^https:\/\//.test(raw[0])) problems.push('SITE_URL (erster Eintrag) muss mit https:// beginnen');
  return problems;
}

/** Tarif → monatliche Price ID (Phase-7-Schnittstelle) */
export function priceIdForPlan(plan: unknown, env: EnvGetter = noEnv): string | null {
  return priceIdFor(plan, 'monthly', env);
}

/** Price ID → { plan, interval } (Rückrichtung für den Webhook); fremde Preise → null */
export function priceInfo(priceId: string | null | undefined, env: EnvGetter = noEnv): { plan: LicensePlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const key of Object.keys(PRICE_IDS) as ProductKey[]) {
    const [plan, interval] = key.split('_') as [LicensePlan, BillingInterval];
    if (priceIdFor(plan, interval, env) === priceId) return { plan, interval };
  }
  return null;
}

/** Price ID → Tarif (Phase-7-Schnittstelle) */
export function planForPriceId(priceId: string | null | undefined, env: EnvGetter = noEnv): LicensePlan | null {
  return priceInfo(priceId, env)?.plan ?? null;
}

/**
 * Tarifregel: Der Tarif muss zum bei der Registrierung gewählten Kontotyp passen
 * (Privatkonto → Private, Betrieb → Business, Bildungseinrichtung → Education).
 * So bekommt z. B. eine Schule nicht versehentlich den günstigeren Privattarif. Falscher Kontotyp →
 * Support/Admin ändert den Typ.
 */
export function planAllowedFor(institutionType: InstitutionType | null | undefined, plan: LicensePlan): boolean {
  return !!institutionType && institutionType === plan;
}

export const PLAN_MISMATCH_MESSAGE: Record<LicensePlan, string> = {
  private: 'Der Private-Tarif ist nur für Privatkonten buchbar.',
  business: 'Der Business-Tarif ist nur für Betriebskonten buchbar.',
  education: 'Der Education-Tarif ist nur für Bildungseinrichtungen buchbar.',
};

/**
 * Erlaubte Basis-URLs der Anwendung (für Success-/Cancel-/Return-URLs und CORS).
 * SITE_URL = eine oder mehrere, kommagetrennt, z. B. "https://app.olo-lab3d.de,http://localhost:5173".
 * Ohne SITE_URL nur die lokale Entwicklung.
 */
export function siteUrls(env: EnvGetter = noEnv): string[] {
  const raw = env('SITE_URL') ?? '';
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
  return list.length ? list : ['http://localhost:5173'];
}

/** Basis-URL: die aufrufende Origin, wenn sie erlaubt ist – sonst die erste konfigurierte */
export function resolveSiteUrl(origin: string | null | undefined, env: EnvGetter = noEnv): string {
  const allowed = siteUrls(env);
  const o = (origin ?? '').replace(/\/+$/, '');
  return allowed.includes(o) ? o : allowed[0];
}

export function corsHeaders(origin: string | null | undefined, env: EnvGetter = noEnv): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveSiteUrl(origin, env),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Anzeige (Stripe-Bestellseite, E-Mails) – muss mit src/cloud/plans.ts übereinstimmen (Test prüft das) */
/* ------------------------------------------------------------------------------------------------ */

export const PRODUCT_NAME = 'OLO-LAB3D';
export const PROVIDER_NAME = 'OLO Vision';

export const PLAN_NAMES: Readonly<Record<LicensePlan, string>> = Object.freeze({
  private: 'OLO-LAB3D Private',
  business: 'OLO-LAB3D Business',
  education: 'OLO-LAB3D Education',
});

/** Endpreise inkl. 19 % USt. */
export const PRICE_LABELS: Readonly<Record<ProductKey, string>> = Object.freeze({
  private_monthly: '19,90 €',
  business_monthly: '39,90 €',
  education_monthly: '99,90 €',
  private_yearly: '199,00 €',
  business_yearly: '399,00 €',
  education_yearly: '999,00 €',
});

/**
 * Private Jahreslizenzen verlängern sich NICHT automatisch (§ 309 Nr. 9 BGB): Das Abo wird direkt nach dem
 * Kauf auf „endet zum Periodenende“ gesetzt; eine Reaktivierung wird vom Webhook zurückgenommen.
 */
export const endsAutomatically = (plan: LicensePlan | null | undefined, interval: BillingInterval | null | undefined) => plan === 'private' && interval === 'yearly';

/** Laufzeitregel in einem Satz (Bestellseite, Bestätigung) */
export function termNote(plan: LicensePlan, interval: BillingInterval): string {
  if (interval === 'monthly') return 'monatliche Abrechnung, jederzeit zum Ende des Abrechnungsmonats kündbar';
  if (endsAutomatically(plan, interval)) return 'Laufzeit 12 Monate, endet automatisch ohne Verlängerung';
  return 'Laufzeit 12 Monate, verlängert sich um jeweils 12 Monate, jederzeit zum Laufzeitende kündbar';
}

export function priceLine(plan: LicensePlan, interval: BillingInterval): string {
  return `${PRICE_LABELS[productKey(plan, interval)]} ${interval === 'yearly' ? (endsAutomatically(plan, interval) ? 'für 12 Monate' : 'pro Jahr') : 'pro Monat'} inkl. 19 % USt.`;
}

/**
 * Hinweis direkt am Button der Stripe-Bestellseite (custom_text.submit, max. 1200 Zeichen).
 * Die Beschriftung des Buttons selbst („Abonnieren“) gibt Stripe vor.
 */
export function checkoutSubmitMessage(plan: LicensePlan, interval: BillingInterval, b2c: boolean): string {
  const docs = b2c ? 'die AGB sowie die Lizenz- und Nutzungsbedingungen; die Widerrufsbelehrung haben Sie vor der Bestellung erhalten' : 'die AGB, die B2B-Zusatzbedingungen sowie die Lizenz- und Nutzungsbedingungen';
  return `Mit Klick auf „Abonnieren“ bestellen Sie ${PLAN_NAMES[plan]} zahlungspflichtig: ${priceLine(plan, interval)}; ${termNote(plan, interval)}. Es gelten ${docs} von ${PROVIDER_NAME}.`.slice(0, 1200);
}
