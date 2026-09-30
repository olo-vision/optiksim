-- =====================================================================================================
-- OLO-LAB3D – Aufbewahrung und Löschung von Kundenkonten (Version 0.10.1)
--
-- Betreiberentscheidung (Jon, 30.09.2026):
--  • Lizenzende/Kündigung ist KEIN Löschwunsch: Konto und Inhalte bleiben bestehen, damit eine spätere
--    Neubuchung die Daten wieder vorfindet.
--  • Die 12-Monats-Frist gilt nur für ausdrücklich GESCHLOSSENE Konten (Reaktivierung möglich).
--    Danach werden Konto und Inhalte automatisch gelöscht bzw. anonymisiert – mit Erinnerungs-E-Mail
--    vorab (frühestens 14 Tage nach der Erinnerung).
--  • Endgültige Löschung durch den Kunden: sofort (Edge Function delete-account).
--  • Rechnungen (Stripe), Zustimmungs-, Kündigungs- und Widerrufsnachweise sowie der Löschnachweis folgen
--    ihren eigenen Aufbewahrungsfristen und werden hier nicht verändert.
--  • Admin-Center unterscheidet: Lizenz abgelaufen · Konto geschlossen (Löschung fällig am …) ·
--    endgültige Löschung beantragt.
--
-- Voraussetzung: 20261001090000_cloud_content_accounts.sql. Wiederholbar ausführbar. Löscht keine Daten.
-- =====================================================================================================

alter table public.profiles add column if not exists deletion_reminder_sent_at timestamptz;
-- Löschantrag (z. B. per E-Mail eingegangen), den die Administration ausführt
alter table public.profiles add column if not exists deletion_requested_at timestamptz;
alter table public.profiles add column if not exists deletion_request_note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_deletion_request_note_check') then
    alter table public.profiles add constraint profiles_deletion_request_note_check check (deletion_request_note is null or char_length(deletion_request_note) <= 500);
  end if;
end;
$$;

alter table public.deleted_accounts drop constraint if exists deleted_accounts_initiated_by_check;
alter table public.deleted_accounts add constraint deleted_accounts_initiated_by_check check (initiated_by in ('self', 'admin', 'retention'));

alter table public.system_mails drop constraint if exists system_mails_kind_check;
alter table public.system_mails add constraint system_mails_kind_check check (kind in (
  'contract_confirmation', 'cancellation_confirmation', 'withdrawal_confirmation', 'declaration_notice',
  'renewal_reminder', 'b2b_country_notice', 'account_deleted', 'account_deletion_reminder'));

/** Mindestabstand zwischen Erinnerungs-E-Mail und automatischer Löschung */
create or replace function public.retention_notice_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 14 $$;

-- ---------------------------------------------------------------------------------------------------
-- Schließen / Wiederöffnen: Erinnerungsstatus zurücksetzen
-- ---------------------------------------------------------------------------------------------------
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
         deletion_due_at = coalesce(deletion_due_at, now() + interval '12 months'),
         deletion_reminder_sent_at = case when account_status = 'closed' then deletion_reminder_sent_at else null end
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
  update public.profiles
     set account_status = 'active', closed_at = null, deletion_due_at = null, deletion_reminder_sent_at = null
   where user_id = auth.uid() and account_status = 'closed'
  returning institution_id into v_inst;
  if v_inst is not null then
    insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
    values (auth.uid(), v_inst, 'account.reopened', '{}'::jsonb);
  end if;
  return public.my_account_overview();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Endgültige Löschung (service_role) – zusätzlich Auslöser „retention“ mit Schutzprüfungen
-- ---------------------------------------------------------------------------------------------------
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
  v_by text := case when p_initiated_by in ('admin', 'retention') then p_initiated_by else 'self' end;
begin
  select p.user_id, p.institution_id, p.email, p.account_status, p.deletion_due_at, p.deletion_reminder_sent_at
    into v_profile from public.profiles p where p.user_id = p_user for update;
  if v_profile.user_id is null then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;
  -- Automatische Löschung NUR für geschlossene Konten nach Fristablauf und nach rechtzeitiger Erinnerung
  if v_by = 'retention' and not (
       v_profile.account_status = 'closed'
       and v_profile.deletion_due_at is not null and v_profile.deletion_due_at <= now()
       and v_profile.deletion_reminder_sent_at is not null
       and v_profile.deletion_reminder_sent_at <= now() - make_interval(days => public.retention_notice_days())
     ) then
    raise exception 'Das Konto ist nicht zur automatischen Löschung fällig.' using errcode = 'OLA02';
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

