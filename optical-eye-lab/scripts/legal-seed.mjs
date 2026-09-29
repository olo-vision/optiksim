/**
 * Erzeugt aus docs/legal/*.md (+ manifest.json) ein SQL-Skript, das die Rechtstexte als ENTWÜRFE in das
 * Vertragscenter einfügt: supabase/seed/legal_documents_v1_0_drafts.sql
 *
 * - Es wird nichts veröffentlicht und nichts überschrieben: Existiert Typ + Zielgruppe + Version bereits
 *   (egal ob Entwurf, aktiv oder archiviert), wird der Eintrag übersprungen und gemeldet.
 * - Die erste Überschrift (# Titel) entfällt im Inhalt, weil das Vertragscenter den Titel separat anzeigt.
 *
 * Aufruf: node scripts/legal-seed.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../docs/legal/', import.meta.url);
const OUT = new URL('../supabase/seed/legal_documents_v1_0_drafts.sql', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8'));
const TYPES = new Set(['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'b2b_terms', 'consent_immediate_performance', 'consent_withdrawal_loss', 'imprint']);
const AUDIENCES = new Set(['all', 'b2c', 'b2b']);

export function bodyOf(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && /^#\s+/.test(lines[i])) lines.splice(i, 1);
  return lines.join('\n').trim() + '\n';
}

const lit = (s) => {
  if (s == null) return 'null';
  if (s.includes('$olo$')) throw new Error('Text enthält $olo$');
  return `$olo$${s}$olo$`;
};

const rows = manifest.documents.map((d) => {
  if (!TYPES.has(d.type) || !AUDIENCES.has(d.audience)) throw new Error(`Ungültig: ${d.file}`);
  const content = bodyOf(readFileSync(new URL(d.file, DIR), 'utf8'));
  return { ...d, content, sha: createHash('sha256').update(content).digest('hex').slice(0, 12) };
});

const sql = `-- =====================================================================================================
-- OLO-LAB3D – Rechtstexte Version ${manifest.version} als ENTWÜRFE (erzeugt mit: node scripts/legal-seed.mjs)
--
-- Voraussetzung: Migration 20260930090000_legal_operations.sql (Dokumenttyp „imprint“) ist eingespielt.
-- Ausführen im Supabase SQL-Editor. Es wird NICHTS veröffentlicht und NICHTS überschrieben:
-- vorhandene Versionen (Typ + Zielgruppe + Version) werden übersprungen und als Hinweis gemeldet.
-- Danach im Vertragscenter (Admin → Rechtliches) prüfen, [Prüfhinweis]-Markierungen klären/entfernen
-- und erst dann veröffentlichen. Die Veröffentlichung lehnt Entwürfe mit [Prüfhinweis] ab.
-- =====================================================================================================
do $seed$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select * from (values
${rows.map((r) => `      -- ${r.file} (${r.sha})\n      ('${r.type}', '${r.audience}', '${manifest.version}', ${lit(r.title)}, ${lit(r.checkboxLabel)}, ${lit(r.content)})`).join(',\n')}
    ) as t(type, audience, version, title, checkbox_label, content)
  loop
    if exists (select 1 from public.legal_documents d where d.type::text = r.type and d.audience::text = r.audience and d.version = r.version) then
      raise notice 'Übersprungen (existiert bereits): % / % / Version %', r.type, r.audience, r.version;
    else
      insert into public.legal_documents (type, audience, version, title, checkbox_label, content, status)
      values (r.type::public.legal_document_type, r.audience::public.legal_audience, r.version, r.title, r.checkbox_label, r.content, 'draft');
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice '% Entwürfe angelegt.', v_count;
end;
$seed$;
`;
writeFileSync(OUT, sql);
console.log(`${rows.length} Dokumente → ${OUT.pathname}`);
