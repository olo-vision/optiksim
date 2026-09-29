-- Früherer Supabase-Standard (Projekte vor dem 30.05.2026, bis zur Umstellung am 30.10.2026):
-- neue Tabellen/Sequenzen im Schema public werden automatisch an alle API-Rollen freigegeben.
-- Nur für Tests: Die Migrationen müssen unter BEIDEN Varianten sicher und funktionsfähig sein.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
