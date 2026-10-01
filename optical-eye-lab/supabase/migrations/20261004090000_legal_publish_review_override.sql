-- ===================================================================================================
-- OLO-LAB3D – Vertragscenter: Prüfhinweise warnen, blockieren aber nicht mehr hart
--
-- Bisher lehnte public.admin_legal_activate(uuid) jeden Entwurf mit „[Prüfhinweis“ ab (SQLSTATE 22023).
-- Neu:
--   * ohne ausdrückliche Bestätigung weiterhin Ablehnung – jetzt mit eigenem Code OLR01, damit die
--     Oberfläche einen Warn-Dialog zeigen kann (nicht nur eine Fehlermeldung);
--   * mit p_acknowledge_review = true veröffentlicht ein Super-Admin bewusst trotz Prüfhinweisen;
--     das Audit-Protokoll hält Anzahl der Hinweise und die bewusste Übergehung fest.
--   * Nur Super-Admins dürfen überhaupt veröffentlichen (unverändert). Institutions-Admins und alle
--     anderen Rollen erhalten 42501 – auch mit p_acknowledge_review = true.
-- Unverändert: veröffentlichte Versionen bleiben unveränderlich (Trigger guard_legal_documents),
-- Änderungen nur als neue Version, die bisher aktive Version wird archiviert, nie überschrieben.
-- ===================================================================================================

-- alte Signatur entfernen, sonst wäre ein Aufruf mit nur p_id mehrdeutig
drop function if exists public.admin_legal_activate(uuid);

create or replace function public.legal_review_marker_count(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_text is null then 0
              else (length(p_text) - length(replace(p_text, '[Prüfhinweis', ''))) / length('[Prüfhinweis') end;
$$;

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
         content_hash = encode(sha256(convert_to(d.title || E'\n' || coalesce(d.checkbox_label, '') || E'\n' || d.content, 'UTF8')), 'hex')
   where id = p_id;
  insert into public.audit_logs (actor_user_id, action, metadata)
  values (auth.uid(), 'legal.activated', jsonb_build_object(
    'document_id', p_id, 'type', d.type, 'audience', d.audience, 'version', d.version,
    'review_markers', v_markers, 'review_override', v_markers > 0));
end;
$$;

revoke execute on function public.legal_review_marker_count(text) from public, anon;
grant execute on function public.legal_review_marker_count(text) to authenticated, service_role;
revoke execute on function public.admin_legal_activate(uuid, boolean) from public, anon;
grant execute on function public.admin_legal_activate(uuid, boolean) to authenticated;
