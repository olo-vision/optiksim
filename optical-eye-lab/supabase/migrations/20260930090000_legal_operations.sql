-- =====================================================================================================
-- OLO-LAB3D – Rechtsbetrieb (nach Phase 8)
--
--  1. Dokumenttyp „imprint“ (Impressum, öffentlich, nie als Zustimmung abgefragt)
--  2. consumer_declarations: Kündigungen (§ 312k BGB) und Widerrufe (§ 356a BGB) über die Website
--  3. system_mails: Protokoll der transaktionalen E-Mails (Vertrags-, Kündigungs-, Widerrufsbestätigung,
--     Ablauf-Erinnerung) – verhindert Doppelversand
--  4. Ablauf-Erinnerung für private Jahreslizenzen (subscriptions.renewal_reminder_sent_at)
--  5. Veröffentlichen im Vertragscenter nur ohne offene [Prüfhinweis]-Markierungen
--
-- Voraussetzung: Migrationen bis 20260929120000_demo_billing_legal.sql. Wiederholbar ausführbar.
-- Zugriff: ausschließlich über geprüfte Funktionen; Tabellen ohne Rechte für anon/authenticated.
-- =====================================================================================================

-- 1) Impressum als Dokumenttyp ---------------------------------------------------------------------
alter type public.legal_document_type add value if not exists 'imprint';

-- 2) Kündigungen und Widerrufe ----------------------------------------------------------------------
create table if not exists public.consumer_declarations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cancellation', 'withdrawal')),
  cancellation_type text check (cancellation_type is null or cancellation_type in ('ordinary', 'extraordinary')),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  contract_details text check (contract_details is null or char_length(contract_details) <= 500),
  reason text check (reason is null or char_length(reason) <= 2000),
  -- Zuordnung (serverseitig ermittelt, nie aus dem Browser)
  user_id uuid references auth.users (id) on delete set null,
  institution_id uuid references public.institutions (id) on delete set null,
  customer_type public.institution_type,
  stripe_subscription_id text,
  -- Bearbeitung
  status text not null default 'received' check (status in ('received', 'processed', 'needs_review', 'done')),
  result jsonb not null default '{}'::jsonb,
  confirmation_sent_at timestamptz,
  notified_at timestamptz,
  handled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null,
  received_at timestamptz not null default now()
);
create index if not exists consumer_declarations_received_idx on public.consumer_declarations (received_at desc);
create index if not exists consumer_declarations_email_idx on public.consumer_declarations (lower(email), received_at desc);

/** Inhalt der Erklärung ist unveränderlich; nur Bearbeitungsfelder dürfen sich ändern. Löschen erst nach 3 Jahren. */
create or replace function public.guard_consumer_declarations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.received_at > now() - interval '3 years' then
      raise exception 'Erklärungen werden mindestens 3 Jahre aufbewahrt.' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.kind is distinct from old.kind or new.cancellation_type is distinct from old.cancellation_type
     or new.name is distinct from old.name or new.email is distinct from old.email
     or new.contract_details is distinct from old.contract_details or new.reason is distinct from old.reason
     or new.received_at is distinct from old.received_at then
    raise exception 'Der Inhalt einer Erklärung ist unveränderlich.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists consumer_declarations_guard on public.consumer_declarations;
create trigger consumer_declarations_guard before update or delete on public.consumer_declarations
  for each row execute function public.guard_consumer_declarations();
drop trigger if exists consumer_declarations_server_only on public.consumer_declarations;
create trigger consumer_declarations_server_only before insert or update or delete on public.consumer_declarations
  for each row execute function public.guard_server_only();

-- 3) E-Mail-Protokoll ---------------------------------------------------------------------------------
create table if not exists public.system_mails (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('contract_confirmation', 'cancellation_confirmation', 'withdrawal_confirmation', 'declaration_notice', 'renewal_reminder', 'b2b_country_notice')),
  recipient text not null check (char_length(recipient) <= 320),
  subject text not null check (char_length(subject) <= 300),
  related_key text check (related_key is null or char_length(related_key) <= 200),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now()
);
-- jede Bestätigung höchstens einmal erfolgreich (z. B. Vertragsbestätigung je Checkout-Session)
create unique index if not exists system_mails_once on public.system_mails (kind, related_key) where status = 'sent' and related_key is not null;
create index if not exists system_mails_created_idx on public.system_mails (created_at desc);
drop trigger if exists system_mails_server_only on public.system_mails;
create trigger system_mails_server_only before insert or update or delete on public.system_mails
  for each row execute function public.guard_server_only();

