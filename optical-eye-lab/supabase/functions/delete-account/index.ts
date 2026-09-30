// Edge Function: delete-account
// Endgültige Löschung des eigenen Kontos (bzw. durch Super-Admins auf Antrag). Nur mit frischer Anmeldung
// (≤ 10 Minuten) und Bestätigungswort; nicht bei laufendem, ungekündigtem Abonnement.
// Deploy: supabase functions deploy delete-account
// Logik: _shared/accountOps.ts (handleDeleteAccount)
import { handleDeleteAccount } from '../_shared/accountOps.ts';
import { realDeps } from '../_shared/deps.ts';

Deno.serve((req) => handleDeleteAccount(req, realDeps()));
