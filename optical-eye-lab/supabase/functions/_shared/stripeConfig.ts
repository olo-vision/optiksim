/**
 * Serverseitige Stripe-Konfiguration (Edge Functions). Reines TypeScript ohne Deno-APIs → auch in
 * Vitest prüfbar.
 *
 * - Das Frontend übergibt NUR den internen Tarif ('private' | 'business' | 'education').
 *   Die Stripe Price ID wird ausschließlich hier bestimmt – ein Client kann Preis/Produkt nicht wählen.
 * - Der Stripe-Modus ergibt sich AUSSCHLIESSLICH aus dem Secret Key (sk_live_/rk_live_ = live,
 *   sk_test_/rk_test_ = test). Eine Price ID („price_…“) verrät nicht, aus welchem Modus sie stammt.
 * - LIVE: Price IDs ausschließlich aus den sechs Function Secrets STRIPE_PRICE_PRIVATE / _BUSINESS /
 *   _EDUCATION (monatlich) und STRIPE_PRICE_PRIVATE_YEARLY / _BUSINESS_YEARLY / _EDUCATION_YEARLY (jährlich).
 *   Kein Rückfall auf die eingebauten Standard-IDs; fehlt eines oder ist es ungültig → Checkout 503.
 * - TEST/Entwicklung: Secret, sonst die eingebauten Standard-IDs (PRICE_IDS).
 * - Checkout (priceIdFor) und Webhook (priceInfo) verwenden dieselbe Zuordnung.
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
 * Eingebaute Standard-Price-IDs – NUR für Test/Entwicklung (Rückfall ohne Secret). Im Live-Modus werden sie
 * nie verwendet; dort gelten ausschließlich die Secrets aus PRICE_ENV (auch wenn diese dieselben Werte haben).
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

/** Namen der Price-Secrets (im Live-Modus Pflicht, im Test optional; monatliche Namen unverändert aus Phase 7) */
export const PRICE_ENV: Readonly<Record<ProductKey, string>> = Object.freeze({
  private_monthly: 'STRIPE_PRICE_PRIVATE',
  business_monthly: 'STRIPE_PRICE_BUSINESS',
  education_monthly: 'STRIPE_PRICE_EDUCATION',
  private_yearly: 'STRIPE_PRICE_PRIVATE_YEARLY',
  business_yearly: 'STRIPE_PRICE_BUSINESS_YEARLY',
  education_yearly: 'STRIPE_PRICE_EDUCATION_YEARLY',
});

/** syntaktisch gültige Stripe Price ID */
export const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;
const validPrice = (v: string | undefined) => (v && PRICE_ID_RE.test(v.trim()) ? v.trim() : undefined);

export const productKey = (plan: LicensePlan, interval: BillingInterval): ProductKey => `${plan}_${interval}`;

/** Stripe-Modus aus dem Secret Key: sk_live_/rk_live_ → live, sk_test_/rk_test_ → test */
export function stripeMode(env: EnvGetter = noEnv): 'live' | 'test' | 'none' {
  const k = env('STRIPE_SECRET_KEY')?.trim() ?? '';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return 'none';
}

/**
 * Gültige Zuordnung Produktschlüssel → Price ID für den aktuellen Modus (einzige Quelle für Checkout UND Webhook).
 * LIVE: nur gültige Secrets (fehlende/ungültige fehlen in der Zuordnung). TEST/ohne Schlüssel: Secret, sonst Standard-ID.
 */
export function priceTable(env: EnvGetter = noEnv): Partial<Record<ProductKey, string>> {
  const live = stripeMode(env) === 'live';
  const table: Partial<Record<ProductKey, string>> = {};
  for (const key of Object.keys(PRICE_ENV) as ProductKey[]) {
    const configured = validPrice(env(PRICE_ENV[key]));
    const id = live ? configured : (configured ?? PRICE_IDS[key]);
    if (id) table[key] = id;
  }
  return table;
}

/** Tarif + Intervall → erlaubte Price ID; unbekannte Werte oder (live) fehlendes Secret → null. */
export function priceIdFor(plan: unknown, interval: unknown, env: EnvGetter = noEnv): string | null {
  if (!isPlan(plan) || !isBillingInterval(interval)) return null;
  return priceTable(env)[productKey(plan, interval)] ?? null;
}

/**
 * Konfigurationsprüfung für den Live-Betrieb (fail closed): alle sechs Price-Secrets gesetzt und syntaktisch
 * gültig (price_…), keine Price ID doppelt vergeben, Steuersatz und https-Adresse vorhanden. Leere Liste = in Ordnung.
 * Ob eine Price ID aus Test oder Live stammt, ist an der ID nicht erkennbar und wird deshalb NICHT geraten –
 * maßgeblich ist der Schlüssel. Meldungen nennen nur Secret-Namen, nie Werte.
 * Im Testmodus werden keine Price-Probleme gemeldet (Rückfall auf die Standard-IDs).
 */
export function liveConfigProblems(env: EnvGetter = noEnv): string[] {
  const mode = stripeMode(env);
  const problems: string[] = [];
  if (mode === 'none') return ['STRIPE_SECRET_KEY fehlt oder hat ein unbekanntes Format'];
  if (mode !== 'live') return problems;
  const seen = new Map<string, string>();
  for (const key of Object.keys(PRICE_ENV) as ProductKey[]) {
    const name = PRICE_ENV[key];
    const raw = env(name)?.trim() ?? '';
    const v = validPrice(raw);
    if (!raw) problems.push(`${name} fehlt`);
    else if (!v) problems.push(`${name} ist keine gültige Price ID (erwartet price_…)`);
    else if (seen.has(v)) problems.push(`${name} und ${seen.get(v)} verwenden dieselbe Price ID`);
    else seen.set(v, name);
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

/**
 * Price ID → { plan, interval } (Rückrichtung für den Webhook) über DIESELBE Zuordnung wie der Checkout
 * (priceTable). Fremde Preise – und im Live-Modus auch die Standard-IDs ohne passendes Secret – → null.
 */
export function priceInfo(priceId: string | null | undefined, env: EnvGetter = noEnv): { plan: LicensePlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  const table = priceTable(env);
  for (const key of Object.keys(table) as ProductKey[]) {
    if (table[key] !== priceId) continue;
    const [plan, interval] = key.split('_') as [LicensePlan, BillingInterval];
    return { plan, interval };
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
