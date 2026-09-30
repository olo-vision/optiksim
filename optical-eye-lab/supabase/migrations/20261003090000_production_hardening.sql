-- =====================================================================================================
-- OLO-LAB3D – Produktions-Härtung (Audit 0.10.x)
--
--  1. Geschlossene Konten sind serverseitig vollständig gesperrt (Lizenzprüfung, Demo) – bisher nur
--     beim Speichern von Inhalten.
--  2. Demo überschreibt keine vom Admin gesetzte Sonderlizenz (z. B. Sperre).
--  3. Gekündigt = cancel_at_period_end ODER cancel_at gesetzt (Stripe kann beides liefern) – überall gleich.
--  4. Grenzen für Inhalte: Größe von summary/tags, Obergrenze Anzahl je Konto (Missbrauchsschutz).
--  5. Drosselung öffentlicher Endpunkte (Kündigungs-/Widerrufsbutton) je IP und global.
--  6. Nachversand fehlgeschlagener Kündigungs-/Widerrufsbestätigungen (§ 312k BGB).
--  7. Pflicht-Rechtstexte für den Kauf: Prüfung auf fehlende aktive Versionen.
--  8. Rechte: Sequenzen, Hilfsfunktionen für anon.
--
-- Voraussetzung: alle Migrationen bis 20261002090000_account_retention.sql. Wiederholbar. Löscht keine Daten.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1) Geschlossene Konten: keine Lizenznutzung
-- ---------------------------------------------------------------------------------------------------
create or replace function public.has_active_license()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.licenses l
    join public.profiles p on p.institution_id = l.institution_id
    where p.user_id = auth.uid()
      and p.account_status = 'active'
      and (l.status = 'active' or (l.status = 'past_due' and l.grace_period_until > now()))
      and (l.valid_from is null or l.valid_from <= now())
      and (l.valid_until is null or l.valid_until > now())
  )
$$;

