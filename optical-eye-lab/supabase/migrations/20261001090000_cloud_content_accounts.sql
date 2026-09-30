-- =====================================================================================================
-- OLO-LAB3D – Cloud-Speicherung der Kundeninhalte und Kontoverwaltung (Version 0.10.0)
--
--  1. Inhalte des Kontos serverseitig: user_simulations (inkl. Vorschaubild), user_templates,
--     user_preferences. Jede Zeile gehört einem Benutzer (owner_user_id) UND einer Institution
--     (institution_id). Heute gilt: ein Login je Kundenkonto → sichtbar nur für den Besitzer.
--     Später (persönliche Mitarbeiter-/Lehrkräfte-Accounts) genügt es, visibility = 'institution' zu setzen
--     bzw. neue Benutzer derselben Institution anzulegen – ohne Daten zu verschieben.
--  2. Lizenz ≠ Daten: Inhalte hängen NICHT an der Lizenz. Endet die Lizenz, bleiben alle Inhalte erhalten
--     (lesen/exportieren weiterhin möglich); neu anlegen/ändern erfordert eine aktive Lizenz (inkl. Demo).
--  3. Konto schließen (umkehrbar) und endgültig löschen (Art. 17 DSGVO) mit gesetzlichen Nachweisen.
--  4. E-Mail-Änderung in Supabase Auth wird in profiles.email übernommen.
--
-- Voraussetzung: Migrationen bis 20260930090000_legal_operations.sql. Wiederholbar ausführbar.
-- Löscht KEINE bestehenden Daten.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1) Kontostatus
-- ---------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles add column if not exists closed_at timestamptz;
-- Ende der Aufbewahrung eines geschlossenen Kontos (Datenschutzerklärung: 12 Monate)
alter table public.profiles add column if not exists deletion_due_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_status_check') then
    alter table public.profiles add constraint profiles_account_status_check check (account_status in ('active', 'closed'));
  end if;
end;
$$;

/** Darf der angemeldete Benutzer Inhalte anlegen/ändern? Konto aktiv UND Lizenz aktiv (inkl. Demo, Zahlungsfrist). */
create or replace function public.content_write_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.account_status = 'active')
     and public.has_active_license()
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2) Inhalte
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.user_simulations (
  -- Client-ID (z. B. „sim_…“): bleibt bei der Übernahme lokaler Daten erhalten → keine Duplikate
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'institution')),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default 'other' check (char_length(category) <= 40),
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  favorite boolean not null default false,
  archived boolean not null default false,
  template_id text check (template_id is null or char_length(template_id) <= 80),
  module_id text check (module_id is null or char_length(module_id) <= 80),
  summary jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  doc jsonb not null check (octet_length(doc::text) <= 5000000),
  -- Optimistische Nebenläufigkeit: jede Änderung des Dokuments erhöht die Revision (Trigger)
  doc_revision integer not null default 1,
  thumbnail text check (thumbnail is null or octet_length(thumbnail) <= 600000),
  has_thumbnail boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  -- Herkunft (z. B. 'local-migration' bei der Übernahme aus dem Browser)
  origin text check (origin is null or char_length(origin) <= 40)
);
create index if not exists user_simulations_owner_idx on public.user_simulations (owner_user_id, updated_at desc);
create index if not exists user_simulations_institution_idx on public.user_simulations (institution_id);

create table if not exists public.user_templates (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'institution')),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default 'other' check (char_length(category) <= 40),
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  doc jsonb not null check (octet_length(doc::text) <= 5000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_templates_owner_idx on public.user_templates (owner_user_id);

create table if not exists public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb check (octet_length(prefs::text) <= 200000),
  updated_at timestamptz not null default now()
);

/**
 * Schutz der Inhaltstabellen (für Browser-Rollen):
 *  - Besitzer und Institution setzt ausschließlich der Server (auth.uid(), my_institution_id()).
 *  - Anlegen/Ändern nur mit aktivem Konto und aktiver Lizenz; Löschen der eigenen Inhalte immer.
 *  - Revision und Zeitstempel verwaltet der Server; Übernahme lokaler Daten darf ältere Zeitpunkte
 *    mitbringen (nie in der Zukunft).
 */
