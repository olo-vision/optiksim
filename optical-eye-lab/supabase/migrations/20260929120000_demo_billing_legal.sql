-- =============================================================================
-- OLO-LAB3D – Phase 8: Demo, Jahrespreise, B2C/B2B, Rechtscenter + Zustimmungsprotokoll
--
-- Baut auf 20260928120000 (SaaS), 20260928200000 (Stripe) und 20260929090000 (Rechte) auf.
-- Keine dieser Dateien wird geändert. Diese Datei ist wiederholbar (idempotent).
--
-- Entscheidungen (an der bestehenden Architektur ausgerichtet):
--   * Kundentyp = institutions.type (private = B2C, business/education = B2B) – kein zweites Feld.
--   * Zentraler Lizenzstatus bleibt public.licenses (status/source/valid_until). Die Demo ist eine
--     Lizenz mit source = 'demo', status = 'active' und valid_until = Demo-Ende. Damit greifen alle
--     bestehenden Prüfungen (has_active_license, RLS, Frontend) ohne Sonderlogik; das Ende wird
--     serverseitig über valid_until erzwungen, nicht über den Browser.
--   * Einmaligkeit der Demo: public.demo_grants mit UNIQUE je Benutzer UND je Institution
--     (unabhängig von Browser, Gerät, Cookies, Local Storage).
--   * Abrechnungsintervall (monthly/yearly) gehört zum Stripe-Abo → subscriptions.billing_interval.
--   * Rechtstexte: public.legal_documents (versioniert, veröffentlichte Versionen unveränderlich),
--     Zustimmungen: public.legal_consents (nur Einfügen, Momentaufnahme von Version + Hash).
--     Welche Zustimmungen nötig sind, bestimmt EINE Funktion (legal_required_documents) – für
--     Oberfläche und serverseitige Prüfung gleichermaßen.
--
-- Hinweis: Der neue Enum-Wert 'demo' wird in dieser Datei nur innerhalb von PL/pgSQL-Funktionen bzw.
-- als Text verglichen (neue Enum-Werte sind erst nach dem Commit direkt verwendbar).
--
-- Fehlercodes (SQLSTATE) für die Oberfläche:
--   OLD01 Demo bereits genutzt · OLD02 bereits lizenziert · OLD03 kein berechtigtes Konto
--   OLC01 erforderliche Zustimmung fehlt · OLC02 Dokument inzwischen aktualisiert
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------
alter type public.license_source add value if not exists 'demo';

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'legal_document_type') then
    create type public.legal_document_type as enum (
      'terms',                          -- AGB
      'privacy',                        -- Datenschutzerklärung
      'withdrawal',                     -- Widerrufsbelehrung
      'withdrawal_form',                -- Muster-Widerrufsformular (nur Verlinkung)
      'license_terms',                  -- Lizenz-/Nutzungsbedingungen
      'b2b_terms',                      -- Vertragsbedingungen für Unternehmen/Bildungseinrichtungen
      'consent_immediate_performance',  -- Einwilligungstext: sofortiger Beginn der digitalen Leistung
      'consent_withdrawal_loss',        -- Einwilligungstext: Kenntnis der Auswirkung aufs Widerrufsrecht
      'other'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'legal_audience') then
    create type public.legal_audience as enum ('all', 'b2c', 'b2b');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'legal_document_status') then
    create type public.legal_document_status as enum ('draft', 'active', 'archived');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'legal_consent_context') then
    create type public.legal_consent_context as enum ('registration', 'demo', 'checkout');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'legal_consent_type') then
    create type public.legal_consent_type as enum ('accepted', 'acknowledged', 'agreed');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stammdaten B2B, Abrechnungsintervall, Jahrespreise (Anzeige)
-- ---------------------------------------------------------------------------
alter table public.institutions add column if not exists vat_id text;
alter table public.institutions add column if not exists contact_position text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'institutions_vat_id_len') then
    alter table public.institutions add constraint institutions_vat_id_len check (vat_id is null or char_length(vat_id) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'institutions_contact_position_len') then
    alter table public.institutions add constraint institutions_contact_position_len check (contact_position is null or char_length(contact_position) <= 120);
  end if;
end;
$$;

alter table public.subscriptions add column if not exists billing_interval text;
alter table public.subscriptions add column if not exists checkout_session_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_billing_interval_check') then
    alter table public.subscriptions add constraint subscriptions_billing_interval_check check (billing_interval is null or billing_interval in ('monthly', 'yearly'));
  end if;
end;
$$;
create index if not exists subscriptions_checkout_session_idx on public.subscriptions (checkout_session_id);