/** Besteht für die Institution ein laufendes, NICHT gekündigtes Abonnement? */
create or replace function public.institution_has_uncancelled_subscription(p_institution uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
     where s.institution_id = p_institution
       and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
       and not s.cancel_at_period_end
       and s.cancel_at is null
  )
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2) Demo: nicht für geschlossene Konten, nicht über eine Sonderlizenz
-- ---------------------------------------------------------------------------------------------------
create or replace function public.start_demo(p_document_ids uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles%rowtype;
  lic public.licenses%rowtype;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '2 hours';
begin
  if v_uid is null then
    raise exception 'Bitte melden Sie sich an.' using errcode = 'OLD03';
  end if;
  select * into v_prof from public.profiles where user_id = v_uid;
  if not found or v_prof.role not in ('institution_admin', 'super_admin') then
    raise exception 'Die Demo kann nur die Administration des Kundenkontos starten.' using errcode = 'OLD03';
  end if;
  if v_prof.account_status <> 'active' then
    raise exception 'Ihr Konto ist geschlossen. Bitte öffnen Sie es zuerst wieder.' using errcode = 'OLA03';
  end if;
  -- gegen parallele Doppelklicks: Institution sperren
  perform 1 from public.institutions where id = v_prof.institution_id for update;
  if exists (select 1 from public.demo_grants where user_id = v_uid or institution_id = v_prof.institution_id) then
    raise exception 'Die Demo wurde für dieses Kundenkonto bereits genutzt.' using errcode = 'OLD01';
  end if;
  select * into lic from public.licenses where institution_id = v_prof.institution_id order by created_at desc limit 1 for update;
  if found and (
       lic.source::text = 'manual'
    or (lic.status = 'active' and (lic.valid_until is null or lic.valid_until > now()))
    or (lic.status = 'past_due' and lic.grace_period_until > now())
    or exists (select 1 from public.subscriptions s where s.institution_id = v_prof.institution_id and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused'))
  ) then
    raise exception 'Für dieses Kundenkonto besteht bereits eine Lizenz.' using errcode = 'OLD02';
  end if;

  perform public.legal_record_consents(v_uid, 'demo', p_document_ids, null, 'demo', null);

  insert into public.demo_grants (user_id, institution_id, license_id, started_at, expires_at)
  values (v_uid, v_prof.institution_id, lic.id, v_start, v_end);

  update public.licenses
     set status = 'active', source = 'demo', valid_from = v_start, valid_until = v_end, grace_period_until = null
   where id = lic.id;

  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (v_uid, v_prof.institution_id, 'demo.started', jsonb_build_object('expires_at', v_end));

  return jsonb_build_object('started_at', v_start, 'expires_at', v_end, 'server_now', now());
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3) „Gekündigt“ einheitlich: Konto schließen/löschen, Übersicht, Erinnerung Jahreslizenz
-- ---------------------------------------------------------------------------------------------------
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
  v_open boolean;
begin
  select p.user_id, p.institution_id, p.role, p.account_status, p.closed_at, p.deletion_due_at into v_profile
    from public.profiles p where p.user_id = auth.uid();
  if v_profile.user_id is null then
    raise exception 'Kein Profil.' using errcode = '42501';
  end if;
  select s.status, (s.cancel_at_period_end or s.cancel_at is not null) as cancelled, s.current_period_end, s.cancel_at into v_sub
    from public.subscriptions s
   where s.institution_id = v_profile.institution_id and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
   order by s.created_at desc limit 1;
  v_open := public.institution_has_uncancelled_subscription(v_profile.institution_id);
  return jsonb_build_object(
    'account_status', v_profile.account_status,
    'closed_at', v_profile.closed_at,
    'deletion_due_at', v_profile.deletion_due_at,
    'simulations', (select count(*) from public.user_simulations s where s.owner_user_id = auth.uid()),
    'templates', (select count(*) from public.user_templates t where t.owner_user_id = auth.uid()),
    'live_subscription', v_sub.status is not null,
    'subscription_status', v_sub.status,
    'cancel_at_period_end', coalesce(v_sub.cancelled, false),
    'current_period_end', coalesce(v_sub.cancel_at, v_sub.current_period_end),
    'can_delete', not v_open,
    'can_close', not v_open
  );
end;
$$;

create or replace function public.close_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  select p.user_id, p.institution_id, p.account_status into v_profile from public.profiles p where p.user_id = auth.uid() for update;
  if v_profile.user_id is null then
    raise exception 'Kein Profil.' using errcode = '42501';
  end if;
  if public.institution_has_uncancelled_subscription(v_profile.institution_id) then
    raise exception 'Bitte kündigen Sie zuerst Ihr Abonnement. Danach können Sie Ihr Konto schließen.' using errcode = 'OLA01';
  end if;
  update public.profiles
     set account_status = 'closed',
         closed_at = coalesce(closed_at, now()),
         deletion_due_at = coalesce(deletion_due_at, now() + interval '12 months'),
         deletion_reminder_sent_at = case when account_status = 'closed' then deletion_reminder_sent_at else null end
   where user_id = auth.uid();
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_profile.institution_id, 'account.closed', '{}'::jsonb);
  return public.my_account_overview();
end;
$$;

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
  v_by text := case when p_initiated_by in ('admin', 'retention') then p_initiated_by else 'self' end;