create or replace function public.guard_user_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_client boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_is_client and not public.content_write_allowed() then
    raise exception 'Zum Speichern ist eine aktive Lizenz erforderlich. Ihre bereits gespeicherten Inhalte bleiben erhalten.' using errcode = 'OLL01';
  end if;
  if tg_op = 'INSERT' then
    if v_is_client then
      new.owner_user_id := auth.uid();
      new.institution_id := public.my_institution_id();
      if new.institution_id is null then
        raise exception 'Kein Profil.' using errcode = '42501';
      end if;
    end if;
    new.created_at := least(coalesce(new.created_at, now()), now());
    new.updated_at := least(greatest(coalesce(new.updated_at, now()), new.created_at), now());
    if tg_table_name = 'user_simulations' then
      new.doc_revision := 1;
    end if;
    return new;
  end if;
  -- UPDATE
  if new.owner_user_id is distinct from old.owner_user_id or new.institution_id is distinct from old.institution_id
     or new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Besitzer und Kennung eines Inhalts können nicht geändert werden.' using errcode = '42501';
  end if;
  if tg_table_name = 'user_simulations' then
    if new.doc is distinct from old.doc then
      new.doc_revision := old.doc_revision + 1;
    else
      new.doc_revision := old.doc_revision;
    end if;
    if new.doc is distinct from old.doc or new.name is distinct from old.name or new.description is distinct from old.description
       or new.category is distinct from old.category or new.tags is distinct from old.tags or new.archived is distinct from old.archived
       or new.summary is distinct from old.summary then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists user_simulations_guard on public.user_simulations;
create trigger user_simulations_guard before insert or update or delete on public.user_simulations
  for each row execute function public.guard_user_content();
drop trigger if exists user_templates_guard on public.user_templates;
create trigger user_templates_guard before insert or update or delete on public.user_templates
  for each row execute function public.guard_user_content();

create or replace function public.guard_user_preferences()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.user_id is distinct from auth.uid() then
      raise exception 'Nur die eigenen Einstellungen.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists user_preferences_guard on public.user_preferences;
create trigger user_preferences_guard before insert or update on public.user_preferences
  for each row execute function public.guard_user_preferences();

-- RLS: Besitzer; zusätzlich (künftig) für die Institution freigegebene Inhalte lesbar
alter table public.user_simulations enable row level security;
alter table public.user_templates enable row level security;
alter table public.user_preferences enable row level security;

drop policy if exists user_simulations_select on public.user_simulations;
create policy user_simulations_select on public.user_simulations for select to authenticated
  using (owner_user_id = auth.uid() or (visibility = 'institution' and institution_id = public.my_institution_id()));
drop policy if exists user_simulations_insert on public.user_simulations;
create policy user_simulations_insert on public.user_simulations for insert to authenticated
  with check (owner_user_id = auth.uid());
drop policy if exists user_simulations_update on public.user_simulations;
create policy user_simulations_update on public.user_simulations for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists user_simulations_delete on public.user_simulations;
create policy user_simulations_delete on public.user_simulations for delete to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists user_templates_select on public.user_templates;
create policy user_templates_select on public.user_templates for select to authenticated
  using (owner_user_id = auth.uid() or (visibility = 'institution' and institution_id = public.my_institution_id()));
drop policy if exists user_templates_insert on public.user_templates;
create policy user_templates_insert on public.user_templates for insert to authenticated
  with check (owner_user_id = auth.uid());
drop policy if exists user_templates_update on public.user_templates;
create policy user_templates_update on public.user_templates for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists user_templates_delete on public.user_templates;
create policy user_templates_delete on public.user_templates for delete to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rechte (Supabase vergibt für neue Tabellen keine automatischen Rechte mehr)
revoke all on table public.user_simulations, public.user_templates, public.user_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_simulations, public.user_templates to authenticated;
grant select, insert, update on table public.user_preferences to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3) Konto schließen / wieder öffnen / endgültig löschen
-- ---------------------------------------------------------------------------------------------------

/** Nachweise gelöschter Konten (Aufbewahrung 3 Jahre): nur Pseudonym + Bezug zu Stripe/Institution */
create table if not exists public.deleted_accounts (
  id uuid primary key default gen_random_uuid(),
  former_user_id uuid not null,
  former_institution_id uuid,
  email_sha256 text not null,
  stripe_customer_id text,
  initiated_by text not null check (initiated_by in ('self', 'admin')),
  deleted_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '3 years')
);
revoke all on table public.deleted_accounts from public, anon, authenticated;
alter table public.deleted_accounts enable row level security;
drop trigger if exists deleted_accounts_server_only on public.deleted_accounts;
create trigger deleted_accounts_server_only before insert or update or delete on public.deleted_accounts
  for each row execute function public.guard_server_only();

