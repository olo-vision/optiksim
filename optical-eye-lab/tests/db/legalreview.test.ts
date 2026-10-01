/**
 * Interne Prüfhinweise gegen echtes PostgreSQL (Migration 20261005090000):
 *  - SQL-Regel public.legal_public_text() = TypeScript-Regel (gemeinsame Beispiele)
 *  - Original mit Hinweisen nur im Vertragscenter (Super-Admin); alle Kundenausgaben ohne Hinweise
 *  - Prüfsumme = Prüfsumme der kundenseitigen Fassung; ohne Hinweis identisch zur bisherigen Bildung
 *  - normale Nutzer und anon kommen an keinen internen Hinweis
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';
import { REVIEW_CASES } from '../fixtures/legalReviewCases';
import { legalHashInput, publicLegalText } from '../../supabase/functions/_shared/legalText';

let db: PGlite;
let h: ReturnType<typeof helpers>;
let admin = '';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
};

const PRIVACY = {
  title: 'Datenschutzerklärung [Prüfhinweis: Titel final?]',
  label: 'Ich habe die {link} zur Kenntnis genommen. [Prüfhinweis: Wortlaut mit Kanzlei]',
  content: '# Datenschutz\n\n## 1. Verantwortlicher\n\nOLO Vision.\n\n[Prüfhinweis: Hosting-Angaben prüfen]\n\n## 2. Zwecke\n\nVertrag [Prüfhinweis: Art. 6 lit. b?] und Support.',
};
let privacyId = '';
let licenseId = '';

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  admin = await h.register('admin@olo.de', { first_name: 'Ada', institution_type: 'private' });
  await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [admin]);
  await h.asUser(admin, async () => {
    privacyId = (await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, 'privacy', 'all', '3.0', $1, $2, $3, null) as id`, [PRIVACY.title, PRIVACY.content, PRIVACY.label]))[0].id;
    licenseId = (await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, 'license_terms', 'all', '3.0', 'Lizenzbedingungen', '# Lizenz\n\nText ohne Hinweis.\n', null, null) as id`))[0].id;
    await db.query('select public.admin_legal_activate($1, true)', [privacyId]);
    await db.query('select public.admin_legal_activate($1)', [licenseId]);
  });
}, 60000);

describe('eine Regel – SQL und TypeScript', () => {
  it('public.legal_public_text() liefert für alle Beispiele dasselbe wie publicLegalText()', async () => {
    for (const c of REVIEW_CASES) {
      const r = await h.rows<{ t: string | null }>('select public.legal_public_text($1) as t', [c.input]);
      expect(r[0].t, c.name).toBe(c.expected);
      expect(r[0].t, c.name).toBe(publicLegalText(c.input));
    }
  });

  it('Prüfsumme: ohne Hinweis wie bisher, mit Hinweis über die angezeigte Fassung', async () => {
    const old = (t: string, l: string | null, c: string) => sha(`${t}\n${l ?? ''}\n${c}`);
    const plain = (await h.asService(() => h.rows<{ x: string }>(`select public.legal_customer_hash('AGB', null, E'# AGB\\n\\nText.\\n') as x`)))[0].x;
    expect(plain).toBe(old('AGB', null, '# AGB\n\nText.\n'));
    const row = (await h.rows<{ content_hash: string }>('select content_hash from public.legal_documents where id = $1', [privacyId]))[0];
    expect(row.content_hash).toBe(sha(legalHashInput(PRIVACY.title, PRIVACY.label, PRIVACY.content)));
    expect(row.content_hash).toBe(old(publicLegalText(PRIVACY.title), publicLegalText(PRIVACY.label), publicLegalText(PRIVACY.content)));
    expect(row.content_hash).not.toBe(old(PRIVACY.title, PRIVACY.label, PRIVACY.content));
    const lic = (await h.rows<{ content_hash: string }>('select content_hash from public.legal_documents where id = $1', [licenseId]))[0];
    expect(lic.content_hash).toBe(old('Lizenzbedingungen', null, '# Lizenz\n\nText ohne Hinweis.\n'));
  });
});

describe('intern sichtbar – extern nie', () => {
  it('Original bleibt gespeichert und ist im Vertragscenter (Super-Admin) vollständig sichtbar', async () => {
    const docs = await h.asUser(admin, () => h.rows<{ id: string; title: string; checkbox_label: string; content: string }>('select id, title, checkbox_label, content from public.admin_legal_documents()'));
    const d = docs.find((x) => x.id === privacyId)!;
    expect(d).toMatchObject({ title: PRIVACY.title, checkbox_label: PRIVACY.label, content: PRIVACY.content });
  });

  it('öffentliche Rechtstext-Seite, Übersicht und Zustimmungstexte enthalten keinen Prüfhinweis (anon und angemeldet)', async () => {
    const reader = await h.register('leser@web.de', { first_name: 'Lea', institution_type: 'private', legal_consents: [privacyId, licenseId] });
    for (const who of [null, reader, admin]) {
      const page = await h.asUser(who, () => h.rows<{ title: string; content: string }>('select title, content from public.legal_document($1)', [privacyId]));
      expect(page[0].title).toBe('Datenschutzerklärung');
      expect(page[0].content).toBe('# Datenschutz\n\n## 1. Verantwortlicher\n\nOLO Vision.\n\n## 2. Zwecke\n\nVertrag und Support.');
      const list = await h.asUser(who, () => h.rows<{ title: string }>('select title from public.legal_published_documents()'));
      expect(list.every((x) => !x.title.includes('Prüfhinweis'))).toBe(true);
      for (const [ctx, t] of [['registration', 'private'], ['checkout', 'private'], ['checkout', 'business'], ['demo', 'education']]) {
        const req = await h.asUser(who, () => h.rows<{ title: string; checkbox_label: string | null }>('select title, checkbox_label from public.legal_required_documents($1, $2)', [ctx, t]));
        for (const r of req) expect(`${r.title} ${r.checkbox_label ?? ''}`).not.toContain('Prüfhinweis');
        const priv = req.find((r) => r.title === 'Datenschutzerklärung');
        if (priv) expect(priv.checkbox_label).toBe('Ich habe die {link} zur Kenntnis genommen.');
      }
    }
  });

  it('Zustimmung speichert die Prüfsumme der angezeigten Fassung', async () => {
    const u = (await h.rows<{ user_id: string }>(`select user_id from public.profiles where email = 'leser@web.de'`))[0].user_id;
    const c = await h.rows<{ document_hash: string; content_hash: string }>('select c.document_hash, d.content_hash from public.legal_consents c join public.legal_documents d on d.id = c.document_id where c.user_id = $1 and d.id = $2', [u, privacyId]);
    expect(c).toHaveLength(1);
    expect(c[0].document_hash).toBe(c[0].content_hash);
    expect(c[0].document_hash).toBe(sha(legalHashInput(PRIVACY.title, PRIVACY.label, PRIVACY.content)));
  });

  it('normale Nutzer und anon erreichen das Original nirgends', async () => {
    const plain = await h.register('nutzer@web.de', { first_name: 'Nils', institution_type: 'private', legal_consents: [privacyId, licenseId] });
    const instAdmin = await h.register('chef@optik.de', { first_name: 'Chef', institution_type: 'business', institution_name: 'Optik Chef', address_line_1: 'Weg 1', postal_code: '1', city: 'X', country: 'DE', legal_consents: [privacyId, licenseId] });
    await db.query(`update public.profiles set role = 'institution_admin' where user_id = $1`, [instAdmin]);
    for (const who of [null, plain, instAdmin]) {
      expect(await h.asUser(who, () => code(() => db.query('select * from public.admin_legal_documents()')))).not.toBeNull();
      expect(await h.asUser(who, () => code(() => db.query('select content from public.legal_documents')))).not.toBeNull();
      expect(await h.asUser(who, () => code(() => db.query(`select public.contract_confirmation_data('cs_x')`)))).not.toBeNull();
    }
  });

  it('Entwürfe sind öffentlich nicht abrufbar; ein Text nur aus Prüfhinweisen wird nicht veröffentlicht', async () => {
    const id = await h.asUser(admin, async () => (await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, 'terms', 'all', '9.0', 'AGB', '[Prüfhinweis: komplett offen]', null, null) as id`))[0].id);
    expect(await h.asUser(null, () => h.rows('select * from public.legal_document($1)', [id]))).toHaveLength(0);
    expect(await h.asUser(admin, () => code(() => db.query('select public.admin_legal_activate($1, true)', [id])))).toBe('22023');
  });

  it('veröffentlichte Versionen bleiben unverändert (Original und Prüfsumme)', async () => {
    const before = await h.rows('select title, checkbox_label, content, content_hash from public.legal_documents where id = $1', [privacyId]);
    expect(await code(() => db.query(`update public.legal_documents set content = public.legal_public_text(content) where id = $1`, [privacyId]))).toBe('42501');
    expect(await h.rows('select title, checkbox_label, content, content_hash from public.legal_documents where id = $1', [privacyId])).toEqual(before);
  });
});
