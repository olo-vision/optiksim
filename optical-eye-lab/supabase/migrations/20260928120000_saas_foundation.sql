-- =============================================================================
-- OLO-LAB3D – SaaS-Grundstruktur (Phase 6)
--
-- Institutionen, Profile, Rollen, Lizenzen, Stripe-Abos (vorbereitet), Audit-Log, Tarifkatalog.
-- Sicherheit: RLS auf allen Tabellen, keine Schreibrechte des Frontends auf Lizenzen/Abos/Rollen,
-- Registrierung ausschließlich über den Trigger auf auth.users (SECURITY DEFINER).
--
-- Idempotent genug für einen frischen Projektstand; ausführen per `supabase db push` oder im
-- SQL-Editor des Supabase-Dashboards (als Ganzes).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------
create type public.institution_type as enum ('private', 'business', 'education');
create type public.app_role as enum ('super_admin', 'institution_admin', 'user');
create type public.license_plan as enum ('private', 'business', 'education');
create type public.license_status as enum ('pending', 'active', 'past_due', 'suspended', 'expired', 'cancelled');

-- ---------------------------------------------------------------------------
-- Hilfsfunktion: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Institutionen (Privat = eigene, minimale Institution je Konto)
-- ---------------------------------------------------------------------------
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  type public.institution_type not null,
  name text not null check (char_length(name) between 1 and 200),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  address_line_1 text check (address_line_1 is null or char_length(address_line_1) <= 200),
  address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 200),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  city text check (city is null or char_length(city) <= 120),
  country text not null default 'DE' check (char_length(country) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger institutions_updated_at before update on public.institutions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile (1:1 zu auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete restrict,
  first_name text not null default '' check (char_length(first_name) <= 100),
  last_name text not null default '' check (char_length(last_name) <= 100),
  email text not null,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_institution_idx on public.profiles (institution_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lizenzen (je Institution; neue Konten: pending)
-- ---------------------------------------------------------------------------
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  plan public.license_plan not null,
  status public.license_status not null default 'pending',
  valid_from timestamptz,
  valid_until timestamptz,
  max_locations integer not null default 1 check (max_locations >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index licenses_institution_idx on public.licenses (institution_id);
create trigger licenses_updated_at before update on public.licenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Stripe-Abos (Phase 7 – Felder bis dahin leer)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  license_id uuid references public.licenses (id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text check (
    status is null or status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
  ),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_institution_idx on public.subscriptions (institution_id);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit-Log (nur serverseitig geschrieben)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  institution_id uuid references public.institutions (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_institution_idx on public.audit_logs (institution_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tarifkatalog (öffentlich lesbar; Stripe-IDs werden serverseitig verwendet)
-- ---------------------------------------------------------------------------
create table public.plan_catalog (
  plan public.license_plan primary key,
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  currency text not null default 'eur',
  location_note text,
  stripe_product_id text,
  stripe_price_id text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger plan_catalog_updated_at before update on public.plan_catalog
  for each row execute function public.set_updated_at();

insert into public.plan_catalog (plan, name, monthly_price_cents, location_note, stripe_product_id) values
  ('private',   'OLO-LAB3D Private',   1990, null,                                  'prod_VLNK15Fw8lrCKe'),
  ('business',  'OLO-LAB3D Business',  3990, 'Lizenz gilt für einen Betriebsstandort', 'prod_VLNL3vdJzSSLMC'),
  ('education', 'OLO-LAB3D Education', 9990, 'Lizenz gilt für einen Bildungsstandort',  'prod_VLNOGEDhJuqoqb');

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen für Policies (SECURITY DEFINER → keine RLS-Rekursion auf profiles)
-- ---------------------------------------------------------------------------
create or replace function public.my_institution_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.institution_id from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
$$;

create or replace function public.is_institution_admin(p_institution uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.institution_id = p_institution and p.role in ('institution_admin', 'super_admin')
  )
$$;

/** Hat der angemeldete Benutzer eine aktive, nicht abgelaufene Lizenz? (für spätere serverseitige Prüfungen) */
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
      and l.status = 'active'
      and (l.valid_from is null or l.valid_from <= now())
      and (l.valid_until is null or l.valid_until > now())
  )
$$;

-- ---------------------------------------------------------------------------
-- Schutz vor Rechteausweitung (zusätzlich zu Spaltenrechten und RLS):
-- Über die API (Rollen anon/authenticated) dürfen Rolle, Institution, user_id und E-Mail eines Profils
-- sowie Lizenzen und Abos niemals geändert werden. Serverseitige Wege (SQL-Editor, service_role,
-- SECURITY-DEFINER-Funktionen) laufen nicht unter diesen Rollen.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.role is distinct from old.role
      or new.institution_id is distinct from old.institution_id
      or new.user_id is distinct from old.user_id
      or new.email is distinct from old.email then
      raise exception 'Rolle, Institution und E-Mail können nicht über die Anwendung geändert werden.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_server_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Diese Daten werden ausschließlich serverseitig verwaltet.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger licenses_guard before insert or update or delete on public.licenses
  for each row execute function public.guard_server_only();
create trigger subscriptions_guard before insert or update or delete on public.subscriptions
  for each row execute function public.guard_server_only();
create trigger audit_logs_guard before insert or update or delete on public.audit_logs
  for each row execute function public.guard_server_only();

-- ---------------------------------------------------------------------------
-- Registrierung: Institution + Profil (institution_admin) + Lizenz (pending) + Audit
-- Metadaten kommen aus supabase.auth.signUp({ options: { data } }) und werden hier geprüft/begrenzt.
-- Rolle und Lizenzstatus werden NIE aus den Metadaten übernommen.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type public.institution_type;
  v_first text := left(btrim(coalesce(meta ->> 'first_name', '')), 100);
  v_last text := left(btrim(coalesce(meta ->> 'last_name', '')), 100);
  v_name text := left(nullif(btrim(coalesce(meta ->> 'institution_name', '')), ''), 200);
  v_inst uuid;
begin
  v_type := case meta ->> 'institution_type'
    when 'business' then 'business'::public.institution_type
    when 'education' then 'education'::public.institution_type
    else 'private'::public.institution_type
  end;
  if v_type = 'private' or v_name is null then
    v_name := coalesce(nullif(btrim(concat_ws(' ', v_first, v_last)), ''), new.email, 'Privatkonto');
    if v_type = 'private' then v_name := left('Privat – ' || v_name, 200); end if;
  end if;

  insert into public.institutions (type, name, contact_name, address_line_1, address_line_2, postal_code, city, country)
  values (
    v_type,
    v_name,
    left(nullif(btrim(coalesce(meta ->> 'contact_name', '')), ''), 200),
    left(nullif(btrim(coalesce(meta ->> 'address_line_1', '')), ''), 200),
    left(nullif(btrim(coalesce(meta ->> 'address_line_2', '')), ''), 200),
    left(nullif(btrim(coalesce(meta ->> 'postal_code', '')), ''), 20),
    left(nullif(btrim(coalesce(meta ->> 'city', '')), ''), 120),
    coalesce(left(nullif(btrim(coalesce(meta ->> 'country', '')), ''), 60), 'DE')
  )
  returning id into v_inst;

  insert into public.profiles (user_id, institution_id, first_name, last_name, email, role)
  values (new.id, v_inst, v_first, v_last, coalesce(new.email, ''), 'institution_admin');

  insert into public.licenses (institution_id, plan, status, max_locations)
  values (v_inst, v_type::text::public.license_plan, 'pending', 1);

  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (new.id, v_inst, 'account.registered', jsonb_build_object('institution_type', v_type));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Super-Admin: gesonderter, sicherer Weg (SECURITY DEFINER + Rollenprüfung)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_accounts()
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
  valid_until timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
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
           l.id, l.plan, l.status, l.valid_until,
           s.stripe_customer_id, s.stripe_subscription_id, p.created_at
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
    left join lateral (
      select * from public.licenses l2 where l2.institution_id = i.id order by l2.created_at desc limit 1
    ) l on true
    left join lateral (
      select * from public.subscriptions s2 where s2.institution_id = i.id order by s2.created_at desc limit 1
    ) s on true
    order by p.created_at desc;
end;
$$;

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
         valid_from = case when p_status = 'active' then coalesce(valid_from, now()) else valid_from end
   where id = p_license_id
  returning institution_id into v_inst;
  if v_inst is null then
    raise exception 'Lizenz nicht gefunden.';
  end if;
  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (auth.uid(), v_inst, 'license.status_changed', jsonb_build_object('license_id', p_license_id, 'status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechte: Standardrechte von Supabase (anon/authenticated) auf diesen Tabellen zurücknehmen
-- und nur das Nötige gewähren. Spaltenrechte verhindern Änderungen an Typ, Rolle, E-Mail usw.
-- ---------------------------------------------------------------------------
revoke all on table public.institutions, public.profiles, public.licenses, public.subscriptions, public.audit_logs, public.plan_catalog from anon, authenticated;

grant select on table public.institutions, public.profiles, public.licenses, public.subscriptions, public.audit_logs to authenticated;
grant update (first_name, last_name) on table public.profiles to authenticated;
grant update (name, contact_name, address_line_1, address_line_2, postal_code, city, country) on table public.institutions to authenticated;
grant select on table public.plan_catalog to anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.admin_list_accounts() from public, anon;
revoke execute on function public.admin_set_license_status(uuid, public.license_status) from public, anon;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_set_license_status(uuid, public.license_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.licenses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.plan_catalog enable row level security;

-- Institutionen: nur die eigene; ändern (Stammdaten) nur Institution-Admins
create policy institutions_select_own on public.institutions
  for select to authenticated
  using (id = public.my_institution_id());
create policy institutions_update_admin on public.institutions
  for update to authenticated
  using (public.is_institution_admin(id))
  with check (public.is_institution_admin(id));

-- Profile: das eigene; Institution-Admins sehen die Profile ihrer Institution; ändern nur das eigene (Name)
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_institution_admin(institution_id));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Lizenzen: lesen für Mitglieder der eigenen Institution; keine Schreib-Policies
create policy licenses_select_own on public.licenses
  for select to authenticated
  using (institution_id = public.my_institution_id());

-- Abos: nur Institution-Admins der eigenen Institution; keine Schreib-Policies
create policy subscriptions_select_admin on public.subscriptions
  for select to authenticated
  using (public.is_institution_admin(institution_id));

-- Audit-Log: nur Institution-Admins der eigenen Institution
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_institution_admin(institution_id));

-- Tarifkatalog: öffentlich lesbar (Preise), nur aktive Tarife
create policy plan_catalog_select_public on public.plan_catalog
  for select to anon, authenticated
  using (active);
