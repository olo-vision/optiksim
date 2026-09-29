/**
 * Phase 8 – Frontend-Logik: Demo-Zustände, Serveruhr, Jahrespreise, Paketwahl über die Registrierung,
 * Rechtstexte (Checkbox-Beschriftung, Markdown ohne HTML, Versionsvorschlag) und der Nachbau im
 * Mock-Backend (Demo einmal je Konto, Zustimmungs-Protokoll, Vertragscenter).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessState, canStartDemo, canUseSimulator, demoRemainingMs } from '@/cloud/access';
import { _setMonotonicClock, serverNow, syncServerTime } from '@/cloud/serverClock';
import { DEMO_PLAN, formatCountdown, isB2B, planPrice, PLANS } from '@/cloud/plans';
import { intentQuery, loadIntent, parseIntent, saveIntent } from '@/cloud/intent';
import { allConsentsGiven, audienceFor, consentLabel, infoDocs, parseInline, parseMarkdown, requiredDocs, suggestNextVersion } from '@/cloud/legal';
import { MockBackend } from '@/cloud/mockBackend';
import type { CloudAccount, CloudLicense, LegalDocRef, RegistrationInput } from '@/cloud/types';

const NOW = new Date('2026-10-10T12:00:00Z');
const H = 60 * 60 * 1000;

function account(license: Partial<CloudLicense> | null, extra: Partial<CloudAccount> = {}): CloudAccount {
  return {
    userId: 'u1',
    email: 'a@b.de',
    profile: { id: 'p', userId: 'u1', institutionId: 'i', firstName: 'A', lastName: 'B', email: 'a@b.de', role: 'institution_admin', createdAt: '' },
    institution: { id: 'i', type: 'private', name: 'Privat', contactName: null, addressLine1: null, addressLine2: null, postalCode: null, city: null, country: 'DE' },
    license: license ? { id: 'l', institutionId: 'i', plan: 'private', status: 'pending', validFrom: null, validUntil: null, maxLocations: 1, source: 'stripe', gracePeriodUntil: null, ...license } : null,
    ...extra,
  } as CloudAccount;
}

const demo = (untilMs: number, status: CloudLicense['status'] = 'active') =>
  account({ source: 'demo', status, validFrom: new Date(NOW.getTime() - H).toISOString(), validUntil: new Date(NOW.getTime() + untilMs).toISOString() });

describe('Demo-Zustände', () => {
  it('läuft bis valid_until, danach „demo-ended“ – nie „active“', () => {
    expect(accessState(demo(H), NOW)).toBe('demo');
    expect(canUseSimulator('demo')).toBe(true);
    expect(accessState(demo(-1), NOW)).toBe('demo-ended');
    expect(accessState(demo(0), NOW)).toBe('demo-ended');
    expect(accessState(demo(H, 'expired'), NOW)).toBe('demo-ended');
    expect(canUseSimulator('demo-ended')).toBe(false);
  });
  it('Restzeit nur für laufende Demos', () => {
    expect(demoRemainingMs(demo(42 * 60 * 1000), NOW)).toBe(42 * 60 * 1000);
    expect(demoRemainingMs(demo(-5000), NOW)).toBe(0);
    expect(demoRemainingMs(account({ status: 'active', validUntil: new Date(NOW.getTime() + H).toISOString() }), NOW)).toBe(0);
  });
  it('Demo startbar nur einmal, nur für die Administration, nicht bei aktiver Lizenz', () => {
    const fresh = account({ status: 'pending' }, { billing: { demoUsed: false } as CloudAccount['billing'] });
    expect(canStartDemo(fresh, accessState(fresh, NOW))).toBe(true);
    const used = account({ status: 'pending' }, { billing: { demoUsed: true } as CloudAccount['billing'] });
    expect(canStartDemo(used, accessState(used, NOW))).toBe(false);
    const member = account({ status: 'pending' });
    member.profile!.role = 'user';
    expect(canStartDemo(member, 'no-license')).toBe(false);
    const paid = account({ status: 'active' });
    expect(canStartDemo(paid, accessState(paid, NOW))).toBe(false);
    expect(canStartDemo(demo(-1), 'demo-ended')).toBe(false);
  });
  it('Countdown hh:mm:ss, nie negativ', () => {
    expect(formatCountdown(2 * H)).toBe('02:00:00');
    expect(formatCountdown(H + 42 * 60000 + 17000 + 999)).toBe('01:42:17');
    expect(formatCountdown(-5)).toBe('00:00:00');
    expect(DEMO_PLAN.durationMs).toBe(2 * H);
  });
});

describe('Serveruhr', () => {
  afterEach(() => _setMonotonicClock(null));
  it('rechnet mit Serverzeit + monotoner Uhr – ein Verstellen der Systemuhr wirkt nicht', () => {
    let mono = 1000;
    _setMonotonicClock(() => mono);
    syncServerTime('2026-10-10T12:00:00Z');
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    mono += 90_000;
    expect(new Date(serverNow()).toISOString()).toBe('2026-10-10T12:01:30.000Z');
    spy.mockRestore();
  });
  it('ungültige Serverzeit wird ignoriert', () => {
    _setMonotonicClock(() => 0);
    syncServerTime('kaputt');
    syncServerTime(null);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(1000);
  });
});

describe('Preise & Kundentyp', () => {
  it('Jahrespreise 199/399/999 €, Monatspreise unverändert', () => {
    expect(PLANS.map((p) => planPrice(p, 'yearly').label)).toEqual(['199,00 €', '399,00 €', '999,00 €']);
    expect(PLANS.map((p) => p.yearlyPriceCents)).toEqual([19900, 39900, 99900]);
    expect(planPrice(PLANS[0], 'monthly').unit).toBe('/ Monat');
    expect(planPrice(PLANS[0], 'yearly').unit).toBe('/ 12 Monate');
    expect(planPrice(PLANS[1], 'yearly').unit).toBe('/ Jahr');
    expect(PLANS.map((p) => planPrice(p, 'monthly').label)).toEqual(PLANS.map((p) => p.priceLabel));
  });
  it('Privat = B2C, Betrieb/Bildung = B2B', () => {
    expect(isB2B('private')).toBe(false);
    expect(isB2B('business')).toBe(true);
    expect(isB2B('education')).toBe(true);
    expect(audienceFor('private')).toBe('b2c');
    expect(audienceFor('education')).toBe('b2b');
  });
});

describe('Paketwahl über die Registrierung', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('nur bekannte Pakete; Intervall auf monatlich/jährlich begrenzt', () => {
    expect(parseIntent('business', 'yearly')).toEqual({ plan: 'business', interval: 'yearly' });
    expect(parseIntent('business', 'weekly')).toEqual({ plan: 'business', interval: 'monthly' });
    expect(parseIntent('price_123', 'yearly')).toBeNull();
    expect(parseIntent(null)).toBeNull();
    expect(intentQuery({ plan: 'demo', interval: 'yearly' })).toBe('plan=demo');
    expect(intentQuery({ plan: 'private', interval: 'yearly' })).toBe('plan=private&interval=yearly');
  });
  it('merkt die Wahl 24 h; ohne Speicher kein Fehler', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    saveIntent({ plan: 'education', interval: 'yearly' });
    expect(loadIntent()).toEqual({ plan: 'education', interval: 'yearly' });
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * H);
    expect(loadIntent()).toBeNull();
    spy.mockRestore();
    saveIntent(null);
    expect(loadIntent()).toBeNull();
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveIntent({ plan: 'private', interval: 'monthly' })).not.toThrow();
    expect(loadIntent()).toBeNull();
  });
});

describe('Rechtstexte im Browser', () => {
  const ref = (p: Partial<LegalDocRef>): LegalDocRef => ({ id: 'd', type: 'terms', audience: 'all', version: '1.0', title: 'AGB', checkboxLabel: null, consentType: 'accepted', required: true, ...p }) as LegalDocRef;
  it('Checkbox-Text aus dem Vertragscenter, sonst neutrale Vorlage mit Link', () => {
    expect(consentLabel(ref({}))).toEqual({ before: 'Ich akzeptiere die ', linkText: 'AGB', after: '.' });
    expect(consentLabel(ref({ checkboxLabel: 'Ich stimme der {link} zu.', title: 'Datenschutzerklärung' }))).toEqual({ before: 'Ich stimme der ', linkText: 'Datenschutzerklärung', after: ' zu.' });
    expect(consentLabel(ref({ checkboxLabel: 'Eigener Einwilligungstext ohne Link' }))).toEqual({ before: 'Eigener Einwilligungstext ohne Link', linkText: null, after: '' });
  });
  it('Pflicht-Zustimmungen vs. reine Verweise', () => {
    const docs = [ref({ id: 'a' }), ref({ id: 'b', type: 'withdrawal_form', required: false })];
    expect(requiredDocs(docs).map((d) => d.id)).toEqual(['a']);
    expect(infoDocs(docs).map((d) => d.id)).toEqual(['b']);
    expect(allConsentsGiven(docs, new Set())).toBe(false);
    expect(allConsentsGiven(docs, new Set(['a']))).toBe(true);
    expect(allConsentsGiven([], new Set())).toBe(true);
  });
  it('Markdown: Überschriften, Listen, fett – HTML bleibt Text', () => {
    const b = parseMarkdown('# Titel\n\nZeile eins\nZeile zwei\n\n- a\n- **b**\n1. x\n2) y\n\n<script>alert(1)</script>');
    expect(b.map((x) => x.kind)).toEqual(['h1', 'p', 'ul', 'ol', 'p']);
    expect(b[1]).toEqual({ kind: 'p', inline: [{ text: 'Zeile eins' }, { text: '', br: true }, { text: 'Zeile zwei' }] });
    expect(b[2]).toEqual({ kind: 'ul', items: [[{ text: 'a' }], [{ text: 'b', bold: true }]] });
    expect(b[4]).toEqual({ kind: 'p', inline: [{ text: '<script>alert(1)</script>' }] });
    expect(parseInline('x **y** z')).toEqual([{ text: 'x ' }, { text: 'y', bold: true }, { text: ' z' }]);
  });
  it('Versionsvorschlag', () => {
    expect(suggestNextVersion([])).toBe('1.0');
    expect(suggestNextVersion(['1.0', '1.2', '1.10'])).toBe('1.11');
    expect(suggestNextVersion(['2', 'entwurf'])).toBe('2.1');
  });
});

/* ------------------------------ Mock-Backend ------------------------------ */

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const reg = (p: Partial<RegistrationInput> = {}): RegistrationInput => ({ firstName: 'Paula', lastName: 'Privat', email: 'paula@web.de', password: 'Geheim123', passwordConfirm: 'Geheim123', institutionType: 'private', institutionName: '', ...p });

