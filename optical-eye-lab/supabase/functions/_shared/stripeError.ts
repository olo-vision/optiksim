/**
 * Strukturierte Stripe-Fehler: Status, Typ, Code und Meldung der Stripe-API (ohne Schlüssel/Anfrageinhalt).
 * Erlaubt gezielte Reaktionen (z. B. fehlende Portal-Konfiguration, Kunde im anderen Modus) statt
 * pauschaler Fehlermeldungen.
 */
export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string,
    message: string,
    readonly param: string | null = null,
  ) {
    super(`Stripe ${status} ${type} ${code}: ${message}`.slice(0, 300));
    this.name = 'StripeError';
  }
  /** Meldung von Stripe (ohne Präfix) */
  get stripeMessage() {
    return this.message.replace(/^Stripe \d+ \S* \S*: /, '');
  }
}

export const isStripeError = (e: unknown): e is StripeError => e instanceof StripeError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'StripeError');

/** Objekt existiert (in diesem Modus/Konto) nicht – z. B. Test-Kunde bei Live-Schlüssel */
export const isResourceMissing = (e: unknown) => isStripeError(e) && (e.code === 'resource_missing' || e.status === 404);

/** Kundenportal ohne gespeicherte Standard-Konfiguration (Stripe-Dashboard → Customer portal → Save) */
export const isPortalNotConfigured = (e: unknown) =>
  isStripeError(e) && e.status === 400 && /configuration/i.test(e.stripeMessage) && /(default|not been created|provide a configuration)/i.test(e.stripeMessage);
