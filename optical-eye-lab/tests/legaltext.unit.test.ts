/**
 * Interne Prüfhinweise: zentrale Funktion publicLegalText() (Browser + Edge Functions) und
 * Vertragsbestätigungs-E-Mail ohne Prüfhinweise.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { countReviewMarkers, hasReviewMarkers, legalHashInput, publicLegalText } from '../supabase/functions/_shared/legalText';
import * as browserLegal from '@/cloud/legal';
import { contractConfirmationMail, type ContractData } from '../supabase/functions/_shared/mailTemplates';
import { REVIEW_CASES } from './fixtures/legalReviewCases';

describe('publicLegalText – gemeinsame Beispiele (gleiche Fälle wie die SQL-Funktion)', () => {
  for (const c of REVIEW_CASES) it(c.name, () => expect(publicLegalText(c.input)).toBe(c.expected));

  it('Browser nutzt dieselbe Umsetzung', () => {
    expect(browserLegal.publicLegalText).toBe(publicLegalText);
    expect(browserLegal.hasReviewMarkers).toBe(hasReviewMarkers);
    expect(browserLegal.countReviewMarkers).toBe(countReviewMarkers);
  });

  it('Ergebnis enthält nie eine Markierung', () => {
    for (const c of REVIEW_CASES) expect(hasReviewMarkers(publicLegalText(c.input))).toBe(false);
  });
});

describe('Prüfsumme über die kundenseitige Fassung', () => {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  it('ohne Prüfhinweis identisch zur bisherigen Bildung (bestehende Prüfsummen bleiben gültig)', () => {
    const [title, label, content] = ['AGB', 'Ich akzeptiere die {link}.', '# AGB\n\nText.\n'];
    expect(legalHashInput(title, label, content)).toBe(`${title}\n${label}\n${content}`);
    expect(legalHashInput(title, null, content)).toBe(`${title}\n\n${content}`);
  });
  it('mit Prüfhinweis: Prüfsumme = Prüfsumme des angezeigten Textes', () => {
    const shown = '# AGB\n\nText.';
    expect(sha(legalHashInput('AGB', null, '# AGB\n\n[Prüfhinweis: intern]\n\nText.'))).toBe(sha(legalHashInput('AGB', null, shown)));
  });
});

describe('Vertragsbestätigung enthält keine Prüfhinweise', () => {
  const data: ContractData = {
    email: 'kunde@web.de',
    first_name: 'Karla',
    last_name: 'Kunde',
    customer_type: 'private',
    institution_name: null,
    country: 'DE',
    plan: 'private',
    billing_interval: 'yearly',
    status: 'active',
    current_period_start: '2026-10-01T10:00:00Z',
    current_period_end: '2027-10-01T10:00:00Z',
    cancel_at_period_end: true,
    stripe_subscription_id: 'sub_123',
    documents: [
      { type: 'terms', version: '1.0', audience: 'all', hash: 'abc', consent_type: 'accepted', title: 'AGB [Prüfhinweis: Titel?]', checkbox_label: null, content: '# AGB\n\n[Prüfhinweis: intern]\n\n## 1. Geltung\n\nText [Prüfhinweis: inline].' },
      { type: 'consent_immediate_performance', version: '1.0', audience: 'b2c', hash: 'def', consent_type: 'agreed', title: 'Sofortiger Beginn', checkbox_label: 'Ich verlange ausdrücklich den sofortigen Beginn. [Prüfhinweis: Wortlaut prüfen]', content: '' },
    ],
  } as unknown as ContractData;

  it('weder im Text, in den Erklärungen noch in den Anhängen', () => {
    const m = contractConfirmationMail(data);
    expect(m.text).not.toContain('Prüfhinweis');
    expect(m.text).toContain('Ich verlange ausdrücklich den sofortigen Beginn.');
    expect(m.attachments?.length).toBeGreaterThan(0);
    for (const a of m.attachments ?? []) expect(a.content).not.toContain('Prüfhinweis');
    const agb = m.attachments!.find((a) => /geltung/i.test(a.content))!;
    expect(agb.content).toContain('Text.');
  });
});

describe('Browser-Nachbau (MockBackend): Kundenausgaben ohne Prüfhinweise, Vertragscenter mit', () => {
  it('Zustimmungstexte und Rechtstext-Seite bereinigt, Admin-Liste vollständig', async () => {
    const { MockBackend } = await import('@/cloud/mockBackend');
    const m = new Map<string, string>();
    const b = new MockBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }, { isolatedSession: true });
    const id = b.hooks().publishLegal('privacy', 'all', '1.0', 'Ich habe die {link} gelesen. [Prüfhinweis: Wortlaut]', '# Datenschutz\n\n[Prüfhinweis: intern]\n\nText.');
    const req = await b.requiredLegalDocuments('registration', 'private');
    const p = req.find((r) => r.id === id)!;
    expect(p.checkboxLabel).toBe('Ich habe die {link} gelesen.');
    const doc = await b.getLegalDocument(id);
    expect(doc!.content).toBe('# Datenschutz\n\nText.');
    await b.signUp({ firstName: 'Ada', lastName: 'Admin', email: 'ada@olo.de', password: 'Geheim123', passwordConfirm: 'Geheim123', institutionType: 'private', institutionName: '', addressLine1: '', postalCode: '', city: '', country: 'DE', consentDocumentIds: req.map((r) => r.id) } as never);
    await expect(b.adminLegalList()).rejects.toMatchObject({ code: '42501' });
    b.hooks().setRole('ada@olo.de', 'super_admin');
    const all = await b.adminLegalList();
    expect(all.find((d) => d.id === id)!.content).toContain('[Prüfhinweis: intern]');
  });
});