-- ---------------------------------------------------------------------------------------------------
-- Aufbewahrungs-Job (service_role, Edge Function mail-jobs)
-- ---------------------------------------------------------------------------------------------------
/** Geschlossene Konten, deren Löschung innerhalb von p_days bevorsteht und die noch nicht erinnert wurden */
create or replace function public.retention_reminder_candidates(p_days integer default 30)
returns table (user_id uuid, email text, first_name text, last_name text, deletion_due_at timestamptz, delete_not_before timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.email, p.first_name, p.last_name, p.deletion_due_at,
         greatest(p.deletion_due_at, now() + make_interval(days => public.retention_notice_days()))
    from public.profiles p
   where p.account_status = 'closed'
     and p.deletion_due_at is not null
     and p.deletion_reminder_sent_at is null
     and p.deletion_due_at <= now() + make_interval(days => greatest(coalesce(p_days, 30), 1))
   order by p.deletion_due_at
   limit 200
$$;

create or replace function public.retention_mark_reminded(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set deletion_reminder_sent_at = now()
   where user_id = p_user and account_status = 'closed' and deletion_reminder_sent_at is null
$$;

/** Geschlossene Konten, die jetzt automatisch gelöscht werden dürfen (Frist abgelaufen, rechtzeitig erinnert) */
create or replace function public.retention_due_accounts(p_limit integer default 20)
returns table (user_id uuid, email text, first_name text, last_name text, deletion_due_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.email, p.first_name, p.last_name, p.deletion_due_at
    from public.profiles p
   where p.account_status = 'closed'
     and p.deletion_due_at is not null and p.deletion_due_at <= now()
     and p.deletion_reminder_sent_at is not null
     and p.deletion_reminder_sent_at <= now() - make_interval(days => public.retention_notice_days())
   order by p.deletion_due_at
   limit greatest(least(coalesce(p_limit, 20), 100), 1)
$$;

-- ---------------------------------------------------------------------------------------------------
-- Admin-Center: Lebenszyklus der Konten
-- ---------------------------------------------------------------------------------------------------
/**
 * category:
 *   'deletion_requested' – endgültige Löschung beantragt (von der Administration erfasst)
 *   'closed'             – Konto geschlossen, Löschung fällig am deletion_due_at
 *   'license_ended'      – Lizenz abgelaufen/gekündigt bzw. Demo beendet; Konto aktiv, Daten bleiben
 */
create or replace function public.admin_account_lifecycle()
returns table (
  category text, user_id uuid, email text, first_name text, last_name text, institution_name text,
  license_status text, license_source text, license_valid_until timestamptz,
  closed_at timestamptz, deletion_due_at timestamptz, deletion_reminder_sent_at timestamptz,
  deletion_requested_at timestamptz, deletion_request_note text, simulations bigint, last_sign_in_at timestamptz
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
    select x.category, x.user_id, x.email, x.first_name, x.last_name, x.institution_name,
           x.license_status, x.license_source, x.license_valid_until, x.closed_at, x.deletion_due_at,
           x.deletion_reminder_sent_at, x.deletion_requested_at, x.deletion_request_note, x.simulations, x.last_sign_in_at
      from (
        select case
                 when p.deletion_requested_at is not null then 'deletion_requested'
                 when p.account_status = 'closed' then 'closed'
                 when l.status in ('expired', 'cancelled') or (l.source = 'demo' and l.valid_until is not null and l.valid_until < now()) then 'license_ended'
                 else null
               end as category,
               p.user_id, p.email, p.first_name, p.last_name, i.name as institution_name,
               l.status::text as license_status, l.source::text as license_source, l.valid_until as license_valid_until,
               p.closed_at, p.deletion_due_at, p.deletion_reminder_sent_at, p.deletion_requested_at, p.deletion_request_note,
               (select count(*) from public.user_simulations s where s.owner_user_id = p.user_id) as simulations,
               u.last_sign_in_at
          from public.profiles p
          join public.institutions i on i.id = p.institution_id
          left join lateral (
            select l2.status, l2.source, l2.valid_until from public.licenses l2
             where l2.institution_id = p.institution_id order by l2.created_at desc limit 1
          ) l on true
          left join auth.users u on u.id = p.user_id
      ) x
     where x.category is not null
     order by case x.category when 'deletion_requested' then 0 when 'closed' then 1 else 2 end,
              coalesce(x.deletion_due_at, x.license_valid_until) nulls last;
end;
$$;

/** Löschantrag erfassen (z. B. per E-Mail eingegangen, Identität geprüft) bzw. zurücknehmen */
create or replace function public.admin_set_deletion_request(p_user uuid, p_requested boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  update public.profiles
     set deletion_requested_at = case when p_requested then coalesce(deletion_requested_at, now()) else null end,
         deletion_request_note = case when p_requested then nullif(btrim(left(coalesce(p_note, ''), 500)), '') else null end
   where user_id = p_user
  returning institution_id into v_inst;
  if v_inst is null then
    raise exception 'Konto nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_inst, case when p_requested then 'account.deletion_requested' else 'account.deletion_request_cleared' end, '{}'::jsonb);
end;
$$;

/** Löschantrag über die E-Mail-Adresse des Kontos erfassen (per E-Mail eingegangene Anträge) */
create or replace function public.admin_request_deletion_by_email(p_email text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  select p.user_id into v_user from public.profiles p where lower(p.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'Zu dieser E-Mail-Adresse gibt es kein Konto.' using errcode = 'P0002';
  end if;
  perform public.admin_set_deletion_request(v_user, true, p_note);
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ausführungsrechte
-- ---------------------------------------------------------------------------------------------------
revoke execute on function public.retention_notice_days() from public, anon;
grant execute on function public.retention_notice_days() to authenticated, service_role;
revoke execute on function public.retention_reminder_candidates(integer) from public, anon, authenticated;
revoke execute on function public.retention_mark_reminded(uuid) from public, anon, authenticated;
revoke execute on function public.retention_due_accounts(integer) from public, anon, authenticated;
grant execute on function public.retention_reminder_candidates(integer) to service_role;
grant execute on function public.retention_mark_reminded(uuid) to service_role;
grant execute on function public.retention_due_accounts(integer) to service_role;
revoke execute on function public.admin_account_lifecycle() from public, anon;
grant execute on function public.admin_account_lifecycle() to authenticated;
revoke execute on function public.admin_request_deletion_by_email(text, text) from public, anon;
grant execute on function public.admin_request_deletion_by_email(text, text) to authenticated;
revoke execute on function public.admin_set_deletion_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_deletion_request(uuid, boolean, text) to authenticated;
revoke execute on function public.delete_account_data(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, text) to service_role;