alter table public.plan_catalog add column if not exists yearly_price_cents integer check (yearly_price_cents is null or yearly_price_cents >= 0);
update public.plan_catalog
   set yearly_price_cents = case plan when 'private' then 19900 when 'business' then 39900 when 'education' then 99900 end
 where yearly_price_cents is null;

-- ---------------------------------------------------------------------------
-- Demo: einmal je Benutzer und je Institution
-- ---------------------------------------------------------------------------
create table if not exists public.demo_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  institution_id uuid not null unique references public.institutions (id) on delete cascade,
  license_id uuid references public.licenses (id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  converted_at timestamptz,
  constraint demo_grants_period check (expires_at > started_at)
);

-- ---------------------------------------------------------------------------
-- Rechtstexte (versioniert)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  type public.legal_document_type not null,
  audience public.legal_audience not null default 'all',
  version text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$'),
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '' check (char_length(content) <= 200000),
  -- optionaler Text der Checkbox; Platzhalter {link} wird durch den verlinkten Titel ersetzt
  checkbox_label text check (checkbox_label is null or char_length(checkbox_label) <= 1000),
  content_hash text,
  status public.legal_document_status not null default 'draft',
  effective_from timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_documents_version_unique unique (type, audience, version)
);
-- genau eine aktive Version je Dokumenttyp und Zielgruppe
create unique index if not exists legal_documents_one_active on public.legal_documents (type, audience) where status = 'active';

drop trigger if exists legal_documents_updated_at on public.legal_documents;
create trigger legal_documents_updated_at before update on public.legal_documents
  for each row execute function public.set_updated_at();

/** Veröffentlichte Versionen sind unveränderlich; nur Entwürfe dürfen bearbeitet/gelöscht werden. */
create or replace function public.guard_legal_documents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Neue Rechtstexte beginnen als Entwurf.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Veröffentlichte Rechtstexte können nicht gelöscht werden.' using errcode = '42501';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'archived' then
      raise exception 'Entwürfe werden gelöscht, nicht archiviert.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.type is distinct from old.type or new.audience is distinct from old.audience or new.version is distinct from old.version
     or new.title is distinct from old.title or new.content is distinct from old.content or new.checkbox_label is distinct from old.checkbox_label
     or new.content_hash is distinct from old.content_hash or new.effective_from is distinct from old.effective_from
     or new.published_at is distinct from old.published_at or new.created_at is distinct from old.created_at then
    raise exception 'Veröffentlichte Rechtstexte sind unveränderlich – bitte eine neue Version anlegen.' using errcode = '42501';
  end if;
  if not (old.status = 'active' and new.status = 'archived') and new.status is distinct from old.status then
    raise exception 'Unzulässiger Statuswechsel (% → %).', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists legal_documents_guard on public.legal_documents;
create trigger legal_documents_guard before insert or update or delete on public.legal_documents
  for each row execute function public.guard_legal_documents();
drop trigger if exists legal_documents_server_only on public.legal_documents;
create trigger legal_documents_server_only before insert or update or delete on public.legal_documents
  for each row execute function public.guard_server_only();

-- ---------------------------------------------------------------------------
-- Zustimmungsprotokoll (nur Einfügen)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  institution_id uuid references public.institutions (id) on delete set null,
  customer_type public.institution_type not null,
  document_id uuid not null references public.legal_documents (id) on delete restrict,
  -- Momentaufnahme des Dokuments zum Zeitpunkt der Zustimmung
  document_type public.legal_document_type not null,
  document_version text not null,
  document_audience public.legal_audience not null,
  document_hash text not null,
  consent_type public.legal_consent_type not null,
  context public.legal_consent_context not null,
  plan text check (plan is null or plan in ('private', 'business', 'education', 'demo')),
  billing_interval text check (billing_interval is null or billing_interval in ('monthly', 'yearly')),
  checkout_session_id text,
  accepted_at timestamptz not null default now()
);
create index if not exists legal_consents_user_idx on public.legal_consents (user_id, accepted_at desc);
create index if not exists legal_consents_institution_idx on public.legal_consents (institution_id, accepted_at desc);
create index if not exists legal_consents_session_idx on public.legal_consents (checkout_session_id);

/** Einträge sind unveränderlich. Einzige Ausnahme: Löschen des Benutzers/der Institution setzt den Bezug auf NULL. */
create or replace function public.guard_legal_consents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Zustimmungen können nicht gelöscht werden.' using errcode = '42501';
  end if;
  if (new.user_id is not distinct from old.user_id or new.user_id is null)
     and (new.institution_id is not distinct from old.institution_id or new.institution_id is null)
     and (to_jsonb(new) - 'user_id' - 'institution_id') = (to_jsonb(old) - 'user_id' - 'institution_id') then
    return new;
  end if;
  raise exception 'Zustimmungen sind unveränderlich.' using errcode = '42501';