begin
  select p.user_id, p.institution_id, p.email, p.account_status, p.deletion_due_at, p.deletion_reminder_sent_at
    into v_profile from public.profiles p where p.user_id = p_user for update;
  if v_profile.user_id is null then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;
  if v_by = 'retention' and not (
       v_profile.account_status = 'closed'
       and v_profile.deletion_due_at is not null and v_profile.deletion_due_at <= now()
       and v_profile.deletion_reminder_sent_at is not null
       and v_profile.deletion_reminder_sent_at <= now() - make_interval(days => public.retention_notice_days())
     ) then
    raise exception 'Das Konto ist nicht zur automatischen Löschung fällig.' using errcode = 'OLA02';
  end if;
  if public.institution_has_uncancelled_subscription(v_profile.institution_id) then
    raise exception 'Es besteht ein laufendes Abonnement. Bitte zuerst kündigen.' using errcode = 'OLA01';
  end if;
  select stripe_customer_id into v_customer from public.billing_customers where institution_id = v_profile.institution_id;

  insert into public.deleted_accounts (former_user_id, former_institution_id, email_sha256, stripe_customer_id, initiated_by)
  values (p_user, v_profile.institution_id, encode(sha256(convert_to(lower(btrim(v_profile.email)), 'UTF8')), 'hex'), v_customer, v_by);

  delete from public.user_simulations where owner_user_id = p_user;
  delete from public.user_templates where owner_user_id = p_user;
  delete from public.user_preferences where user_id = p_user;

  select count(*) into v_others from public.profiles where institution_id = v_profile.institution_id and user_id <> p_user;
  if v_others = 0 then
    update public.institutions
       set name = 'Gelöschtes Konto', contact_name = null, address_line_1 = null, address_line_2 = null,
           postal_code = null, city = null, vat_id = null, contact_position = null
     where id = v_profile.institution_id;
  end if;
  delete from public.profiles where user_id = p_user;

  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (null, v_profile.institution_id, 'account.deleted', jsonb_build_object('initiated_by', v_by));
  return jsonb_build_object('ok', true, 'institution_id', v_profile.institution_id, 'email', v_profile.email);
end;
$$;