-- 4) Ablauf-Erinnerung ---------------------------------------------------------------------------------
alter table public.subscriptions add column if not exists renewal_reminder_sent_at timestamptz;

-- Rechte: keine direkten Zugriffe der API-Rollen
revoke all on table public.consumer_declarations, public.system_mails from public, anon, authenticated;
alter table public.consumer_declarations enable row level security;
alter table public.system_mails enable row level security;
-- auch service_role greift nur über die Funktionen unten zu (security definer)

-- ---------------------------------------------------------------------------------------------------
-- Serverfunktionen für die Edge Functions (nur service_role)
-- ---------------------------------------------------------------------------------------------------

/**
 * Erklärung (Kündigung/Widerruf) speichern und dem Konto zuordnen. Die Zuordnung erfolgt ausschließlich
 * über die E-Mail-Adresse des Kontos; der Browser erfährt nie, ob ein Konto gefunden wurde.
 */
create or replace function public.consumer_declaration_record(
  p_kind text, p_cancellation_type text, p_name text, p_email text, p_contract_details text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_profile record;
  v_inst record;
  v_sub record;
  v_id uuid;
  v_received timestamptz;
  v_recent integer;
begin
  if p_kind not in ('cancellation', 'withdrawal') then
    raise exception 'Unbekannte Erklärung.' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'Name und E-Mail-Adresse sind erforderlich.' using errcode = '22023';
  end if;

  select count(*) into v_recent from public.consumer_declarations
   where lower(email) = v_email and received_at > now() - interval '1 hour';

  select p.user_id, p.first_name, p.last_name, p.email, p.institution_id into v_profile
    from public.profiles p where lower(p.email) = v_email
   order by (p.role = 'institution_admin') desc, p.created_at limit 1;
  -- ohne Treffer bleiben alle Felder NULL (SELECT INTO ohne Zeile setzt NULL-Werte)
  select i.id, i.type, i.name into v_inst from public.institutions i where i.id = v_profile.institution_id;
  select s.id, s.stripe_subscription_id, s.status, s.plan, s.billing_interval, s.current_period_end, s.cancel_at_period_end into v_sub
    from public.subscriptions s
   where s.institution_id = v_profile.institution_id
     and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
   order by s.created_at desc limit 1;

  insert into public.consumer_declarations (kind, cancellation_type, name, email, contract_details, reason, user_id, institution_id, customer_type, stripe_subscription_id)
  values (
    p_kind,
    case when p_kind = 'cancellation' then coalesce(p_cancellation_type, 'ordinary') end,
    left(btrim(p_name), 200),
    v_email,
    nullif(left(btrim(coalesce(p_contract_details, '')), 500), ''),
    nullif(left(btrim(coalesce(p_reason, '')), 2000), ''),
    v_profile.user_id,
    v_inst.id,
    v_inst.type,
    v_sub.stripe_subscription_id
  )
  returning id, received_at into v_id, v_received;

  return jsonb_build_object(
    'id', v_id,
    'received_at', v_received,
    'recent_count', v_recent,
    'account', case when v_profile.user_id is null then null else jsonb_build_object(
      'user_id', v_profile.user_id, 'email', v_profile.email, 'first_name', v_profile.first_name,
      'last_name', v_profile.last_name, 'institution_id', v_inst.id, 'institution_name', v_inst.name, 'customer_type', v_inst.type) end,
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'id', v_sub.id, 'stripe_subscription_id', v_sub.stripe_subscription_id, 'status', v_sub.status, 'plan', v_sub.plan,
      'billing_interval', v_sub.billing_interval, 'current_period_end', v_sub.current_period_end,
      'cancel_at_period_end', v_sub.cancel_at_period_end) end
  );
end;
$$;