end;
$$;
drop trigger if exists legal_consents_guard on public.legal_consents;
create trigger legal_consents_guard before update or delete on public.legal_consents
  for each row execute function public.guard_legal_consents();
drop trigger if exists legal_consents_server_only on public.legal_consents;
create trigger legal_consents_server_only before insert or update or delete on public.legal_consents
  for each row execute function public.guard_server_only();
drop trigger if exists demo_grants_server_only on public.demo_grants;
create trigger demo_grants_server_only before insert or update or delete on public.demo_grants
  for each row execute function public.guard_server_only();

-- ---------------------------------------------------------------------------
-- Rechte + RLS (keine Schreibrechte für API-Rollen; Zugriff über geprüfte Funktionen)
-- ---------------------------------------------------------------------------
revoke all on table public.demo_grants, public.legal_documents, public.legal_consents from public, anon, authenticated;
grant select on table public.legal_consents to authenticated;   -- eigene Zustimmungen (Policy unten)
alter table public.demo_grants enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_consents enable row level security;
drop policy if exists legal_consents_select_own on public.legal_consents;
create policy legal_consents_select_own on public.legal_consents
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Rechtstexte: Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function public.legal_audience_for(p_type public.institution_type)
returns public.legal_audience
language sql
immutable
set search_path = ''
as $$
  select case when p_type = 'private' then 'b2c'::public.legal_audience else 'b2b'::public.legal_audience end
$$;

create or replace function public.legal_consent_type_for(p_type public.legal_document_type)
returns public.legal_consent_type
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('terms', 'license_terms', 'b2b_terms') then 'accepted'::public.legal_consent_type
    when p_type in ('privacy', 'withdrawal') then 'acknowledged'::public.legal_consent_type
    when p_type in ('consent_immediate_performance', 'consent_withdrawal_loss') then 'agreed'::public.legal_consent_type
  end
$$;

/**
 * Welche Dokumente sind in welchem Kontext zu bestätigen? (EINZIGE Stelle dieser Regel)
 *   registration / demo : Datenschutz (Kenntnisnahme), Lizenz-/Nutzungsbedingungen
 *   checkout B2C        : AGB, Datenschutz, Widerrufsbelehrung, Lizenzbedingungen,
 *                         Einwilligung sofortiger Leistungsbeginn, Kenntnis Widerrufsfolgen
 *                         (+ Widerrufsformular nur als Link)
 *   checkout B2B        : AGB, B2B-Vertragsbedingungen, Datenschutz, Lizenzbedingungen
 * Nur Dokumente mit einer aktiven, bereits gültigen Version werden verlangt; eine zielgruppen-
 * spezifische Version (b2c/b2b) hat Vorrang vor einer Version für "alle".
 */
