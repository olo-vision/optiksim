/**
 * Abbildung Stripe-Abo-Status → Lizenzstatus (reine Funktion).
 *
 * Maßgeblich ist die Datenbankfunktion public.sync_license_for_institution() (Migration
 * 20260928200000_stripe_subscriptions.sql). Diese TypeScript-Fassung spiegelt dieselben Regeln für
 * Anzeige, Mock-Backend und Tests – ohne Frist (die wertet die Datenbank aus).
 * https://docs.stripe.com/api/subscriptions/object#subscription_object-status
 */
export type StripeSubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
export type LicenseStatus = 'pending' | 'active' | 'past_due' | 'suspended' | 'expired' | 'cancelled';
export type LicensePlan = 'private' | 'business' | 'education';
export type InstitutionType = LicensePlan;

export const STRIPE_SUBSCRIPTION_STATUSES: StripeSubscriptionStatus[] = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'];

/**
 * @param previous bisheriger Lizenzstatus – bleibt bei unvollständigen Abos (Checkout nicht abgeschlossen)
 *                 erhalten; neue Konten stehen auf 'pending'.
 */
export function licenseStatusFromStripe(status: string | null | undefined, previous: LicenseStatus = 'pending'): LicenseStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
    case 'paused':
      return 'suspended';
    case 'canceled':
      return 'cancelled';
    case 'incomplete':
    case 'incomplete_expired':
    default:
      return previous;
  }
}

/** Abos, die noch laufen (eine Institution darf höchstens eines davon haben) */
export const LIVE_SUBSCRIPTION_STATUSES: StripeSubscriptionStatus[] = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

export const PLANS: LicensePlan[] = ['private', 'business', 'education'];
export const isPlan = (v: unknown): v is LicensePlan => typeof v === 'string' && (PLANS as string[]).includes(v);

/** Grace Period nach fehlgeschlagener Zahlung */
export const GRACE_PERIOD_DAYS = 7;