create or replace function public.consumer_declaration_update(
  p_id uuid, p_status text, p_result jsonb, p_confirmation_sent boolean, p_notified boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.consumer_declarations
     set status = coalesce(p_status, status),
         result = result || coalesce(p_result, '{}'::jsonb),
         confirmation_sent_at = case when p_confirmation_sent then coalesce(confirmation_sent_at, now()) else confirmation_sent_at end,
         notified_at = case when p_notified then coalesce(notified_at, now()) else notified_at end
   where id = p_id;
end;
$$;

/** E-Mail protokollieren; false, wenn diese Bestätigung bereits erfolgreich versendet wurde */
create or replace function public.system_mail_log(
  p_kind text, p_recipient text, p_subject text, p_related_key text, p_status text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.system_mails (kind, recipient, subject, related_key, status, error)
  values (p_kind, left(p_recipient, 320), left(p_subject, 300), left(p_related_key, 200), p_status, left(p_error, 500));
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.system_mail_was_sent(p_kind text, p_related_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.system_mails where kind = p_kind and related_key = p_related_key and status = 'sent')
$$;

/**
 * Daten für die Vertragsbestätigung nach dem Kauf (§ 312f Abs. 2 BGB): Empfänger, Tarif und die beim
 * Kauf akzeptierten Dokumente in genau der akzeptierten Version (Inhalt aus legal_documents).
 * null, wenn die Session unbekannt ist oder die Bestätigung bereits versendet wurde.
 */
create or replace function public.contract_confirmation_data(p_checkout_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub record;
  v_user uuid;
  v_profile record;
  v_inst record;
  v_docs jsonb;
begin
  if p_checkout_session_id is null or public.system_mail_was_sent('contract_confirmation', p_checkout_session_id) then
    return null;
  end if;
  select s.* into v_sub from public.subscriptions s where s.checkout_session_id = p_checkout_session_id order by s.created_at desc limit 1;
  if not found then
    return null;
  end if;
  select c.user_id into v_user from public.legal_consents c where c.checkout_session_id = p_checkout_session_id and c.user_id is not null limit 1;
  select p.user_id, p.email, p.first_name, p.last_name into v_profile
    from public.profiles p
   where (v_user is not null and p.user_id = v_user) or (v_user is null and p.institution_id = v_sub.institution_id)
   order by (p.user_id = v_user) desc nulls last, (p.role = 'institution_admin') desc
   limit 1;
  if v_profile.email is null then
    return null;
  end if;
  select i.id, i.type, i.name, i.country into v_inst from public.institutions i where i.id = v_sub.institution_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', c.document_type, 'version', c.document_version, 'audience', c.document_audience,
           'hash', c.document_hash, 'consent_type', c.consent_type, 'title', d.title,
           'checkbox_label', d.checkbox_label, 'content', d.content) order by c.accepted_at, d.type), '[]'::jsonb)
    into v_docs
    from public.legal_consents c join public.legal_documents d on d.id = c.document_id
   where c.checkout_session_id = p_checkout_session_id;
  -- Muster-Widerrufsformular (nur verlinkt, daher nicht im Protokoll) für Verbraucher beilegen
  if v_inst.type = 'private' then
    select v_docs || coalesce(jsonb_agg(jsonb_build_object('type', d.type, 'version', d.version, 'audience', d.audience, 'hash', d.content_hash,
             'consent_type', null, 'title', d.title, 'checkbox_label', null, 'content', d.content)), '[]'::jsonb)
      into v_docs
      from public.legal_documents d
     where d.type = 'withdrawal_form' and d.status = 'active' and d.audience in ('b2c', 'all');
  end if;
  return jsonb_build_object(
    'email', v_profile.email,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'customer_type', v_inst.type,
    'institution_name', v_inst.name,
    'country', v_inst.country,
    'plan', v_sub.plan,
    'billing_interval', v_sub.billing_interval,
    'status', v_sub.status,
    'current_period_start', v_sub.current_period_start,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'stripe_subscription_id', v_sub.stripe_subscription_id,
    'documents', v_docs
  );
end;
$$;

/** Checkout-Sessions der letzten p_days Tage ohne erfolgreich versendete Vertragsbestätigung (Nachversand) */
create or replace function public.contract_confirmation_pending(p_days integer default 7)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.checkout_session_id
    from public.subscriptions s
   where s.checkout_session_id is not null
     and s.status in ('active', 'trialing', 'past_due')
     and s.created_at > now() - make_interval(days => greatest(1, least(p_days, 30)))
     and not public.system_mail_was_sent('contract_confirmation', s.checkout_session_id)
   order by s.created_at
   limit 50
$$;

/** Private Jahreslizenzen, die in p_days Tagen enden und noch nicht erinnert wurden */
create or replace function public.renewal_reminder_candidates(p_days integer default 14)
returns table (subscription_id uuid, stripe_subscription_id text, email text, first_name text, current_period_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.id) s.id, s.stripe_subscription_id, p.email, p.first_name, s.current_period_end
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

