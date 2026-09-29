-- =============================================================================
-- OLO-LAB3D – Phase 7: Stripe Payments & Subscription Management
--
-- Baut auf 20260928120000_saas_foundation.sql auf (diese Datei wird NICHT geändert).
--
-- Neu:
--   * licenses.source              'stripe' | 'manual'  – manuelle Sonderlizenzen schützt der Webhook
--   * licenses.grace_period_until  Frist nach fehlgeschlagener Zahlung (7 Tage)
--   * subscriptions.*              Plan, Kündigungs-/Enddaten, letztes Stripe-Ereignis
--   * billing_customers            genau EIN Stripe Customer je Institution (eindeutig in beide Richtungen)
--   * stripe_events                Idempotenz: jedes Stripe-Ereignis wird höchstens einmal verarbeitet
--   * apply_stripe_subscription()  einzige Stelle, an der Stripe-Daten in Abo + Lizenz geschrieben werden
--   * sync_license_for_institution() Lizenzstatus aus dem aktuellen Abo ableiten (Regeln siehe unten)
--   * expire_grace_periods()       nach Ablauf der Frist: past_due → suspended (stündlich per pg_cron, falls vorhanden)
--   * my_billing_status()          nicht-sensible Abo-Übersicht für Konto-/Lizenzseite
--   * admin_list_accounts()        erweitert; admin_set_license_status() markiert Lizenz als manuell;
--     admin_set_license_source()   Lizenz wieder an Stripe übergeben
--
-- Ausführung: `supabase db push` oder komplett im SQL-Editor. Die Datei ist wiederholbar (idempotent).
--
-- Regeln Lizenzstatus (nur für licenses.source = 'stripe'):
--   Abo active / trialing  → active   (Frist gelöscht; bei Kündigung zum Periodenende valid_until = Periodenende)
--   Abo past_due           → past_due, Frist = erste Fehlzahlung + 7 Tage; nach Fristende → suspended
--   Abo unpaid / paused    → suspended
--   Abo canceled           → cancelled (valid_until = Endzeitpunkt)
--   Abo incomplete(_expired) → Lizenz unverändert (bei neuen Konten: pending)
--   Zugriff auf den Simulator: status = active, ODER status = past_due mit noch laufender Frist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Typ license_source
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'license_source' and n.nspname = 'public'
  ) then
    create type public.license_source as enum ('stripe', 'manual');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- licenses: Quelle + Frist
-- Beim ersten Einspielen: bereits (in Phase 6 manuell) freigeschaltete Lizenzen ohne Stripe-Abo → 'manual'
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'source'
  ) then
    alter table public.licenses add column source public.license_source not null default 'stripe';
    update public.licenses l
       set source = 'manual'
     where l.status <> 'pending'
       and not exists (
         select 1 from public.subscriptions s
         where s.institution_id = l.institution_id and s.stripe_subscription_id is not null
       );
  end if;
end;
$$;

alter table public.licenses add column if not exists grace_period_until timestamptz;

-- ---------------------------------------------------------------------------
-- subscriptions: zusätzliche Felder
-- ---------------------------------------------------------------------------
alter table public.subscriptions add column if not exists plan public.license_plan;
alter table public.subscriptions add column if not exists cancel_at timestamptz;
alter table public.subscriptions add column if not exists canceled_at timestamptz;
alter table public.subscriptions add column if not exists ended_at timestamptz;
alter table public.subscriptions add column if not exists stripe_created_at timestamptz;
alter table public.subscriptions add column if not exists last_event_id text;
alter table public.subscriptions add column if not exists last_event_type text;
alter table public.subscriptions add column if not exists last_event_at timestamptz;

-- ---------------------------------------------------------------------------
-- billing_customers: genau ein Stripe Customer je Institution
-- ---------------------------------------------------------------------------
create table if not exists public.billing_customers (
  institution_id uuid primary key references public.institutions (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id like 'cus\_%'),
  created_at timestamptz not null default now()
);

