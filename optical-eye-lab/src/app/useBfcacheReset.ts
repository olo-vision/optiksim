import { useEffect } from 'react';

/**
 * Rückkehr per „Zurück“ aus Stripe (Seite kommt aus dem Browser-Cache): hängende Ladezustände zurücksetzen,
 * sonst dreht sich der Button endlos.
 */
export function useBfcacheReset(reset: () => void) {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);
}