create or replace function public.renewal_reminder_mark(p_subscription_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscriptions set renewal_reminder_sent_at = now() where id = p_subscription_id and renewal_reminder_sent_at is null
$$;

-- ---------------------------------------------------------------------------------------------------
-- Super-Admin: Kündigungen und Widerrufe
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_list_declarations()
returns table (
  id uuid, kind text, cancellation_type text, name text, email text, contract_details text, reason text,
  customer_type public.institution_type, institution_name text, stripe_subscription_id text, status text, result jsonb,
  confirmation_sent_at timestamptz, notified_at timestamptz, handled_at timestamptz, received_at timestamptz
)
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
    select d.id, d.kind, d.cancellation_type, d.name, d.email, d.contract_details, d.reason, d.customer_type, i.name,
           d.stripe_subscription_id, d.status, d.result, d.confirmation_sent_at, d.notified_at, d.handled_at, d.received_at
      from public.consumer_declarations d
      left join public.institutions i on i.id = d.institution_id
     order by d.received_at desc
     limit 500;
end;
$$;

create or replace function public.admin_set_declaration_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  if p_status not in ('needs_review', 'done') then
    raise exception 'Ungültiger Status.' using errcode = '22023';
  end if;
  update public.consumer_declarations
     set status = p_status,
         handled_at = case when p_status = 'done' then now() else null end,
         handled_by = case when p_status = 'done' then auth.uid() else null end
   where id = p_id;
  if not found then
    raise exception 'Erklärung nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_user_id, action, metadata)
  values (auth.uid(), 'declaration.status', jsonb_build_object('declaration_id', p_id, 'status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5) Vertragscenter: nur ohne offene Prüfhinweise veröffentlichen
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_legal_activate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.legal_documents%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  select * into d from public.legal_documents where id = p_id for update;
  if not found or d.status <> 'draft' then
    raise exception 'Nur Entwürfe können veröffentlicht werden.' using errcode = '42501';
  end if;
  if d.effective_from is not null and d.effective_from > now() then
    raise exception 'Das Datum „gültig ab“ liegt in der Zukunft. Bitte am Stichtag veröffentlichen.' using errcode = '22023';
  end if;
  if btrim(d.content) = '' and d.type::text not in ('consent_immediate_performance', 'consent_withdrawal_loss') then
    raise exception 'Der Inhalt ist leer.' using errcode = '22023';
  end if;
  if position('[Prüfhinweis' in d.content) > 0 or position('[Prüfhinweis' in coalesce(d.checkbox_label, '')) > 0 then
    raise exception 'Der Entwurf enthält noch [Prüfhinweis]-Markierungen. Bitte klären und entfernen, dann veröffentlichen.' using errcode = '22023';
  end if;
  update public.legal_documents set status = 'archived', archived_at = now()
   where type = d.type and audience = d.audience and status = 'active';
  update public.legal_documents
     set status = 'active',
         published_at = now(),
         published_by = auth.uid(),
         effective_from = coalesce(d.effective_from, now()),
         content_hash = encode(sha256(convert_to(d.title || E'\n' || coalesce(d.checkbox_label, '') || E'\n' || d.content, 'UTF8')), 'hex')
   where id = p_id;
  insert into public.audit_logs (actor_user_id, action, metadata)
  values (auth.uid(), 'legal.activated', jsonb_build_object('document_id', p_id, 'type', d.type, 'audience', d.audience, 'version', d.version));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ausführungsrechte
-- ---------------------------------------------------------------------------------------------------
revoke execute on function public.consumer_declaration_record(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.consumer_declaration_update(uuid, text, jsonb, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.system_mail_log(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.system_mail_was_sent(text, text) from public, anon, authenticated;
revoke execute on function public.contract_confirmation_data(text) from public, anon, authenticated;
revoke execute on function public.renewal_reminder_candidates(integer) from public, anon, authenticated;
revoke execute on function public.contract_confirmation_pending(integer) from public, anon, authenticated;
revoke execute on function public.renewal_reminder_mark(uuid) from public, anon, authenticated;
grant execute on function public.consumer_declaration_record(text, text, text, text, text, text) to service_role;
grant execute on function public.consumer_declaration_update(uuid, text, jsonb, boolean, boolean) to service_role;
grant execute on function public.system_mail_log(text, text, text, text, text, text) to service_role;
grant execute on function public.system_mail_was_sent(text, text) to service_role;
grant execute on function public.contract_confirmation_data(text) to service_role;
grant execute on function public.renewal_reminder_candidates(integer) to service_role;
grant execute on function public.contract_confirmation_pending(integer) to service_role;
grant execute on function public.renewal_reminder_mark(uuid) to service_role;

revoke execute on function public.admin_list_declarations() from public, anon;
revoke execute on function public.admin_set_declaration_status(uuid, text) from public, anon;
grant execute on function public.admin_list_declarations() to authenticated;
grant execute on function public.admin_set_declaration_status(uuid, text) to authenticated;
revoke execute on function public.admin_legal_activate(uuid) from public, anon;
grant execute on function public.admin_legal_activate(uuid) to authenticated;

revoke execute on function public.guard_consumer_declarations() from public, anon, authenticated;
