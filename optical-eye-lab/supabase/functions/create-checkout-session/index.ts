// Edge Function: create-checkout-session
// Erzeugt eine Stripe-Checkout-Session (Abo) für den gewählten Tarif der EIGENEN Institution.
// Request:  POST { plan: 'private' | 'business' | 'education' }  (mit Benutzer-JWT)
// Response: 200 { url } · 400 unbekannter Tarif · 401 nicht angemeldet · 403 keine Berechtigung ·
//           409 Abo/Sonderlizenz besteht · 422 Tarif passt nicht zum Kontotyp · 503 Stripe nicht eingerichtet
// Logik: _shared/handlers.ts (handleCheckout)
import { handleCheckout } from '../_shared/handlers.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handleCheckout(req, realDeps()));