create or replace function public.legal_required_documents(p_context public.legal_consent_context, p_customer_type public.institution_type)
returns table (
  id uuid,
  type public.legal_document_type,
  audience public.legal_audience,
  version text,
  title text,
  checkbox_label text,
  content_hash text,
  consent_type public.legal_consent_type,
  required boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aud public.legal_audience := public.legal_audience_for(p_customer_type);
  v_types public.legal_document_type[];
begin
  if p_context in ('registration', 'demo') then
    v_types := array['privacy', 'license_terms']::public.legal_document_type[];
  elsif v_aud = 'b2c' then
    v_types := array['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'consent_immediate_performance', 'consent_withdrawal_loss']::public.legal_document_type[];
  else
    v_types := array['terms', 'b2b_terms', 'privacy', 'license_terms']::public.legal_document_type[];
  end if;
  return query
    select distinct on (d.type)
           d.id, d.type, d.audience, d.version, d.title, d.checkbox_label, d.content_hash,
           public.legal_consent_type_for(d.type),
           public.legal_consent_type_for(d.type) is not null,
           array_position(v_types, d.type)
      from public.legal_documents d
     where d.status = 'active'
       and d.type = any (v_types)
       and d.audience in (v_aud, 'all')
       and (d.effective_from is null or d.effective_from <= now())
     order by d.type, (d.audience = v_aud) desc;
end;
$$;

/** Prüft die übermittelten Dokument-IDs gegen die erforderlichen (ohne zu schreiben). */
create or replace function public.legal_consent_check(p_user uuid, p_context public.legal_consent_context, p_document_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.institution_type;
  v_missing jsonb := '[]'::jsonb;
  v_outdated boolean := false;
  r record;
begin
  select i.type into v_type from public.profiles p join public.institutions i on i.id = p.institution_id where p.user_id = p_user;
  if v_type is null then
    return jsonb_build_object('ok', false, 'missing', '[]'::jsonb, 'outdated', false, 'error', 'no_profile');
  end if;
  -- übermittelte IDs, die nicht (mehr) aktiv sind → Dokument wurde inzwischen aktualisiert
  if exists (select 1 from unnest(coalesce(p_document_ids, '{}')) x(id) left join public.legal_documents d on d.id = x.id where d.id is null or d.status <> 'active') then
    v_outdated := true;
  end if;
  for r in select * from public.legal_required_documents(p_context, v_type) q where q.required loop
    if r.id = any (coalesce(p_document_ids, '{}')) then
      continue;
    end if;
    -- außerhalb des Kaufs genügt eine frühere Zustimmung zu GENAU dieser Version
    if p_context <> 'checkout' and exists (select 1 from public.legal_consents c where c.user_id = p_user and c.document_id = r.id) then
      continue;
    end if;
    v_missing := v_missing || jsonb_build_object('id', r.id, 'type', r.type, 'version', r.version);
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_missing) = 0 and not v_outdated, 'missing', v_missing, 'outdated', v_outdated);
end;
$$;

/** Prüft und protokolliert Zustimmungen (intern; Aufruf nur aus geprüften Serverfunktionen). */
create or replace function public.legal_record_consents(
  p_user uuid,
  p_context public.legal_consent_context,
  p_document_ids uuid[],
  p_checkout_session_id text default null,
  p_plan text default null,
  p_billing_interval text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.legal_consent_check(p_user, p_context, p_document_ids);
  v_inst uuid;
  v_type public.institution_type;
  n integer := 0;
  r record;
begin
  if v_check ? 'error' then
    raise exception 'Kein Profil zu diesem Konto.' using errcode = 'OLD03';
  end if;
  if (v_check ->> 'outdated')::boolean then
    raise exception 'Die Rechtstexte wurden inzwischen aktualisiert. Bitte erneut bestätigen.' using errcode = 'OLC02';
  end if;
  if jsonb_array_length(v_check -> 'missing') > 0 then
    raise exception 'Bitte alle erforderlichen Zustimmungen bestätigen.' using errcode = 'OLC01';
  end if;
  select p.institution_id, i.type into v_inst, v_type from public.profiles p join public.institutions i on i.id = p.institution_id where p.user_id = p_user;
  for r in select * from public.legal_required_documents(p_context, v_type) q where q.required and q.id = any (coalesce(p_document_ids, '{}')) loop
    if p_context <> 'checkout' and exists (select 1 from public.legal_consents c where c.user_id = p_user and c.document_id = r.id) then
      continue;
    end if;
    insert into public.legal_consents (user_id, institution_id, customer_type, document_id, document_type, document_version, document_audience,
                                       document_hash, consent_type, context, plan, billing_interval, checkout_session_id)
    values (p_user, v_inst, v_type, r.id, r.type, r.version, r.audience, coalesce(r.content_hash, ''), r.consent_type, p_context,
            p_plan, p_billing_interval, p_checkout_session_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registrierung: wie bisher + B2B-Felder + Zustimmungen (serverseitig geprüft)
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
  v_ids uuid[] := '{}';
  v_item text;
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

  insert into public.institutions (type, name, contact_name, contact_position, address_line_1, address_line_2, postal_code, city, country, vat_id)
  values (
    v_type,
    v_name,
    left(nullif(btrim(coalesce(meta ->> 'contact_name', '')), ''), 200),
    case when v_type <> 'private' then left(nullif(btrim(coalesce(meta ->> 'contact_position', '')), ''), 120) end,
    left(nullif(btrim(coalesce(meta ->> 'address_line_1', '')), ''), 200),
    left(nullif(btrim(coalesce(meta ->> 'address_line_2', '')), ''), 200),
    left(nullif(btrim(coalesce(meta ->> 'postal_code', '')), ''), 20),
    left(nullif(btrim(coalesce(meta ->> 'city', '')), ''), 120),
    coalesce(left(nullif(btrim(coalesce(meta ->> 'country', '')), ''), 60), 'DE'),
    case when v_type <> 'private' then left(nullif(upper(regexp_replace(coalesce(meta ->> 'vat_id', ''), '\s', '', 'g')), ''), 30) end
  )
  returning id into v_inst;

  insert into public.profiles (user_id, institution_id, first_name, last_name, email, role)
  values (new.id, v_inst, v_first, v_last, coalesce(new.email, ''), 'institution_admin');

  insert into public.licenses (institution_id, plan, status, max_locations)
  values (v_inst, v_type::text::public.license_plan, 'pending', 1);

  insert into public.audit_logs (actor_user_id, institution_id, action, metadata)
  values (new.id, v_inst, 'account.registered', jsonb_build_object('institution_type', v_type));

  -- Zustimmungen aus der Registrierung (IDs der angezeigten Dokumentversionen) – serverseitig geprüft;
  -- fehlt eine erforderliche Zustimmung, schlägt die Registrierung fehl.
  if jsonb_typeof(meta -> 'legal_consents') = 'array' then
    for v_item in select jsonb_array_elements_text(meta -> 'legal_consents') loop
      begin
        v_ids := v_ids || v_item::uuid;
      exception when invalid_text_representation then
        null;
      end;
    end loop;
  end if;
  perform public.legal_record_consents(new.id, 'registration', v_ids);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lizenz aus dem Abo ableiten: wie Phase 7 + Demo-Übernahme beim Kauf
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
  v_source public.license_source;
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
  if lic.source::text = 'manual' then
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
    return jsonb_build_object('changed', false, 'license_id', lic.id, 'license_status', lic.status, 'license_source', lic.source::text);
  end if;

  -- Demo-Lizenz: erst ein laufendes Abo übernimmt (Kauf während oder nach der Demo)
  if lic.source::text = 'demo' and sub.status not in ('active', 'trialing', 'past_due', 'unpaid', 'paused') then
    return jsonb_build_object('changed', false, 'license_id', lic.id, 'license_status', lic.status, 'license_source', 'demo');
  end if;

  v_source := 'stripe';
  v_status := lic.status;
  v_grace := lic.grace_period_until;
  v_from := lic.valid_from;
  v_until := lic.valid_until;
  v_plan := coalesce(sub.plan, lic.plan);

  if sub.status in ('active', 'trialing') then
    v_status := 'active';
    v_grace := null;
    v_from := case when lic.source::text = 'demo' then coalesce(sub.current_period_start, now()) else coalesce(v_from, sub.current_period_start, now()) end;
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
    or v_plan is distinct from lic.plan
    or v_source is distinct from lic.source;

  if v_changed then
    update public.licenses
       set status = v_status, grace_period_until = v_grace, valid_from = v_from, valid_until = v_until, plan = v_plan, source = v_source
     where id = lic.id;
    if lic.source::text = 'demo' then
      update public.demo_grants set converted_at = coalesce(converted_at, now()), finished_at = coalesce(finished_at, least(now(), expires_at))
       where institution_id = p_institution;
    end if;
    if v_status is distinct from lic.status or lic.source::text = 'demo' then
      insert into public.audit_logs (institution_id, action, metadata)
      values (p_institution, 'license.status_changed', jsonb_build_object(
        'license_id', lic.id, 'from', lic.status, 'to', v_status, 'source', 'stripe', 'previous_source', lic.source,
        'reason', left(p_reason, 80), 'subscription_status', sub.status));
    end if;
  end if;

  return jsonb_build_object('changed', v_changed, 'license_id', lic.id, 'license_status', v_status, 'license_source', 'stripe',
                            'grace_period_until', v_grace, 'valid_until', v_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe-Abo übernehmen: wie Phase 7 + billing_interval + checkout_session_id
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
  v_interval text := case p ->> 'billing_interval' when 'monthly' then 'monthly' when 'yearly' then 'yearly' end;
  v_session text := nullif(btrim(coalesce(p ->> 'checkout_session_id', '')), '');
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
    institution_id, license_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, billing_interval, status,
    current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at,
    stripe_created_at, checkout_session_id, last_event_id, last_event_type, last_event_at
  ) values (
    v_inst, v_lic, v_customer, v_sub, nullif(p ->> 'price_id', ''), v_plan, v_interval, v_status,
    nullif(p ->> 'current_period_start', '')::timestamptz, nullif(p ->> 'current_period_end', '')::timestamptz,
    coalesce((p ->> 'cancel_at_period_end')::boolean, false),
    nullif(p ->> 'cancel_at', '')::timestamptz, nullif(p ->> 'canceled_at', '')::timestamptz, nullif(p ->> 'ended_at', '')::timestamptz,
    nullif(p ->> 'stripe_created', '')::timestamptz, v_session, nullif(p ->> 'event_id', ''), left(nullif(p ->> 'event_type', ''), 80), now()
  )
  on conflict (stripe_subscription_id) do update set
    license_id = coalesce(s.license_id, excluded.license_id),
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_price_id = coalesce(excluded.stripe_price_id, s.stripe_price_id),
    plan = coalesce(excluded.plan, s.plan),
    billing_interval = coalesce(excluded.billing_interval, s.billing_interval),
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancel_at = excluded.cancel_at,
    canceled_at = excluded.canceled_at,
    ended_at = excluded.ended_at,
    stripe_created_at = coalesce(excluded.stripe_created_at, s.stripe_created_at),
    checkout_session_id = coalesce(s.checkout_session_id, excluded.checkout_session_id),
    last_event_id = coalesce(excluded.last_event_id, s.last_event_id),
    last_event_type = coalesce(excluded.last_event_type, s.last_event_type),
    last_event_at = now();

  v_result := public.sync_license_for_institution(v_inst, coalesce(p ->> 'event_type', 'stripe'));

  insert into public.audit_logs (institution_id, action, metadata)
  values (v_inst, 'stripe.subscription_synced', jsonb_build_object(
    'event_id', p ->> 'event_id', 'event_type', p ->> 'event_type', 'subscription_status', v_status, 'billing_interval', v_interval,
    'license_status', v_result ->> 'license_status', 'license_source', v_result ->> 'license_source'));

  return v_result || jsonb_build_object('institution_id', v_inst, 'subscription_status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo starten (angemeldeter Benutzer; komplett serverseitig geprüft)
-- ---------------------------------------------------------------------------
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
    raise exception 'Bitte melde dich an.' using errcode = 'OLD03';
  end if;
  select * into v_prof from public.profiles where user_id = v_uid;
  if not found or v_prof.role not in ('institution_admin', 'super_admin') then
    raise exception 'Die Demo kann nur die Administration des Kundenkontos starten.' using errcode = 'OLD03';
  end if;
  -- gegen parallele Doppelklicks: Institution sperren
  perform 1 from public.institutions where id = v_prof.institution_id for update;
  if exists (select 1 from public.demo_grants where user_id = v_uid or institution_id = v_prof.institution_id) then
    raise exception 'Die Demo wurde für dieses Kundenkonto bereits genutzt.' using errcode = 'OLD01';
  end if;
  select * into lic from public.licenses where institution_id = v_prof.institution_id order by created_at desc limit 1 for update;
  if found and (
       (lic.status = 'active' and (lic.valid_until is null or lic.valid_until > now()))
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

/** Abgelaufene Demos abschließen (Zugriff endet bereits über valid_until; dies räumt den Status auf). */
create or replace function public.expire_demos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.licenses
     set status = 'expired'
   where source::text = 'demo' and status = 'active' and valid_until is not null and valid_until <= now();
  get diagnostics n = row_count;
  update public.demo_grants
     set finished_at = expires_at
   where finished_at is null and expires_at <= now();
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Übersicht für Konto/Lizenz (eigene Institution) – inkl. Serverzeit und serverseitiger Zugriffsprüfung
-- ---------------------------------------------------------------------------
drop function if exists public.my_billing_status();
create function public.my_billing_status()
returns table (
  plan public.license_plan,
  license_status public.license_status,
  license_source public.license_source,
  valid_until timestamptz,
  grace_period_until timestamptz,
  subscription_status text,
  billing_interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  cancel_at timestamptz,
  has_customer boolean,
  can_manage boolean,
  demo_used boolean,
  demo_started_at timestamptz,
  demo_expires_at timestamptz,
  has_access boolean,
  server_now timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.plan, l.status, l.source, l.valid_until, l.grace_period_until,
         s.status, s.billing_interval, s.current_period_end,
         (coalesce(s.cancel_at_period_end, false) or (s.cancel_at is not null and s.status <> 'canceled')), s.cancel_at,
         bc.stripe_customer_id is not null,
         bc.stripe_customer_id is not null and public.is_institution_admin(i.id),
         dg.id is not null, dg.started_at, dg.expires_at,
         public.has_active_license(),
         now()
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
  left join public.demo_grants dg on dg.institution_id = i.id
  where i.id = public.my_institution_id()
$$;

-- ---------------------------------------------------------------------------
-- Öffentliche Rechtstexte (nur veröffentlichte Versionen)
-- ---------------------------------------------------------------------------
create or replace function public.legal_document(p_id uuid)
returns table (
  id uuid, type public.legal_document_type, audience public.legal_audience, version text, title text, content text,
  status public.legal_document_status, effective_from timestamptz, published_at timestamptz, archived_at timestamptz, content_hash text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.type, d.audience, d.version, d.title, d.content, d.status, d.effective_from, d.published_at, d.archived_at, d.content_hash
    from public.legal_documents d
   where d.id = p_id and d.status <> 'draft'
$$;

create or replace function public.legal_published_documents()
returns table (id uuid, type public.legal_document_type, audience public.legal_audience, version text, title text, effective_from timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.type, d.audience, d.version, d.title, d.effective_from
    from public.legal_documents d
   where d.status = 'active' and (d.effective_from is null or d.effective_from <= now())
   order by d.type, d.audience
$$;

-- ---------------------------------------------------------------------------
-- Serverseitige Wrapper für die Edge Function create-checkout-session (nur service_role)
-- ---------------------------------------------------------------------------
create or replace function public.checkout_consent_check(p_user uuid, p_document_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.legal_consent_check(p_user, 'checkout', p_document_ids)
$$;

create or replace function public.record_checkout_consents(p_user uuid, p_document_ids uuid[], p_checkout_session_id text, p_plan text, p_billing_interval text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_checkout_session_id is null or p_checkout_session_id !~ '^cs_' then
    raise exception 'checkout_session_id fehlt';
  end if;
  return public.legal_record_consents(p_user, 'checkout', p_document_ids, p_checkout_session_id, p_plan, p_billing_interval);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: Kundenübersicht (erweitert) und Zustimmungen
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_accounts();
create function public.admin_list_accounts()
returns table (
  institution_id uuid,
  institution_name text,
  institution_type public.institution_type,
  vat_id text,
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
  billing_interval text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  demo_used boolean,
  demo_started_at timestamptz,
  demo_expires_at timestamptz,
  consent_count integer,
  last_consent_at timestamptz,
  consent_summary jsonb,
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
    select i.id, i.name, i.type, i.vat_id, p.email, p.first_name, p.last_name, p.role,
           l.id, l.plan, l.status, l.source, l.valid_until, l.grace_period_until,
           s.status, s.billing_interval, coalesce(bc.stripe_customer_id, s.stripe_customer_id), s.stripe_subscription_id, s.stripe_price_id,
           s.current_period_end, (coalesce(s.cancel_at_period_end, false) or (s.cancel_at is not null and s.status <> 'canceled')),
           dg.id is not null, dg.started_at, dg.expires_at,
           coalesce(cs.n, 0)::integer, cs.last_at, coalesce(cs.summary, '[]'::jsonb),
           p.created_at
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
    left join public.demo_grants dg on dg.institution_id = i.id
    left join lateral (
      select count(*) as n, max(c.accepted_at) as last_at,
             (select jsonb_agg(jsonb_build_object('type', x.document_type, 'version', x.document_version, 'accepted_at', x.accepted_at) order by x.document_type)
                from (select distinct on (c2.document_type) c2.document_type, c2.document_version, c2.accepted_at
                        from public.legal_consents c2 where c2.user_id = p.user_id
                       order by c2.document_type, c2.accepted_at desc) x) as summary
        from public.legal_consents c where c.user_id = p.user_id
    ) cs on true
    order by p.created_at desc;
end;
$$;

create or replace function public.admin_list_consents(p_institution uuid)
returns table (
  accepted_at timestamptz, email text, customer_type public.institution_type, document_id uuid, document_type public.legal_document_type,
  document_version text, document_audience public.legal_audience, document_hash text, consent_type public.legal_consent_type,
  context public.legal_consent_context, plan text, billing_interval text, checkout_session_id text, stripe_subscription_id text
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
    select c.accepted_at, p.email, c.customer_type, c.document_id, c.document_type, c.document_version, c.document_audience, c.document_hash,
           c.consent_type, c.context, c.plan, c.billing_interval, c.checkout_session_id, s.stripe_subscription_id
      from public.legal_consents c
      left join public.profiles p on p.user_id = c.user_id
      left join public.subscriptions s on s.checkout_session_id = c.checkout_session_id and c.checkout_session_id is not null
     where c.institution_id = p_institution
     order by c.accepted_at desc, c.document_type;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: Vertragscenter
-- ---------------------------------------------------------------------------
create or replace function public.admin_legal_documents()
returns setof public.legal_documents
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  return query select * from public.legal_documents order by type, audience, created_at desc;
end;
$$;

create or replace function public.admin_legal_save_draft(
  p_id uuid,
  p_type public.legal_document_type,
  p_audience public.legal_audience,
  p_version text,
  p_title text,
  p_content text,
  p_checkbox_label text default null,
  p_effective_from timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.legal_documents (type, audience, version, title, content, checkbox_label, effective_from, created_by)
    values (p_type, p_audience, btrim(p_version), btrim(p_title), coalesce(p_content, ''), nullif(btrim(coalesce(p_checkbox_label, '')), ''), p_effective_from, auth.uid())
    returning id into v_id;
  else
    update public.legal_documents
       set type = p_type, audience = p_audience, version = btrim(p_version), title = btrim(p_title), content = coalesce(p_content, ''),
           checkbox_label = nullif(btrim(coalesce(p_checkbox_label, '')), ''), effective_from = p_effective_from
     where id = p_id and status = 'draft'
    returning id into v_id;
    if v_id is null then
      raise exception 'Nur Entwürfe können bearbeitet werden – für Änderungen bitte eine neue Version anlegen.' using errcode = '42501';
    end if;
  end if;
  insert into public.audit_logs (actor_user_id, action, metadata)
  values (auth.uid(), 'legal.draft_saved', jsonb_build_object('document_id', v_id, 'type', p_type, 'audience', p_audience, 'version', p_version));
  return v_id;
end;
$$;

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
  if btrim(d.content) = '' and d.type not in ('consent_immediate_performance', 'consent_withdrawal_loss') then
    raise exception 'Der Inhalt ist leer.' using errcode = '22023';
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

create or replace function public.admin_legal_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  update public.legal_documents set status = 'archived', archived_at = now() where id = p_id and status = 'active';
  if not found then
    raise exception 'Nur aktive Versionen können archiviert werden.' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_user_id, action, metadata) values (auth.uid(), 'legal.archived', jsonb_build_object('document_id', p_id));
end;
$$;

create or replace function public.admin_legal_delete_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Nur für Super-Admins.' using errcode = '42501';
  end if;
  delete from public.legal_documents where id = p_id and status = 'draft';
  if not found then
    raise exception 'Nur Entwürfe können gelöscht werden.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ausführungsrechte (Supabase gibt neue Funktionen standardmäßig frei → gezielt einschränken)
-- ---------------------------------------------------------------------------
revoke execute on function public.guard_legal_documents() from public, anon, authenticated;
revoke execute on function public.guard_legal_consents() from public, anon, authenticated;
revoke execute on function public.legal_consent_check(uuid, public.legal_consent_context, uuid[]) from public, anon, authenticated;
revoke execute on function public.legal_record_consents(uuid, public.legal_consent_context, uuid[], text, text, text) from public, anon, authenticated;
revoke execute on function public.expire_demos() from public, anon, authenticated;
revoke execute on function public.checkout_consent_check(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.record_checkout_consents(uuid, uuid[], text, text, text) from public, anon, authenticated;
revoke execute on function public.sync_license_for_institution(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_stripe_subscription(jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.expire_demos() to service_role;
grant execute on function public.checkout_consent_check(uuid, uuid[]) to service_role;
grant execute on function public.record_checkout_consents(uuid, uuid[], text, text, text) to service_role;
grant execute on function public.sync_license_for_institution(uuid, text) to service_role;
grant execute on function public.apply_stripe_subscription(jsonb) to service_role;

-- öffentlich lesbar (nur veröffentlichte Rechtstexte bzw. die Liste der zu bestätigenden Dokumente)
revoke execute on function public.legal_required_documents(public.legal_consent_context, public.institution_type) from public;
revoke execute on function public.legal_document(uuid) from public;
revoke execute on function public.legal_published_documents() from public;
revoke execute on function public.legal_audience_for(public.institution_type) from public;
revoke execute on function public.legal_consent_type_for(public.legal_document_type) from public;
grant execute on function public.legal_required_documents(public.legal_consent_context, public.institution_type) to anon, authenticated, service_role;
grant execute on function public.legal_document(uuid) to anon, authenticated, service_role;
grant execute on function public.legal_published_documents() to anon, authenticated, service_role;
grant execute on function public.legal_audience_for(public.institution_type) to anon, authenticated, service_role;
grant execute on function public.legal_consent_type_for(public.legal_document_type) to anon, authenticated, service_role;

-- angemeldete Benutzer (Prüfung in der Funktion)
revoke execute on function public.start_demo(uuid[]) from public, anon;
revoke execute on function public.my_billing_status() from public, anon;
grant execute on function public.start_demo(uuid[]) to authenticated;
grant execute on function public.my_billing_status() to authenticated;

-- Super-Admin (Prüfung in der Funktion)
revoke execute on function public.admin_list_accounts() from public, anon;
revoke execute on function public.admin_list_consents(uuid) from public, anon;
revoke execute on function public.admin_legal_documents() from public, anon;
revoke execute on function public.admin_legal_save_draft(uuid, public.legal_document_type, public.legal_audience, text, text, text, text, timestamptz) from public, anon;
revoke execute on function public.admin_legal_activate(uuid) from public, anon;
revoke execute on function public.admin_legal_archive(uuid) from public, anon;
revoke execute on function public.admin_legal_delete_draft(uuid) from public, anon;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_list_consents(uuid) to authenticated;
grant execute on function public.admin_legal_documents() to authenticated;
grant execute on function public.admin_legal_save_draft(uuid, public.legal_document_type, public.legal_audience, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_legal_activate(uuid) to authenticated;
grant execute on function public.admin_legal_archive(uuid) to authenticated;
grant execute on function public.admin_legal_delete_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron: abgelaufene Demos alle 5 Minuten abschließen (falls verfügbar)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule('olo-expire-demos', '*/5 * * * *', 'select public.expire_demos()');
    exception when others then
      raise notice 'pg_cron konnte nicht eingerichtet werden (%). Bitte den Job manuell anlegen.', sqlerrm;
    end;
  end if;
end;
$$;