describe('MockBackend – Demo', () => {
  it('einmal je Konto; Ende nach Ablauf; nie automatisch ein Abo', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const { user } = await b.signUp(reg());
    const r = await b.startDemo();
    expect(Date.parse(r.expiresAt) - Date.parse(r.serverNow)).toBe(2 * H);
    let a = await b.loadAccount(user!);
    expect(a.license).toMatchObject({ source: 'demo', status: 'active' });
    expect(accessState(a)).toBe('demo');
    expect(a.billing?.subscriptionStatus ?? null).toBeNull();
    await expect(b.startDemo()).rejects.toMatchObject({ code: 'OLD01' });
    hooks.setDemoRemaining('paula@web.de', -1000);
    a = await b.loadAccount(user!);
    expect(accessState(a)).toBe('demo-ended');
    expect(a.billing?.demoUsed).toBe(true);
    expect(a.billing?.subscriptionStatus ?? null).toBeNull();
    expect(a.license?.status).not.toBe('active');
    // Abmelden/Anmelden ändert nichts
    await b.signOut();
    await b.signIn('paula@web.de', 'Geheim123');
    await expect(b.startDemo()).rejects.toMatchObject({ code: 'OLD01' });
  });
  it('Kauf während der Demo übernimmt die Lizenz als Stripe-Lizenz', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const { user } = await b.signUp(reg());
    hooks.setWebhookDelay(0);
    await b.startDemo();
    await b.startCheckout('private', 'yearly');
    await new Promise((r) => setTimeout(r, 5));
    const a = await b.loadAccount(user!);
    expect(a.license).toMatchObject({ source: 'stripe', status: 'active', plan: 'private' });
    expect(a.billing?.billingInterval).toBe('yearly');
    expect(accessState(a)).toBe('active');
  });
});