/** Übersicht für die Kontoseite: Inhalte, Kontostatus, laufendes Abo */
create or replace function public.my_account_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_sub record;
begin
  select p.user_id, p.institution_id, p.role, p.account_status, p.closed_at, p.deletion_due_at into v_profile
    from public.profiles p where p.user_id = auth.uid();
  if v_profile.user_id is null then
    raise exception 'Kein Profil.' using errcode = '42501';
  end if;
  select s.status, s.cancel_at_period_end, s.current_period_end into v_sub
    from public.subscriptions s
   where s.institution_id = v_profile.institution_id and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
   order by s.created_at desc limit 1;
  return jsonb_build_object(
    'account_status', v_profile.account_status,
    'closed_at', v_profile.closed_at,
    'deletion_due_at', v_profile.deletion_due_at,
    'simulations', (select count(*) from public.user_simulations s where s.owner_user_id = auth.uid()),
    'templates', (select count(*) from public.user_templates t where t.owner_user_id = auth.uid()),
    'live_subscription', v_sub.status is not null,
    'subscription_status', v_sub.status,
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false),
    'current_period_end', v_sub.current_period_end,
    'can_delete', v_sub.status is null or coalesce(v_sub.cancel_at_period_end, false),
    'can_close', v_sub.status is null or coalesce(v_sub.cancel_at_period_end, false)
  );
end;
$$;

/**
 * Konto schließen: Zugriff auf OLO-LAB3D endet, gespeicherte Inhalte bleiben 12 Monate erhalten und das
 * Konto kann bis dahin jederzeit wieder geöffnet werden. Nur ohne laufendes (ungekündigtes) Abonnement.
 */
create or replace function public.close_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_live boolean;
begin
  select p.user_id, p.institution_id, p.account_status into v_profile from public.profiles p where p.user_id = auth.uid() for update;
  if v_profile.user_id is null then
    raise exception 'Kein Profil.' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.subscriptions s
     where s.institution_id = v_profile.institution_id
       and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
       and not s.cancel_at_period_end
  ) into v_live;
  if v_live then
    raise exception 'Bitte kündigen Sie zuerst Ihr Abonnement. Danach können Sie Ihr Konto schließen.' using errcode = 'OLA01';
  end if;
  update public.profiles
     set account_status = 'closed',
         closed_at = coalesce(closed_at, now()),
         deletion_due_at = coalesce(deletion_due_at, now() + interval '12 months')
   where user_id = auth.uid();
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_profile.institution_id, 'account.closed', '{}'::jsonb);
  return public.my_account_overview();
end;
$$;

create or replace function public.reopen_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst uuid;
begin
  update public.profiles set account_status = 'active', closed_at = null, deletion_due_at = null
   where user_id = auth.uid() and account_status = 'closed'
  returning institution_id into v_inst;
  if v_inst is not null then
    insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
    values (auth.uid(), v_inst, 'account.reopened', '{}'::jsonb);
  end if;
  return public.my_account_overview();
end;
$$;

/**
 * Endgültige Löschung (nur service_role, Edge Function delete-account; danach löscht die Function den
 * Auth-Benutzer). Entfernt alle Inhalte und personenbezogenen Stammdaten; behält nur, was gesetzlich
 * aufbewahrt werden muss bzw. zur Abwehr von Ansprüchen nötig ist:
 *  - Zustimmungsprotokoll, Kündigungs-/Widerrufserklärungen, E-Mail-Protokoll (3 Jahre, bestehende Regeln)
 *  - Abo-/Lizenzdatensätze ohne Personenbezug, Stripe-Kunden-ID (Rechnungen liegen bei Stripe)
 *  - Nachweis der Löschung mit gehashter E-Mail-Adresse (3 Jahre)
 * Wiederholbar: bereits gelöschte Teile werden übersprungen.
 */
