// Edge Function: create-customer-portal
// Öffnet das Stripe Customer Portal (Zahlungsmittel, Rechnungen, Abo ändern/kündigen) –
// ausschließlich für den Stripe Customer der EIGENEN Institution.
// Request:  POST (mit Benutzer-JWT, kein Body nötig) → 200 { url } · 401 · 403 · 404 kein Abo
// Logik: _shared/handlers.ts (handlePortal)
import { handlePortal } from '../_shared/handlers.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handlePortal(req, realDeps()));