-- vorhandene Customer-IDs aus Phase-6-Abos übernehmen (falls es welche gibt)
insert into public.billing_customers (institution_id, stripe_customer_id)
select distinct on (s.institution_id) s.institution_id, s.stripe_customer_id
from public.subscriptions s
where s.stripe_customer_id like 'cus\_%'
order by s.institution_id, s.created_at desc
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- stripe_events: Idempotenz des Webhooks
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key check (id like 'evt\_%'),
  type text not null,
  stripe_created_at timestamptz,
  status text not null default 'processing' check (status in ('processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 1,
  error text,
  received_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_events add column if not exists started_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Schreibschutz (wie Phase 6): über die API-Rollen niemals schreibbar
-- ---------------------------------------------------------------------------
drop trigger if exists billing_customers_guard on public.billing_customers;
create trigger billing_customers_guard before insert or update or delete on public.billing_customers
  for each row execute function public.guard_server_only();
drop trigger if exists stripe_events_guard on public.stripe_events;
create trigger stripe_events_guard before insert or update or delete on public.stripe_events
  for each row execute function public.guard_server_only();

revoke all on table public.billing_customers, public.stripe_events from public, anon, authenticated;
alter table public.billing_customers enable row level security;
alter table public.stripe_events enable row level security;
-- bewusst KEINE Policies: nur service_role (Edge Functions) und SECURITY-DEFINER-Funktionen

-- ---------------------------------------------------------------------------
-- Lizenz aus dem aktuellen Abo der Institution ableiten
-- ---------------------------------------------------------------------------
create or replace function public.sync_license_for_institution(p_institution uuid, p_reason text default 'sync')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lic public.licenses%rowtype;
  sub public.subscriptions%rowtype;
  v_status public.license_status;
  v_grace timestamptz;
  v_until timestamptz;
  v_from timestamptz;
  v_plan public.license_plan;
  v_changed boolean;
begin
  select * into lic from public.licenses
   where institution_id = p_institution
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('changed', false, 'license', null);
  end if;

  -- Sonderlizenz: Stripe ändert nichts
  if lic.source = 'manual' then
    return jsonb_build_object('changed', false, 'license_id', lic.id, 'license_status', lic.status, 'license_source', 'manual');
  end if;

  -- aktuelles Abo: laufende vor beendeten, dann das neueste
  select * into sub from public.subscriptions
   where institution_id = p_institution
   order by (status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')) desc,
            stripe_created_at desc nulls last,
            created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('changed', false, 'license_id', lic.id, 'license_status', lic.status, 'license_source', 'stripe');
  end if;

  v_status := lic.status;
  v_grace := lic.grace_period_until;
  v_from := lic.valid_from;
  v_until := lic.valid_until;
  v_plan := coalesce(sub.plan, lic.plan);

  if sub.status in ('active', 'trialing') then
    v_status := 'active';
    v_grace := null;
    v_from := coalesce(v_from, sub.current_period_start, now());
    v_until := case when sub.cancel_at_period_end or sub.cancel_at is not null
                    then coalesce(sub.cancel_at, sub.current_period_end) end;
  elsif sub.status = 'past_due' then
    v_grace := coalesce(v_grace, now() + interval '7 days');
    v_status := case when v_grace <= now() then 'suspended'::public.license_status else 'past_due'::public.license_status end;
    v_until := case when sub.cancel_at_period_end or sub.cancel_at is not null
                    then coalesce(sub.cancel_at, sub.current_period_end) end;
  elsif sub.status in ('unpaid', 'paused') then
    v_status := 'suspended';
  elsif sub.status = 'canceled' then
    v_status := 'cancelled';
    v_grace := null;
    v_until := coalesce(sub.ended_at, sub.canceled_at, now());
  end if;
  -- incomplete / incomplete_expired: Lizenz bleibt, wie sie ist

  v_changed := v_status is distinct from lic.status
    or v_grace is distinct from lic.grace_period_until
    or v_from is distinct from lic.valid_from
    or v_until is distinct from lic.valid_until
    or v_plan is distinct from lic.plan;

  if v_changed then
    update public.licenses
       set status = v_status, grace_period_until = v_grace, valid_from = v_from, valid_until = v_until, plan = v_plan
     where id = lic.id;
    if v_status is distinct from lic.status then
      insert into public.audit_logs (institution_id, action, metadata)
      values (p_institution, 'license.status_changed', jsonb_build_object(
        'license_id', lic.id, 'from', lic.status, 'to', v_status, 'source', 'stripe', 'reason', left(p_reason, 80),
        'subscription_status', sub.status));
    end if;
  end if;

  return jsonb_build_object('changed', v_changed, 'license_id', lic.id, 'license_status', v_status, 'license_source', 'stripe',
                            'grace_period_until', v_grace, 'valid_until', v_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe-Abo übernehmen (aufgerufen vom Webhook mit service_role; Daten frisch von der Stripe-API)
-- p: { event_id, event_type, customer_id, subscription_id, price_id, plan, status, current_period_start,
--      current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at, stripe_created,
--      payment_failed, metadata_institution_id }
-- Die Institution wird primär über billing_customers (serverseitig beim Checkout angelegt) bestimmt;
-- Metadaten dienen nur als Rückfall und müssen dazu passen.
-- ---------------------------------------------------------------------------
create or replace function public.apply_stripe_subscription(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer text := nullif(btrim(coalesce(p ->> 'customer_id', '')), '');
  v_sub text := nullif(btrim(coalesce(p ->> 'subscription_id', '')), '');
  v_status text := p ->> 'status';
  v_meta_inst uuid;
  v_inst uuid;
  v_plan public.license_plan;
  v_lic uuid;
  v_result jsonb;
begin
  if v_customer is null or v_sub is null then
    raise exception 'customer_id und subscription_id sind erforderlich';
  end if;
  if v_status is null or v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'Unbekannter Abo-Status: %', v_status;
  end if;
  begin
    v_meta_inst := nullif(p ->> 'metadata_institution_id', '')::uuid;
  exception when invalid_text_representation then
    v_meta_inst := null;
  end;

  select institution_id into v_inst from public.billing_customers where stripe_customer_id = v_customer;
  if v_inst is null then
    if v_meta_inst is null or not exists (select 1 from public.institutions where id = v_meta_inst) then
      raise exception 'Stripe-Kunde ist keiner Institution zugeordnet' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.billing_customers where institution_id = v_meta_inst) then
      raise exception 'Die Institution hat bereits einen anderen Stripe-Kunden' using errcode = '23505';
    end if;
    insert into public.billing_customers (institution_id, stripe_customer_id) values (v_meta_inst, v_customer);
    v_inst := v_meta_inst;
  elsif v_meta_inst is not null and v_meta_inst <> v_inst then
    raise exception 'Abo-Metadaten passen nicht zum Stripe-Kunden' using errcode = '42501';
  end if;

  if exists (select 1 from public.subscriptions where stripe_subscription_id = v_sub and institution_id <> v_inst) then
    raise exception 'Abo gehört zu einer anderen Institution' using errcode = '42501';
  end if;

  -- Fehlgeschlagene, weiterhin offene Rechnung: mindestens past_due
  if coalesce((p ->> 'payment_failed')::boolean, false) and v_status in ('active', 'trialing') then
    v_status := 'past_due';
  end if;

  v_plan := case p ->> 'plan'
    when 'private' then 'private'::public.license_plan
    when 'business' then 'business'::public.license_plan
    when 'education' then 'education'::public.license_plan
  end;

  select id into v_lic from public.licenses where institution_id = v_inst order by created_at desc limit 1;

  insert into public.subscriptions as s (
    institution_id, license_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, status,
    current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at,
    stripe_created_at, last_event_id, last_event_type, last_event_at
  ) values (
    v_inst, v_lic, v_customer, v_sub, nullif(p ->> 'price_id', ''), v_plan, v_status,
    nullif(p ->> 'current_period_start', '')::timestamptz, nullif(p ->> 'current_period_end', '')::timestamptz,
    coalesce((p ->> 'cancel_at_period_end')::boolean, false),
    nullif(p ->> 'cancel_at', '')::timestamptz, nullif(p ->> 'canceled_at', '')::timestamptz, nullif(p ->> 'ended_at', '')::timestamptz,
    nullif(p ->> 'stripe_created', '')::timestamptz, nullif(p ->> 'event_id', ''), left(nullif(p ->> 'event_type', ''), 80), now()
  )
  on conflict (stripe_subscription_id) do update set
    license_id = coalesce(s.license_id, excluded.license_id),
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_price_id = coalesce(excluded.stripe_price_id, s.stripe_price_id),
    plan = coalesce(excluded.plan, s.plan),
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancel_at = excluded.cancel_at,
    canceled_at = excluded.canceled_at,
    ended_at = excluded.ended_at,
    stripe_created_at = coalesce(excluded.stripe_created_at, s.stripe_created_at),
    last_event_id = coalesce(excluded.last_event_id, s.last_event_id),
    last_event_type = coalesce(excluded.last_event_type, s.last_event_type),
    last_event_at = now();

  v_result := public.sync_license_for_institution(v_inst, coalesce(p ->> 'event_type', 'stripe'));

  insert into public.audit_logs (institution_id, action, metadata)
  values (v_inst, 'stripe.subscription_synced', jsonb_build_object(
    'event_id', p ->> 'event_id', 'event_type', p ->> 'event_type', 'subscription_status', v_status,
    'license_status', v_result ->> 'license_status', 'license_source', v_result ->> 'license_source'));

  return v_result || jsonb_build_object('institution_id', v_inst, 'subscription_status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Frist abgelaufen → suspended (idempotent; stündlich per pg_cron, zusätzlich jederzeit aufrufbar)
-- ---------------------------------------------------------------------------
create or replace function public.expire_grace_periods()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct l.institution_id from public.licenses l
    where l.source = 'stripe' and l.status = 'past_due' and l.grace_period_until is not null and l.grace_period_until <= now()
  loop
    perform public.sync_license_for_institution(r.institution_id, 'grace_period_expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook-Idempotenz
-- ---------------------------------------------------------------------------
/** true = Ereignis jetzt verarbeiten; false = bereits verarbeitet bzw. gerade in Arbeit.
    Fehlgeschlagene und „hängengebliebene“ (> 2 min in Arbeit, z. B. Abbruch der Function) werden erneut verarbeitet. */
create or replace function public.stripe_event_begin(p_id text, p_type text, p_created timestamptz default null)
returns boolean
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
    return true;
  end if;
  select status, started_at into v_status, v_started from public.stripe_events where id = p_id for update;
  if v_status = 'failed' or (v_status = 'processing' and v_started < now() - interval '2 minutes') then
    update public.stripe_events
       set status = 'processing', attempts = attempts + 1, error = null, started_at = now()
     where id = p_id;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.stripe_event_finish(p_id text, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stripe_events
     set status = p_status, error = left(p_error, 500), processed_at = now()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Serverseitige Lizenzprüfung: aktiv ODER past_due innerhalb der Frist
-- ---------------------------------------------------------------------------
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
      and (l.status = 'active' or (l.status = 'past_due' and l.grace_period_until > now()))
      and (l.valid_from is null or l.valid_from <= now())
      and (l.valid_until is null or l.valid_until > now())
  )
$$;

-- ---------------------------------------------------------------------------
-- Abo-Übersicht für die eigene Institution (keine Stripe-IDs)
-- ---------------------------------------------------------------------------
create or replace function public.my_billing_status()
returns table (
  plan public.license_plan,
  license_status public.license_status,
  license_source public.license_source,
  valid_until timestamptz,
  grace_period_until timestamptz,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  cancel_at timestamptz,
  has_customer boolean,
  can_manage boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.plan, l.status, l.source, l.valid_until, l.grace_period_until,
         s.status, s.current_period_end,
         -- Kündigung vorgemerkt: klassisch cancel_at_period_end oder (neuere API/Portal) ein gesetztes cancel_at
         (coalesce(s.cancel_at_period_end, false) or (s.cancel_at is not null and s.status <> 'canceled')), s.cancel_at,
         bc.stripe_customer_id is not null,
         bc.stripe_customer_id is not null and public.is_institution_admin(i.id)
  from public.institutions i
  left join lateral (
    select * from public.licenses l2 where l2.institution_id = i.id order by l2.created_at desc limit 1
  ) l on true
  left join lateral (
    select * from public.subscriptions s2 where s2.institution_id = i.id
    order by (s2.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')) desc, s2.stripe_created_at desc nulls last, s2.created_at desc
    limit 1
  ) s on true
  left join public.billing_customers bc on bc.institution_id = i.id
  where i.id = public.my_institution_id()
$$;

-- ---------------------------------------------------------------------------
-- Admin: erweiterte Übersicht (Rückgabetyp ändert sich → neu anlegen)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_accounts();
create function public.admin_list_accounts()
returns table (
  institution_id uuid,
  institution_name text,
  institution_type public.institution_type,
  email text,
  first_name text,
  last_name text,
  role public.app_role,
  license_id uuid,
  license_plan public.license_plan,
  license_status public.license_status,
  license_source public.license_source,
  valid_until timestamptz,
  grace_period_until timestamptz,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  registered_at timestamptz
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
    select i.id, i.name, i.type, p.email, p.first_name, p.last_name, p.role,
           l.id, l.plan, l.status, l.source, l.valid_until, l.grace_period_until,
           s.status, coalesce(bc.stripe_customer_id, s.stripe_customer_id), s.stripe_subscription_id, s.stripe_price_id,
           s.current_period_end, (coalesce(s.cancel_at_period_end, false) or (s.cancel_at is not null and s.status <> 'canceled')), p.created_at
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
    left join lateral (
      select * from public.licenses l2 where l2.institution_id = i.id order by l2.created_at desc limit 1
    ) l on true
    left join lateral (
      select * from public.subscriptions s2 where s2.institution_id = i.id
      order by (s2.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')) desc, s2.stripe_created_at desc nulls last, s2.created_at desc
      limit 1
    ) s on true
    left join public.billing_customers bc on bc.institution_id = i.id
    order by p.created_at desc;
end;
$$;

/** Manuelle Statusänderung durch Super-Admin → Lizenz wird zur Sonderlizenz (source = manual) */
create or replace function public.admin_set_license_status(p_license_id uuid, p_status public.license_status)
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
  update public.licenses
     set status = p_status,
         source = 'manual',
         grace_period_until = null,
         valid_from = case when p_status = 'active' then coalesce(valid_from, now()) else valid_from end,
         valid_until = case when p_status = 'active' then null else valid_until end
   where id = p_license_id
  returning institution_id into v_inst;
  if v_inst is null then
    raise exception 'Lizenz nicht gefunden.';
  end if;
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_inst, 'license.status_changed', jsonb_build_object('license_id', p_license_id, 'status', p_status, 'source', 'manual'));
end;
$$;

/** Quelle umstellen; 'stripe' übernimmt sofort wieder den Status des aktuellen Stripe-Abos */
create or replace function public.admin_set_license_source(p_license_id uuid, p_source public.license_source)
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
  update public.licenses set source = p_source where id = p_license_id returning institution_id into v_inst;
  if v_inst is null then
    raise exception 'Lizenz nicht gefunden.';
  end if;
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_inst, 'license.source_changed', jsonb_build_object('license_id', p_license_id, 'source', p_source));
  if p_source = 'stripe' then
    perform public.sync_license_for_institution(v_inst, 'admin_source_stripe');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ausführungsrechte (Supabase gibt neue Funktionen standardmäßig für anon/authenticated frei!)
-- ---------------------------------------------------------------------------
revoke execute on function public.sync_license_for_institution(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_stripe_subscription(jsonb) from public, anon, authenticated;
revoke execute on function public.expire_grace_periods() from public, anon, authenticated;
revoke execute on function public.stripe_event_begin(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stripe_event_finish(text, text, text) from public, anon, authenticated;
grant execute on function public.sync_license_for_institution(uuid, text) to service_role;
grant execute on function public.apply_stripe_subscription(jsonb) to service_role;
grant execute on function public.expire_grace_periods() to service_role;
grant execute on function public.stripe_event_begin(text, text, timestamptz) to service_role;
grant execute on function public.stripe_event_finish(text, text, text) to service_role;

revoke execute on function public.my_billing_status() from public, anon;
revoke execute on function public.admin_list_accounts() from public, anon;
revoke execute on function public.admin_set_license_status(uuid, public.license_status) from public, anon;
revoke execute on function public.admin_set_license_source(uuid, public.license_source) from public, anon;
grant execute on function public.my_billing_status() to authenticated;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_set_license_status(uuid, public.license_status) to authenticated;
grant execute on function public.admin_set_license_source(uuid, public.license_source) to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron: Fristablauf stündlich prüfen (nur wenn die Erweiterung verfügbar ist;
-- sonst manuell im Dashboard unter Integrations → Cron einrichten, siehe docs/STRIPE_SUBSCRIPTIONS.md)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule('olo-expire-grace-periods', '17 * * * *', 'select public.expire_grace_periods()');
    exception when others then
      raise notice 'pg_cron konnte nicht eingerichtet werden (%). Bitte den Job manuell anlegen.', sqlerrm;
    end;
  end if;
end;
$$;
