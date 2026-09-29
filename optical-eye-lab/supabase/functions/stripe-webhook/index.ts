// Edge Function: stripe-webhook
// Zentrale, vertrauenswürdige Quelle für Zahlungs- und Abo-Status.
// Ohne Supabase-JWT erreichbar (verify_jwt = false, siehe supabase/config.toml), dafür ZWINGEND mit
// gültiger Stripe-Signatur (STRIPE_WEBHOOK_SECRET). Idempotent über public.stripe_events.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Logik: _shared/handlers.ts (handleWebhook)
import { handleWebhook } from '../_shared/handlers.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handleWebhook(req, realDeps()));
