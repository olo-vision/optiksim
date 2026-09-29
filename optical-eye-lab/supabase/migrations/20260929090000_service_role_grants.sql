-- =============================================================================
-- OLO-LAB3D – Phase 7.1: ausdrückliche Rechte für den Server-Schlüssel (service_role)
--
-- Anlass: Fehler „permission denied for table profiles“ in create-checkout-session.
-- Ursache: Supabase gibt neue Tabellen im Schema public seit 30.05.2026 (neue Projekte; alle Projekte ab
-- 30.10.2026) NICHT mehr automatisch an anon/authenticated/service_role frei. RLS umgeht service_role
-- zwar, Tabellenrechte (GRANT) braucht die Rolle trotzdem. Die Phase-6/7-Migrationen vergeben die Rechte
-- für anon/authenticated bereits ausdrücklich – für service_role fehlten sie.
--
-- Vergeben wird nur, was die Edge Functions direkt benötigen (kleinstmögliche Rechte). Alles Weitere
-- (Abo-/Lizenzänderungen, Idempotenz, Audit) läuft über SECURITY-DEFINER-Funktionen, deren
-- Ausführungsrecht service_role bereits ausdrücklich besitzt.
--
-- anon/authenticated erhalten KEINE zusätzlichen Rechte; RLS-Policies bleiben unverändert.
-- Die Datei ist wiederholbar (GRANT ist idempotent).
-- =============================================================================

grant usage on schema public to service_role;

-- Lesen: Konto des Aufrufers (Profil, Institution, Lizenz), laufende Abos, Stripe-Kunde
grant select on table public.profiles to service_role;
grant select on table public.institutions to service_role;
grant select on table public.licenses to service_role;
grant select on table public.subscriptions to service_role;
grant select on table public.plan_catalog to service_role;

-- Stripe-Kunde der Institution speichern (Checkout; nur Einfügen, kein Ändern/Löschen)
grant select, insert on table public.billing_customers to service_role;

-- Ausführungsrechte der serverseitigen Funktionen (bereits in 20260928200000 vergeben; hier zur
-- Vollständigkeit wiederholt, falls diese Datei einzeln eingespielt wird)
grant execute on function public.apply_stripe_subscription(jsonb) to service_role;
grant execute on function public.sync_license_for_institution(uuid, text) to service_role;
grant execute on function public.expire_grace_periods() to service_role;
grant execute on function public.stripe_event_begin(text, text, timestamptz) to service_role;
grant execute on function public.stripe_event_finish(text, text, text) to service_role;
