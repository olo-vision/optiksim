// Edge Function: mail-jobs
// Stündlich per pg_cron + pg_net aufgerufen (Header x-cron-secret = Secret CRON_SECRET):
// fehlgeschlagene Vertragsbestätigungen nachholen und private Jahreslizenzen 14 Tage vor Ablauf erinnern.
// Deploy: supabase functions deploy mail-jobs --no-verify-jwt   (Einrichtung des Zeitplans: docs/LEGAL_OPERATIONS.md)
// Logik: _shared/legalOps.ts (handleMailJobs)
import { handleMailJobs } from '../_shared/legalOps.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handleMailJobs(req, realDeps()));