describe('MockBackend – Rechtstexte & Zustimmungen', () => {
  it('B2C-Checkout verlangt alle aktiven Pflichttexte; Protokoll mit Version und Session', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    const ids = {
      terms: hooks.publishLegal('terms', 'all', '1.0'),
      privacy: hooks.publishLegal('privacy', 'all', '1.0'),
      withdrawal: hooks.publishLegal('withdrawal', 'b2c', '1.0'),
      license: hooks.publishLegal('license_terms', 'all', '1.0'),
      b2b: hooks.publishLegal('b2b_terms', 'b2b', '1.0'),
    };
    await expect(b.signUp(reg())).rejects.toMatchObject({ code: 'OLC01' });
    const { user } = await b.signUp(reg({ email: 'p2@web.de', consentDocumentIds: [ids.privacy, ids.license] }));
    const need = await b.requiredLegalDocuments('checkout', 'private');
    expect(need.filter((d) => d.required).map((d) => d.type).sort()).toEqual(['license_terms', 'privacy', 'terms', 'withdrawal']);
    expect(need.some((d) => d.type === 'b2b_terms')).toBe(false);
    await expect(b.startCheckout('private', 'monthly', [ids.terms])).rejects.toMatchObject({ code: 'OLC01' });
    // neue Version zwischen Anzeige und Kauf → veraltet
    const terms2 = hooks.publishLegal('terms', 'all', '1.1');
    await expect(b.startCheckout('private', 'monthly', [ids.terms, ids.privacy, ids.withdrawal, ids.license])).rejects.toMatchObject({ code: expect.stringMatching(/^OLC0[12]$/) });
    await b.startCheckout('private', 'monthly', [terms2, ids.privacy, ids.withdrawal, ids.license]);
    hooks.setRole('p2@web.de', 'super_admin');
    const acc = await b.loadAccount(user!);
    const log = await b.adminListConsents(acc.institution!.id);
    const checkout = log.filter((c) => c.context === 'checkout');
    expect(checkout.map((c) => `${c.documentType}@${c.documentVersion}`).sort()).toEqual(['license_terms@1.0', 'privacy@1.0', 'terms@1.1', 'withdrawal@1.0']);
    expect(new Set(checkout.map((c) => c.checkoutSessionId)).size).toBe(1);
    expect(checkout[0].checkoutSessionId).toMatch(/^cs_/);
    expect(log.filter((c) => c.context === 'registration')).toHaveLength(2);
  });
  it('Vertragscenter: nur Super-Admin; eine aktive Version je Typ/Zielgruppe; Veröffentlichtes unveränderlich', async () => {
    const b = new MockBackend(memoryStorage());
    const hooks = b.hooks();
    await b.signUp(reg());
    await expect(b.adminLegalList()).rejects.toThrow();
    hooks.setRole('paula@web.de', 'super_admin');
    const v1 = await b.adminLegalSaveDraft({ id: null, type: 'privacy', audience: 'all', version: '1.0', title: 'Datenschutz', content: 'Text', checkboxLabel: null, effectiveFrom: null });
    await b.adminLegalActivate(v1);
    await expect(b.adminLegalSaveDraft({ id: v1, type: 'privacy', audience: 'all', version: '1.0', title: 'geändert', content: 'x', checkboxLabel: null, effectiveFrom: null })).rejects.toThrow(/Entwürfe/);
    await expect(b.adminLegalSaveDraft({ id: null, type: 'privacy', audience: 'all', version: '1.0', title: 'Dup', content: 'x', checkboxLabel: null, effectiveFrom: null })).rejects.toThrow(/existiert/);
    const v2 = await b.adminLegalSaveDraft({ id: null, type: 'privacy', audience: 'all', version: '1.1', title: 'Datenschutz', content: 'Neu', checkboxLabel: null, effectiveFrom: null });
    await b.adminLegalActivate(v2);
    const list = await b.adminLegalList();
    expect(list.filter((d) => d.type === 'privacy' && d.status === 'active').map((d) => d.version)).toEqual(['1.1']);
    expect(list.find((d) => d.id === v1)?.status).toBe('archived');
    expect(await b.getLegalDocument(v1)).toMatchObject({ version: '1.0', content: 'Text' });
    const future = await b.adminLegalSaveDraft({ id: null, type: 'terms', audience: 'all', version: '1.0', title: 'AGB', content: 'x', checkboxLabel: null, effectiveFrom: new Date(Date.now() + 86400000).toISOString() });
    await expect(b.adminLegalActivate(future)).rejects.toThrow(/Zukunft/);
    const empty = await b.adminLegalSaveDraft({ id: null, type: 'terms', audience: 'all', version: '0.9', title: 'AGB', content: ' ', checkboxLabel: null, effectiveFrom: null });
    await expect(b.adminLegalActivate(empty)).rejects.toThrow(/leer/);
  });
});
