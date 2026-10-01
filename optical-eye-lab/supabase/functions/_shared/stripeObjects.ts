/**
 * Auslesen von Stripe-Objekten – robust gegenüber API-Versionen:
 *  - Seit 2025-03-31.basil liegen current_period_start/end an den Subscription Items
 *    (items.data[].current_period_*), nicht mehr am Subscription-Objekt. Ältere Payloads werden als
 *    Rückfall weiterhin gelesen.
 *  - Seit Basil steht die Abo-ID einer Rechnung unter invoice.parent.subscription_details.subscription
 *    (vorher invoice.subscription).
 * Der Webhook lädt Abos/Rechnungen ohnehin frisch mit fester API-Version (STRIPE_API_VERSION), die
 * Ereignis-Payload dient nur zur Identifikation.
 */
import { priceInfo, type BillingInterval, type EnvGetter } from './stripeConfig.ts';
import type { LicensePlan } from './licenseStatus.ts';

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

/** ID aus String oder expandiertem Objekt */
export const idOf = (x: unknown): string | null => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as Obj).id === 'string' ? (x as Obj).id : null);

const iso = (s: unknown): string | null => (typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null);

/** Datenpaket für public.apply_stripe_subscription(p jsonb) */
export interface SubscriptionSnapshot {
  event_id: string | null;
  event_type: string | null;
  customer_id: string;
  subscription_id: string;
  price_id: string | null;
  plan: LicensePlan | null;
  billing_interval: BillingInterval | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  stripe_created: string | null;
  payment_failed: boolean;
  metadata_institution_id: string | null;
  /** nur bei checkout.session.* bekannt – verknüpft Abo und protokollierte Zustimmungen */
  checkout_session_id: string | null;
}

/** Stripe-Intervall eines Preises (month/year) → internes Intervall */
const intervalOf = (price: Obj | undefined): BillingInterval | null => {
  const i = price?.recurring?.interval;
  return i === 'year' ? 'yearly' : i === 'month' ? 'monthly' : null;
};

export function snapshotFromSubscription(sub: Obj, ctx: { eventId?: string | null; eventType?: string | null; paymentFailed?: boolean; env?: EnvGetter; checkoutSessionId?: string | null } = {}): SubscriptionSnapshot {
  const customer = idOf(sub.customer);
  if (!customer || typeof sub.id !== 'string') throw new Error('Unvollständiges Stripe-Abo');
  const item: Obj | undefined = sub.items?.data?.[0];
  const priceId = idOf(item?.price) ?? idOf(sub.plan) ?? null;
  const info = priceInfo(priceId, ctx.env);
  return {
    event_id: ctx.eventId ?? null,
    event_type: ctx.eventType ?? null,
    customer_id: customer,
    subscription_id: sub.id,
    price_id: priceId,
    // maßgeblich ist ausschließlich der tatsächlich abgerechnete Preis laut Whitelist (dieselbe wie im Checkout);
    // Metadaten oder fremde Preise schalten keinen Tarif frei
    plan: info?.plan ?? null,
    // Intervall aus der Whitelist bzw. aus dem von Stripe gelieferten Preis (nie aus Browserdaten)
    billing_interval: info?.interval ?? intervalOf(typeof item?.price === 'object' ? item?.price : undefined),
    status: String(sub.status),
    current_period_start: iso(item?.current_period_start ?? sub.current_period_start),
    current_period_end: iso(item?.current_period_end ?? sub.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    cancel_at: iso(sub.cancel_at),
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
    stripe_created: iso(sub.created),
    payment_failed: ctx.paymentFailed === true,
    metadata_institution_id: typeof sub.metadata?.institution_id === 'string' ? sub.metadata.institution_id : null,
    checkout_session_id: typeof ctx.checkoutSessionId === 'string' && ctx.checkoutSessionId.startsWith('cs_') ? ctx.checkoutSessionId : null,
  };
}

/** Abo-ID einer Rechnung (Basil+: parent.subscription_details.subscription; älter: subscription) */
export function subscriptionIdFromInvoice(inv: Obj | null | undefined): string | null {
  if (!inv) return null;
  return idOf(inv.parent?.subscription_details?.subscription) ?? idOf(inv.subscription) ?? null;
}