drop function if exists public.renewal_reminder_candidates(integer);
create function public.renewal_reminder_candidates(p_days integer default 14)
returns table (subscription_id uuid, stripe_subscription_id text, email text, first_name text, last_name text, current_period_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.id) s.id, s.stripe_subscription_id, p.email, p.first_name, p.last_name, coalesce(s.cancel_at, s.current_period_end)
    from public.subscriptions s
    join public.institutions i on i.id = s.institution_id
    join public.profiles p on p.institution_id = s.institution_id
   where i.type = 'private'
     and s.plan = 'private'
     and s.billing_interval = 'yearly'
     and s.status in ('active', 'trialing')
     and (s.cancel_at_period_end or s.cancel_at is not null)
     and s.renewal_reminder_sent_at is null
     and coalesce(s.cancel_at, s.current_period_end) > now()
     and coalesce(s.cancel_at, s.current_period_end) <= now() + make_interval(days => greatest(1, least(p_days, 60)))
   order by s.id, (p.role = 'institution_admin') desc
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4) Grenzen für Inhalte
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_simulations_summary_size') then
    alter table public.user_simulations add constraint user_simulations_summary_size check (octet_length(summary::text) <= 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_simulations_tags_size') then
    alter table public.user_simulations add constraint user_simulations_tags_size check (octet_length(array_to_string(tags, '')) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_templates_tags_size') then
    alter table public.user_templates add constraint user_templates_tags_size check (octet_length(array_to_string(tags, '')) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_simulations_origin_size') then
    alter table public.user_simulations add constraint user_simulations_origin_size check (origin is null or char_length(origin) <= 40);
  end if;
end;
$$;

/** Obergrenze je Konto (großzügig; schützt vor Missbrauch und Kostenexplosion) */
create or replace function public.guard_user_content_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_limit integer := case when tg_table_name = 'user_simulations' then 5000 else 500 end;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_table_name = 'user_simulations' then
    select count(*) into v_count from public.user_simulations where owner_user_id = auth.uid();
  else
    select count(*) into v_count from public.user_templates where owner_user_id = auth.uid();
  end if;
  if v_count >= v_limit then
    raise exception 'Die maximale Anzahl gespeicherter Inhalte ist erreicht. Bitte löschen Sie nicht mehr benötigte Einträge oder wenden Sie sich an info@olo-vision.de.' using errcode = 'OLL02';
  end if;
  return new;
end;
$$;
drop trigger if exists user_simulations_quota on public.user_simulations;
create trigger user_simulations_quota before insert on public.user_simulations
  for each row execute function public.guard_user_content_quota();
drop trigger if exists user_templates_quota on public.user_templates;
create trigger user_templates_quota before insert on public.user_templates
  for each row execute function public.guard_user_content_quota();

-- ---------------------------------------------------------------------------------------------------
-- 5) Drosselung öffentlicher Endpunkte
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.request_throttle (
  bucket text primary key check (char_length(bucket) <= 200),
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
revoke all on table public.request_throttle from public, anon, authenticated;
alter table public.request_throttle enable row level security;

/** Zählt einen Aufruf; true = erlaubt, false = Grenze im aktuellen Zeitfenster erreicht */
create or replace function public.throttle_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.request_throttle as t (bucket, window_start, hits)
  values (left(p_bucket, 200), now(), 1)
  on conflict (bucket) do update
     set window_start = case when t.window_start < now() - make_interval(secs => p_window_seconds) then now() else t.window_start end,
         hits = case when t.window_start < now() - make_interval(secs => p_window_seconds) then 1 else t.hits + 1 end
  returning hits into v_hits;
  -- alte Einträge gelegentlich aufräumen
  if random() < 0.01 then
    delete from public.request_throttle where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6) Nachversand von Kündigungs-/Widerrufsbestätigungen
-- ---------------------------------------------------------------------------------------------------
create or replace function public.declaration_confirmations_pending(p_days integer default 7)
returns table (
  id uuid, kind text, cancellation_type text, name text, email text, recipient text, contract_details text,
  reason text, received_at timestamptz, first_name text, status text, result jsonb, matched boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.kind, d.cancellation_type, d.name, d.email, coalesce(p.email, d.email), d.contract_details,
         d.reason, d.received_at, p.first_name, d.status, d.result, d.stripe_subscription_id is not null
    from public.consumer_declarations d
    left join public.profiles p on p.user_id = d.user_id
   where d.confirmation_sent_at is null
     and d.received_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
     and d.received_at < now() - interval '5 minutes'
     and coalesce((d.result ->> 'throttled')::boolean, false) = false
   order by d.received_at
   limit 50
$$;

create or replace function public.declaration_mark_confirmed(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.consumer_declarations set confirmation_sent_at = coalesce(confirmation_sent_at, now()) where id = p_id
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7) Pflicht-Rechtstexte für den Kauf vorhanden?
-- ---------------------------------------------------------------------------------------------------
/** Typen, für die im Kontext keine aktive Version veröffentlicht ist (leer = alles vorhanden) */
create or replace function public.legal_required_types_missing(p_context public.legal_consent_context, p_customer_type public.institution_type)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aud public.legal_audience := public.legal_audience_for(p_customer_type);
  v_types public.legal_document_type[];
  v_missing text[] := '{}';
  t public.legal_document_type;
begin
  if p_context in ('registration', 'demo') then
    v_types := array['privacy', 'license_terms']::public.legal_document_type[];
  elsif v_aud = 'b2c' then
    v_types := array['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'consent_immediate_performance', 'consent_withdrawal_loss']::public.legal_document_type[];
  else
    v_types := array['terms', 'b2b_terms', 'privacy', 'license_terms']::public.legal_document_type[];
  end if;
  foreach t in array v_types loop
    if not exists (
      select 1 from public.legal_documents d
       where d.type = t and d.status = 'active' and d.audience in (v_aud, 'all')
         and (d.effective_from is null or d.effective_from <= now())
    ) then
      v_missing := v_missing || t::text;
    end if;
  end loop;
  return v_missing;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9) Stripe-Ereignisse: „läuft gerade“ von „erledigt“ unterscheiden (Stripe soll bei laufender
--    Verarbeitung erneut zustellen statt 200 zu erhalten)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.stripe_event_claim(p_id text, p_type text, p_created timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_started timestamptz;
begin
  insert into public.stripe_events (id, type, stripe_created_at) values (p_id, left(p_type, 120), p_created)
  on conflict (id) do nothing;
  if found then
    return 'start';
  end if;
  select status, started_at into v_status, v_started from public.stripe_events where id = p_id for update;
  if v_status = 'failed' or (v_status = 'processing' and v_started < now() - interval '2 minutes') then
    update public.stripe_events
       set status = 'processing', attempts = attempts + 1, error = null, started_at = now()
     where id = p_id;
    return 'start';
  end if;
  return case when v_status = 'processing' then 'busy' else 'done' end;
end;
$$;

/** Stripe-Kunden einer Institution ersetzen (gespeicherter Kunde existiert im aktuellen Stripe-Modus nicht) */
create or replace function public.billing_replace_customer(p_institution uuid, p_customer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'Ungültige Kunden-ID.' using errcode = '22023';
  end if;
  update public.billing_customers set stripe_customer_id = p_customer where institution_id = p_institution;
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (null, p_institution, 'billing.customer_replaced', jsonb_build_object('customer', p_customer));
end;
$$;

-- Hinweis-E-Mails an den Betreiber (z. B. doppeltes Abonnement)
alter table public.system_mails drop constraint if exists system_mails_kind_check;
alter table public.system_mails add constraint system_mails_kind_check check (kind in (
  'contract_confirmation', 'cancellation_confirmation', 'withdrawal_confirmation', 'declaration_notice',
  'renewal_reminder', 'b2b_country_notice', 'account_deleted', 'account_deletion_reminder', 'admin_notice'));

-- ---------------------------------------------------------------------------------------------------
-- 8) Rechte
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class where relname = 'audit_logs_id_seq' and relkind = 'S') then
    execute 'revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_class where relname = 'system_mails_id_seq' and relkind = 'S') then
    execute 'revoke all on sequence public.system_mails_id_seq from public, anon, authenticated';
  end if;
end;
$$;

revoke execute on function public.billing_replace_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_replace_customer(uuid, text) to service_role;
revoke execute on function public.stripe_event_claim(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, text, timestamptz) to service_role;
revoke execute on function public.has_active_license() from public, anon;
grant execute on function public.has_active_license() to authenticated, service_role;
revoke execute on function public.my_institution_id() from public, anon;
grant execute on function public.my_institution_id() to authenticated, service_role;
revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated, service_role;
revoke execute on function public.is_institution_admin(uuid) from public, anon;
grant execute on function public.is_institution_admin(uuid) to authenticated, service_role;
revoke execute on function public.institution_has_uncancelled_subscription(uuid) from public, anon, authenticated;
grant execute on function public.institution_has_uncancelled_subscription(uuid) to service_role;
revoke execute on function public.guard_user_content_quota() from public, anon, authenticated;
revoke execute on function public.throttle_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.throttle_hit(text, integer, integer) to service_role;
revoke execute on function public.declaration_confirmations_pending(integer) from public, anon, authenticated;
grant execute on function public.declaration_confirmations_pending(integer) to service_role;
revoke execute on function public.declaration_mark_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.declaration_mark_confirmed(uuid) to service_role;
revoke execute on function public.legal_required_types_missing(public.legal_consent_context, public.institution_type) from public, anon, authenticated;
grant execute on function public.legal_required_types_missing(public.legal_consent_context, public.institution_type) to service_role;
revoke execute on function public.start_demo(uuid[]) from public, anon;
grant execute on function public.start_demo(uuid[]) to authenticated;
revoke execute on function public.my_account_overview() from public, anon;
grant execute on function public.my_account_overview() to authenticated;
revoke execute on function public.close_my_account() from public, anon;
grant execute on function public.close_my_account() to authenticated;
revoke execute on function public.delete_account_data(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, text) to service_role;
revoke execute on function public.renewal_reminder_candidates(integer) from public, anon, authenticated;
grant execute on function public.renewal_reminder_candidates(integer) to service_role;