create or replace function public.delete_account_data(p_user uuid, p_initiated_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_others integer;
  v_customer text;
  v_live boolean;
begin
  select p.user_id, p.institution_id, p.email into v_profile from public.profiles p where p.user_id = p_user for update;
  if v_profile.user_id is null then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;
  select exists (
    select 1 from public.subscriptions s
     where s.institution_id = v_profile.institution_id
       and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
       and not s.cancel_at_period_end
  ) into v_live;
  if v_live then
    raise exception 'Es besteht ein laufendes Abonnement. Bitte zuerst kündigen.' using errcode = 'OLA01';
  end if;
  select stripe_customer_id into v_customer from public.billing_customers where institution_id = v_profile.institution_id;

  insert into public.deleted_accounts (former_user_id, former_institution_id, email_sha256, stripe_customer_id, initiated_by)
  values (p_user, v_profile.institution_id, encode(sha256(convert_to(lower(btrim(v_profile.email)), 'UTF8')), 'hex'), v_customer,
          case when p_initiated_by = 'admin' then 'admin' else 'self' end);

  delete from public.user_simulations where owner_user_id = p_user;
  delete from public.user_templates where owner_user_id = p_user;
  delete from public.user_preferences where user_id = p_user;

  -- Institution anonymisieren, wenn kein weiterer Benutzer daran hängt (heute: ein Login je Konto)
  select count(*) into v_others from public.profiles where institution_id = v_profile.institution_id and user_id <> p_user;
  if v_others = 0 then
    update public.institutions
       set name = 'Gelöschtes Konto', contact_name = null, address_line_1 = null, address_line_2 = null,
           postal_code = null, city = null, vat_id = null, contact_position = null
     where id = v_profile.institution_id;
  end if;
  -- Profil entfernen; Auth-Benutzer löscht die Edge Function (auth.admin.deleteUser)
  delete from public.profiles where user_id = p_user;

  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (null, v_profile.institution_id, 'account.deleted', jsonb_build_object('initiated_by', p_initiated_by));
  return jsonb_build_object('ok', true, 'institution_id', v_profile.institution_id, 'email', v_profile.email);
end;
$$;

/** Super-Admin: geschlossene Konten (fällige Löschungen nach Ablauf der Aufbewahrung) */
create or replace function public.admin_closed_accounts()
returns table (user_id uuid, email text, institution_name text, closed_at timestamptz, deletion_due_at timestamptz, simulations bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.email, i.name, p.closed_at, p.deletion_due_at,
           (select count(*) from public.user_simulations s where s.owner_user_id = p.user_id)
      from public.profiles p join public.institutions i on i.id = p.institution_id
     where p.account_status = 'closed'
     order by p.deletion_due_at nulls last;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4) E-Mail-Änderung aus Supabase Auth übernehmen
-- ---------------------------------------------------------------------------------------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = new.email where user_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------------------------------
-- 5) E-Mails: förmliche Anrede (Vor- und Nachname) und neue E-Mail-Art „Konto gelöscht“
-- ---------------------------------------------------------------------------------------------------
drop function if exists public.renewal_reminder_candidates(integer);
create function public.renewal_reminder_candidates(p_days integer default 14)
returns table (subscription_id uuid, stripe_subscription_id text, email text, first_name text, last_name text, current_period_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.id) s.id, s.stripe_subscription_id, p.email, p.first_name, p.last_name, s.current_period_end
    from public.subscriptions s
    join public.institutions i on i.id = s.institution_id
    join public.profiles p on p.institution_id = s.institution_id
   where i.type = 'private'
     and s.plan = 'private'
     and s.billing_interval = 'yearly'
     and s.status in ('active', 'trialing')
     and s.cancel_at_period_end
     and s.renewal_reminder_sent_at is null
     and s.current_period_end > now()
     and s.current_period_end <= now() + make_interval(days => greatest(1, least(p_days, 60)))
   order by s.id, (p.role = 'institution_admin') desc
$$;
revoke execute on function public.renewal_reminder_candidates(integer) from public, anon, authenticated;
grant execute on function public.renewal_reminder_candidates(integer) to service_role;

alter table public.system_mails drop constraint if exists system_mails_kind_check;
alter table public.system_mails add constraint system_mails_kind_check check (kind in (
  'contract_confirmation', 'cancellation_confirmation', 'withdrawal_confirmation', 'declaration_notice',
  'renewal_reminder', 'b2b_country_notice', 'account_deleted'));

-- ---------------------------------------------------------------------------------------------------
-- Ausführungsrechte
-- ---------------------------------------------------------------------------------------------------
revoke execute on function public.content_write_allowed() from public, anon;
grant execute on function public.content_write_allowed() to authenticated, service_role;
revoke execute on function public.my_account_overview() from public, anon;
revoke execute on function public.close_my_account() from public, anon;
revoke execute on function public.reopen_my_account() from public, anon;
grant execute on function public.my_account_overview() to authenticated;
grant execute on function public.close_my_account() to authenticated;
grant execute on function public.reopen_my_account() to authenticated;
revoke execute on function public.delete_account_data(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, text) to service_role;
revoke execute on function public.admin_closed_accounts() from public, anon;
grant execute on function public.admin_closed_accounts() to authenticated;
revoke execute on function public.guard_user_content() from public, anon, authenticated;
revoke execute on function public.guard_user_preferences() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

-- Edge Function delete-account (service_role): Konto und Abo lesen, Stripe-Kunde ermitteln
grant select on table public.subscriptions, public.billing_customers, public.profiles to service_role;
