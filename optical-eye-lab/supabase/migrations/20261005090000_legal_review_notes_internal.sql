-- ===================================================================================================
-- OLO-LAB3D – Prüfhinweise in Rechtstexten sind ausschließlich intern
--
-- „[Prüfhinweis: …]“ darf im gespeicherten Original stehen (Vertragscenter, nur Super-Admin, zeigt alles).
-- Jede kundenseitige Ausgabe der Datenbank läuft ab jetzt über public.legal_public_text():
--   * public.legal_document()              – öffentliche Rechtstext-Seiten (auch archivierte Fassungen)
--   * public.legal_published_documents()   – Übersicht / Fußzeile (Titel)
--   * public.legal_required_documents()    – Zustimmungs-Checkboxen bei Registrierung, Demo, Kauf
--   * public.contract_confirmation_data()  – Vertragsbestätigung per E-Mail und deren Anhänge
-- Die Tabelle selbst ist für anon/authenticated weiterhin nicht lesbar (RLS ohne Policy, keine Rechte);
-- public.admin_legal_documents() (Original mit Hinweisen) bleibt Super-Admins vorbehalten.
--
-- Prüfsumme: content_hash wird ab jetzt über die KUNDENSEITIGE Fassung gebildet
-- (public.legal_customer_hash). Für Texte ohne Prüfhinweis ist das Zeichen für Zeichen dieselbe Eingabe wie
-- bisher – bestehende Prüfsummen und Zustimmungen bleiben gültig. Veröffentlichte Versionen werden NICHT
-- verändert (Trigger guard_legal_documents verbietet das ohnehin).
--
-- Dieselbe Regel in TypeScript: supabase/functions/_shared/legalText.ts (Edge Functions + Browser).
-- ===================================================================================================

/** Kundenseitige Fassung: entfernt „[Prüfhinweis …]“-Blöcke; Texte ohne Hinweis bleiben unverändert. */
create or replace function public.legal_public_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_text is null or position('[Prüfhinweis' in p_text) = 0 then p_text
    else btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              -- 1) Hinweis am Zeilenanfang samt Leerzeichen danach (eine Ebene innerer [ … ] erlaubt)
              regexp_replace(p_text, '(^|\n)[ \t]*\[Prüfhinweis(?:[^][]|\[[^][]*\])*\][ \t]*', '\1', 'g'),
              -- 2) Hinweis mitten im Satz samt Leerzeichen davor
              '[ \t]*\[Prüfhinweis(?:[^][]|\[[^][]*\])*\]', '', 'g'),
            -- 3) nicht geschlossener Hinweis: bis Zeilenende
            '[ \t]*\[Prüfhinweis[^\n]*', '', 'g'),
          '[ \t]+\n', E'\n', 'g'),
        '\n{3,}', E'\n\n', 'g'),
      E' \t\n\r')
  end
$$;

/** Prüfsumme einer Version über die kundenseitige Fassung (Titel, Checkbox-Text, Inhalt) */
create or replace function public.legal_customer_hash(p_title text, p_checkbox_label text, p_content text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(sha256(convert_to(
    public.legal_public_text(p_title) || E'\n' || coalesce(public.legal_public_text(p_checkbox_label), '') || E'\n' || public.legal_public_text(p_content),
    'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------------------------------
-- Öffentliche Ausgaben: nur die kundenseitige Fassung
-- ---------------------------------------------------------------------------------------------------
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
  select d.id, d.type, d.audience, d.version, public.legal_public_text(d.title), public.legal_public_text(d.content), d.status,
         d.effective_from, d.published_at, d.archived_at, d.content_hash
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
  select d.id, d.type, d.audience, d.version, public.legal_public_text(d.title), d.effective_from
    from public.legal_documents d
   where d.status = 'active' and (d.effective_from is null or d.effective_from <= now())
   order by d.type, d.audience
$$;

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
           d.id, d.type, d.audience, d.version, public.legal_public_text(d.title), public.legal_public_text(d.checkbox_label), d.content_hash,
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
           'hash', c.document_hash, 'consent_type', c.consent_type, 'title', public.legal_public_text(d.title),
           'checkbox_label', public.legal_public_text(d.checkbox_label), 'content', public.legal_public_text(d.content)) order by c.accepted_at, d.type), '[]'::jsonb)
    into v_docs
    from public.legal_consents c join public.legal_documents d on d.id = c.document_id
   where c.checkout_session_id = p_checkout_session_id;
  -- Muster-Widerrufsformular (nur verlinkt, daher nicht im Protokoll) für Verbraucher beilegen
  if v_inst.type = 'private' then
    select v_docs || coalesce(jsonb_agg(jsonb_build_object('type', d.type, 'version', d.version, 'audience', d.audience, 'hash', d.content_hash,
             'consent_type', null, 'title', public.legal_public_text(d.title), 'checkbox_label', null, 'content', public.legal_public_text(d.content))), '[]'::jsonb)
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

-- ---------------------------------------------------------------------------------------------------
-- Veröffentlichen: Prüfsumme über die kundenseitige Fassung; nicht nur aus Prüfhinweisen bestehend
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_legal_activate(p_id uuid, p_acknowledge_review boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.legal_documents%rowtype;
  v_markers integer;
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
  if btrim(public.legal_public_text(d.content)) = '' and d.type::text not in ('consent_immediate_performance', 'consent_withdrawal_loss') then
    raise exception 'Der Inhalt besteht nur aus Prüfhinweisen – Kunden würden ein leeres Dokument sehen.' using errcode = '22023';
  end if;
  v_markers := public.legal_review_marker_count(d.content) + public.legal_review_marker_count(d.checkbox_label);
  if v_markers > 0 and not coalesce(p_acknowledge_review, false) then
    raise exception 'Dieses Dokument enthält noch % Prüfhinweis(e). Bitte bestätigen Sie die Veröffentlichung ausdrücklich.', v_markers
      using errcode = 'OLR01';
  end if;
  update public.legal_documents set status = 'archived', archived_at = now()
   where type = d.type and audience = d.audience and status = 'active';
  update public.legal_documents
     set status = 'active',
         published_at = now(),
         published_by = auth.uid(),
         effective_from = coalesce(d.effective_from, now()),
         -- Prüfsumme über die kundenseitige Fassung (ohne interne Prüfhinweise) = das, dem Kunden zustimmen
         content_hash = public.legal_customer_hash(d.title, d.checkbox_label, d.content)
   where id = p_id;
  insert into public.audit_logs (actor_user_id, action, metadata)
  values (auth.uid(), 'legal.activated', jsonb_build_object(
    'document_id', p_id, 'type', d.type, 'audience', d.audience, 'version', d.version,
    'review_markers', v_markers, 'review_override', v_markers > 0));
end;
$$;

revoke execute on function public.legal_public_text(text) from public;
grant execute on function public.legal_public_text(text) to anon, authenticated, service_role;
revoke execute on function public.legal_customer_hash(text, text, text) from public;
grant execute on function public.legal_customer_hash(text, text, text) to service_role;
