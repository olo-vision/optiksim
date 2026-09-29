-- Minimaler Nachbau der Supabase-Umgebung für lokale Datenbanktests (PGlite).
-- NICHT in Supabase ausführen – dort existieren Schema `auth`, Rollen und Standardrechte bereits.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);

-- wie in Supabase: Benutzer-ID aus den JWT-Claims der Anfrage
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Aktueller Supabase-Standard (neue Projekte ab 30.05.2026, alle Projekte ab 30.10.2026):
-- Neue Tabellen und Sequenzen im Schema public werden an anon/authenticated/service_role NICHT mehr
-- automatisch freigegeben – jede Migration muss die benötigten Rechte ausdrücklich vergeben.
-- Funktionen sind weiterhin standardmäßig ausführbar (Migrationen müssen das gezielt zurücknehmen).
-- Das frühere Verhalten (automatische Freigabe) bildet legacy_default_privileges.sql nach.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
