// Edge Function: consumer-request
// „Verträge hier kündigen“ (§ 312k BGB) und „Vertrag widerrufen“ (§ 356a BGB) – ohne Anmeldung erreichbar
// (verify_jwt = false, siehe supabase/config.toml). Speichert die Erklärung, kündigt ein zugeordnetes Abo
// zum Periodenende, bestätigt den Eingang per E-Mail und benachrichtigt OLO Vision.
// Deploy: supabase functions deploy consumer-request --no-verify-jwt
// Logik: _shared/legalOps.ts (handleConsumerRequest)
import { handleConsumerRequest } from '../_shared/legalOps.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handleConsumerRequest(req, realDeps()));
