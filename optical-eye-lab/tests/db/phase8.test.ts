/// <reference types="node" />
/**
 * Phase 8 – Demo, Jahresabos, B2C/B2B, Rechtscenter und Zustimmungsprotokoll gegen echtes PostgreSQL.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: PGlite;
let h: ReturnType<typeof helpers>;
let admin = '';
const docs: Record<string, string> = {};

/** SQLSTATE eines fehlschlagenden Aufrufs */
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};

async function publish(key: string, type: string, audience: string, version: string, extra: { label?: string; content?: string } = {}) {
  const id = await h.asUser(admin, async () => {
    const r = await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, $1, $2, $3, $4, $5, $6, null) as id`, [type, audience, version, `${type} ${version}`, extra.content ?? `Inhalt ${type} ${version}`, extra.label ?? null]);
    await db.query('select public.admin_legal_activate($1)', [r[0].id]);
    return r[0].id;
  });
  docs[key] = id;
  return id;
}

const required = (context: string, type: string, uid: string | null = null) =>
  h.asUser(uid, () => h.rows<{ id: string; type: string; version: string; required: boolean; consent_type: string | null }>(`select id, type, version, required, consent_type from public.legal_required_documents($1, $2) order by sort_order`, [context, type]));

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  admin = await h.register('admin@olo.de', { first_name: 'Ada', institution_type: 'private' });
  await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [admin]);
}, 60000);

describe('Rechtscenter: Versionierung', () => {
  it('ohne veröffentlichte Dokumente wird nichts verlangt (Registrierung bleibt möglich)', async () => {
    expect(await required('registration', 'private')).toEqual([]);
    const u = await h.register('frueh@privat.de', { first_name: 'Fritz', institution_type: 'private' });
    expect(u).toBeTruthy();
  });

  it('Entwurf → aktiv; genau eine aktive Version je Typ und Zielgruppe; alte Version bleibt archiviert erhalten', async () => {
    await publish('privacy1', 'privacy', 'all', '1.0');
    await publish('license1', 'license_terms', 'all', '1.0');
    await publish('terms_b2c', 'terms', 'b2c', '1.0');
    await publish('terms_all', 'terms', 'all', '1.0');
    await publish('b2b', 'b2b_terms', 'b2b', '1.0');
    await publish('withdrawal', 'withdrawal', 'b2c', '1.0');
    await publish('form', 'withdrawal_form', 'b2c', '1.0');
    await publish('c1', 'consent_immediate_performance', 'b2c', '1.0', { label: 'Ich stimme zu (Platzhalter)' });
    await publish('c2', 'consent_withdrawal_loss', 'b2c', '1.0', { label: 'Mir ist bekannt (Platzhalter)' });
    const privacy11 = await publish('privacy11', 'privacy', 'all', '1.1');
    const rows = await h.rows<{ version: string; status: string; content_hash: string }>(`select version, status, content_hash from public.legal_documents where type = 'privacy' order by version`);
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      ['1.0', 'archived'],
      ['1.1', 'active'],
    ]);
    expect(rows[1].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.rows('select * from public.legal_document($1)', [privacy11]))[0]).toMatchObject({ version: '1.1', status: 'active' });
    // archivierte Version bleibt abrufbar (Nachweis), Entwürfe nicht
    expect(await h.rows('select * from public.legal_document($1)', [docs.privacy1])).toHaveLength(1);
  });

  it('veröffentlichte Versionen sind unveränderlich, nicht löschbar; gleiche Versionsnummer nicht doppelt', async () => {
    expect(await code(() => db.query(`update public.legal_documents set content = 'geändert' where id = $1`, [docs.privacy11]))).toBe('42501');
    expect(await code(() => db.query(`update public.legal_documents set status = 'draft' where id = $1`, [docs.privacy11]))).toBe('42501');
    expect(await code(() => db.query(`delete from public.legal_documents where id = $1`, [docs.privacy1]))).toBe('42501');
    expect(await code(() => h.asUser(admin, () => db.query(`select public.admin_legal_save_draft($1, 'privacy', 'all', '1.1', 'x', 'y', null, null)`, [docs.privacy11])))).toBe('42501');
    expect(await code(() => h.asUser(admin, () => db.query(`select public.admin_legal_save_draft(null, 'privacy', 'all', '1.1', 'x', 'y', null, null)`)))).toBe('23505');
  });

  it('Entwürfe sind bearbeitbar/löschbar und nicht öffentlich sichtbar; Zukunftsdatum wird nicht aktiviert', async () => {
    const id = await h.asUser(admin, async () => (await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, 'terms', 'b2b', '2.0-entwurf', 'AGB B2B', 'Text', null, now() + interval '3 days') as id`))[0].id);
    expect(await h.rows('select * from public.legal_document($1)', [id])).toHaveLength(0);
    expect(await code(() => h.asUser(admin, () => db.query('select public.admin_legal_activate($1)', [id])))).toBe('22023');
    await h.asUser(admin, () => db.query(`select public.admin_legal_save_draft($1, 'terms', 'b2b', '2.0-entwurf', 'AGB B2B', 'Text neu', null, null)`, [id]));
    await h.asUser(admin, () => db.query(`select public.admin_legal_delete_draft($1)`, [id]));
    expect(await h.rows('select 1 from public.legal_documents where id = $1', [id])).toHaveLength(0);
  });

  it('nur Super-Admins verwalten Rechtstexte; Frontend kann Tabellen nicht direkt schreiben', async () => {
    const user = await h.register('normal@privat.de', { first_name: 'N', institution_type: 'private', legal_consents: [docs.privacy11, docs.license1] });
    await h.asUser(user, async () => {
      expect(await h.fails('select * from public.admin_legal_documents()')).toBe(true);
      expect(await h.fails(`select public.admin_legal_save_draft(null, 'terms', 'all', '9.9', 'x', 'y', null, null)`)).toBe(true);
      expect(await h.fails(`select public.admin_legal_activate($1)`, [docs.privacy11])).toBe(true);
      expect(await h.fails('select * from public.legal_documents')).toBe(true);
      expect(await h.fails(`insert into public.legal_consents (customer_type, document_id, document_type, document_version, document_audience, document_hash, consent_type, context) values ('private', $1, 'privacy', '1.1', 'all', 'x', 'acknowledged', 'registration')`, [docs.privacy11])).toBe(true);
    });
    await h.asUser(null, async () => {
      expect(await h.fails('select * from public.admin_legal_documents()')).toBe(true);
      // öffentliche Liste der aktiven Dokumente ist lesbar
      expect((await h.rows('select * from public.legal_published_documents()')).length).toBeGreaterThan(5);
    });
  });

  it('erforderliche Dokumente je Kontext und Zielgruppe (spezifisch vor „alle“)', async () => {
    expect((await required('registration', 'business')).map((d) => d.type)).toEqual(['privacy', 'license_terms']);
    const b2c = await required('checkout', 'private');
    expect(b2c.map((d) => d.type)).toEqual(['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'consent_immediate_performance', 'consent_withdrawal_loss']);
    expect(b2c.find((d) => d.type === 'terms')!.id).toBe(docs.terms_b2c);
    expect(b2c.find((d) => d.type === 'withdrawal_form')).toMatchObject({ required: false, consent_type: null });
    expect(b2c.find((d) => d.type === 'privacy')).toMatchObject({ id: docs.privacy11, consent_type: 'acknowledged' });
    const b2b = await required('checkout', 'education');
    expect(b2b.map((d) => d.type)).toEqual(['terms', 'b2b_terms', 'privacy', 'license_terms']);
    expect(b2b.find((d) => d.type === 'terms')!.id).toBe(docs.terms_all);
  });
});

describe('Zustimmungen bei der Registrierung', () => {
  it('fehlende Zustimmung → Registrierung schlägt serverseitig fehl', async () => {
    expect(await code(() => h.register('ohne@privat.de', { first_name: 'O', institution_type: 'private' }))).toBe('OLC01');
    expect(await code(() => h.register('halb@privat.de', { first_name: 'H', institution_type: 'private', legal_consents: [docs.privacy11] }))).toBe('OLC01');
    // veraltete Version (Seite wurde vor der Aktualisierung geladen)
    expect(await code(() => h.register('alt@privat.de', { first_name: 'A', institution_type: 'private', legal_consents: [docs.privacy1, docs.license1] }))).toBe('OLC02');
    expect(await h.rows(`select 1 from auth.users where email in ('ohne@privat.de','halb@privat.de','alt@privat.de')`)).toHaveLength(0);
  });

  it('mit Zustimmung: protokolliert mit Version, Hash, Kontext – B2B-Stammdaten gespeichert', async () => {
    const u = await h.register('firma@optik.de', {
      first_name: 'Frida',
      last_name: 'Firma',
      institution_type: 'business',
      institution_name: 'Optik Firma GmbH',
      contact_position: 'Inhaberin',
      address_line_1: 'Hauptstr. 1',
      postal_code: '10115',
      city: 'Berlin',
      country: 'DE',
      vat_id: 'de 123 456 789',
      legal_consents: [docs.privacy11, docs.license1, 'keine-uuid'],
    });
    const inst = (await h.rows<Obj>('select i.* from public.institutions i join public.profiles p on p.institution_id = i.id where p.user_id = $1', [u]))[0];
    expect(inst).toMatchObject({ type: 'business', vat_id: 'DE123456789', contact_position: 'Inhaberin', address_line_1: 'Hauptstr. 1' });
    const c = await h.rows<Obj>('select document_type, document_version, document_audience, consent_type, context, customer_type, document_hash from public.legal_consents where user_id = $1 order by document_type', [u]);
    // Sortierung nach Enum-Reihenfolge (privacy vor license_terms)
    expect(c.map((x) => [x.document_type, x.document_version, x.consent_type, x.context, x.customer_type])).toEqual([
      ['privacy', '1.1', 'acknowledged', 'registration', 'business'],
      ['license_terms', '1.0', 'accepted', 'registration', 'business'],
    ]);
    expect(c[0].document_hash).toMatch(/^[0-9a-f]{64}$/);
    // eigene Zustimmungen lesbar, fremde nicht
    await h.asUser(u, async () => expect(await h.rows('select * from public.legal_consents')).toHaveLength(2));
    await h.asUser(admin, async () => expect(await h.rows('select * from public.legal_consents')).toHaveLength(0));
  });

  it('Zustimmungen sind unveränderlich (auch nicht per SQL ohne Rechte-Umgehung)', async () => {
    const id = (await h.rows<{ id: string }>(`select id from public.legal_consents limit 1`))[0].id;
    expect(await code(() => db.query(`update public.legal_consents set document_version = '9.9' where id = $1`, [id]))).toBe('42501');
    expect(await code(() => db.query(`delete from public.legal_consents where id = $1`, [id]))).toBe('42501');
  });

  it('neue Dokumentversion ändert die historische Zustimmung nicht', async () => {
    await publish('license2', 'license_terms', 'all', '2.0');
    const c = await h.rows<Obj>(`select document_id, document_version from public.legal_consents where document_type = 'license_terms' order by accepted_at`);
    expect(c.every((x) => x.document_id === docs.license1 && x.document_version === '1.0')).toBe(true);
  });
});

describe('Demo', () => {
  let demo = '';
  const startDemo = (uid: string, ids: string[] = []) => h.asUser(uid, async () => (await h.rows<{ r: Obj }>('select public.start_demo($1::uuid[]) as r', [ids]))[0].r);
  const billing = (uid: string) => h.asUser(uid, async () => (await h.rows<Obj>('select * from public.my_billing_status()'))[0]);
  const hasAccess = (uid: string) => h.asUser(uid, async () => (await h.rows<{ ok: boolean }>('select public.has_active_license() as ok'))[0].ok);

  beforeAll(async () => {
    demo = await h.register('demo@privat.de', { first_name: 'Dora', institution_type: 'private', legal_consents: [docs.privacy11, docs.license2] });
  });

  it('erstmalig: 2 Stunden voller Zugriff, ohne Stripe; Serverzeit wird mitgeliefert', async () => {
    expect(await hasAccess(demo)).toBe(false);
    const r = await startDemo(demo);
    const span = (Date.parse(r.expires_at) - Date.parse(r.started_at)) / 1000;
    expect(span).toBe(7200);
    expect(await hasAccess(demo)).toBe(true);
    const lic = await h.licenseOf(demo);
    expect(lic).toMatchObject({ status: 'active', source: 'demo' });
    const b = await billing(demo);
    expect(b).toMatchObject({ license_source: 'demo', demo_used: true, has_access: true, subscription_status: null, has_customer: false });
    expect(b.server_now).toBeInstanceOf(Date);
    expect(await h.rows(`select 1 from public.billing_customers bc join public.profiles p on p.institution_id = bc.institution_id where p.user_id = $1`, [demo])).toHaveLength(0);
  });

  it('bereits verwendet: zweiter Start (anderes Gerät, neue Sitzung) wird serverseitig abgelehnt', async () => {
    expect(await code(() => startDemo(demo))).toBe('OLD01');
  });

  it('abgelaufen: Zugriff endet sofort über valid_until; Job räumt Status auf; kein erneuter Start', async () => {
    const inst = await h.institutionOf(demo);
    await db.query(`update public.licenses set valid_until = now() - interval '1 second' where institution_id = $1`, [inst]);
    await db.query(`update public.demo_grants set started_at = now() - interval '2 hours 1 second', expires_at = now() - interval '1 second' where institution_id = $1`, [inst]);
    expect(await hasAccess(demo)).toBe(false);
    expect((await billing(demo)).has_access).toBe(false);
    expect(await h.asService(async () => (await db.query<{ n: number }>('select public.expire_demos() as n')).rows[0].n)).toBe(1);
    expect((await h.licenseOf(demo)).status).toBe('expired');
    expect((await h.rows<Obj>('select finished_at from public.demo_grants where institution_id = $1', [inst]))[0].finished_at).toBeInstanceOf(Date);
    expect(await code(() => startDemo(demo))).toBe('OLD01');
  });

  it('Demo-Zustimmungen: fehlende Nutzungsbedingungen (neue Version) → erst nach Zustimmung', async () => {
    const u = await h.register('neu@privat.de', { first_name: 'Nina', institution_type: 'private', legal_consents: [docs.privacy11, docs.license2] });
    await publish('license3', 'license_terms', 'all', '3.0');
    expect(await code(() => startDemo(u))).toBe('OLC01');
    expect(await h.rows('select 1 from public.demo_grants g join public.profiles p on p.institution_id = g.institution_id where p.user_id = $1', [u])).toHaveLength(0);
    await startDemo(u, [docs.license3]);
    const c = await h.rows<Obj>(`select document_version, context, plan from public.legal_consents where user_id = $1 and context = 'demo'`, [u]);
    expect(c).toEqual([{ document_version: '3.0', context: 'demo', plan: 'demo' }]);
  });

  it('nicht angemeldet, normales Mitglied oder bereits lizenziert → keine Demo', async () => {
    expect(await code(() => h.asUser(null, () => db.query(`select public.start_demo('{}')`)))).not.toBeNull();
    const lic = await h.register('lizenz@privat.de', { first_name: 'L', institution_type: 'private', legal_consents: [docs.privacy11, docs.license3] });
    const licId = (await h.licenseOf(lic)).id;
    await h.asUser(admin, () => db.query(`select public.admin_set_license_status($1, 'active')`, [licId]));
    expect(await code(() => startDemo(lic))).toBe('OLD02');
  });

  it('Institution statt Benutzer: zweiter Benutzer derselben Institution erhält keine Demo', async () => {
    const owner = await h.register('owner@optik.de', { first_name: 'O', institution_type: 'business', institution_name: 'Optik O', legal_consents: [docs.privacy11, docs.license3] });
    await startDemo(owner);
    const colleague = await h.register('kollege@optik.de', { first_name: 'K', institution_type: 'private', legal_consents: [docs.privacy11, docs.license3] });
    await db.query(`update public.profiles set institution_id = $1 where user_id = $2`, [await h.institutionOf(owner), colleague]);
    expect(await code(() => startDemo(colleague))).toBe('OLD01');
  });

  it('Kauf während der Demo: Stripe-Abo übernimmt die Lizenz (keine doppelte Freischaltung)', async () => {
    const u = await h.register('kauf@optik.de', { first_name: 'K', institution_type: 'business', institution_name: 'Kauf GmbH', legal_consents: [docs.privacy11, docs.license3] });
    const inst = await h.institutionOf(u);
    await startDemo(u);
    await h.asService(() =>
      db.query('select public.apply_stripe_subscription($1::jsonb)', [
        JSON.stringify({ event_id: 'evt_demo_1', event_type: 'checkout.session.completed', customer_id: 'cus_demo_kauf', subscription_id: 'sub_demo_kauf', price_id: 'price_x', plan: 'business', billing_interval: 'yearly', status: 'active', current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 365 * 864e5).toISOString(), cancel_at_period_end: false, metadata_institution_id: inst, checkout_session_id: 'cs_demo_kauf' }),
      ]),
    );
    expect(await h.licenseOf(u)).toMatchObject({ status: 'active', source: 'stripe', valid_until: null, plan: 'business' });
    expect((await h.rows<Obj>('select converted_at, finished_at from public.demo_grants where institution_id = $1', [inst]))[0].converted_at).toBeInstanceOf(Date);
    const b = await billing(u);
    expect(b).toMatchObject({ billing_interval: 'yearly', license_source: 'stripe', demo_used: true, has_access: true });
    expect((await h.rows<Obj>('select checkout_session_id, billing_interval from public.subscriptions where stripe_subscription_id = $1', ['sub_demo_kauf']))[0]).toEqual({ checkout_session_id: 'cs_demo_kauf', billing_interval: 'yearly' });
    // expire_demos fasst die bezahlte Lizenz nicht an
    await h.asService(() => db.query('select public.expire_demos()'));
    expect((await h.licenseOf(u)).status).toBe('active');
  });

  it('Demo-Ende startet NIE ein kostenpflichtiges Abo', async () => {
    const subs = await h.rows(`select s.* from public.subscriptions s join public.profiles p on p.institution_id = s.institution_id where p.user_id = $1`, [demo]);
    expect(subs).toHaveLength(0);
  });

  it('Frontend kann Demo-Daten und Lizenz nicht manipulieren', async () => {
    await h.asUser(demo, async () => {
      expect(await h.fails(`update public.demo_grants set expires_at = now() + interval '1 year'`)).toBe(true);
      expect(await h.fails(`delete from public.demo_grants`)).toBe(true);
      expect(await h.fails(`update public.licenses set valid_until = now() + interval '1 year'`)).toBe(true);
      expect(await h.fails(`select public.expire_demos()`)).toBe(true);
    });
  });
});

describe('Checkout-Zustimmungen (serverseitig, für die Edge Function)', () => {
  let b2c = '';
  const check = (uid: string, ids: string[]) => h.asService(async () => (await h.rows<{ r: Obj }>('select public.checkout_consent_check($1, $2::uuid[]) as r', [uid, ids]))[0].r);

  beforeAll(async () => {
    b2c = await h.register('kunde@privat.de', { first_name: 'K', institution_type: 'private', legal_consents: [docs.privacy11, docs.license3] });
  });

  it('beim Kauf müssen ALLE Kaufdokumente frisch bestätigt werden (frühere Zustimmung zählt nicht)', async () => {
    const r = await check(b2c, []);
    expect(r.ok).toBe(false);
    expect(r.missing.map((m: Obj) => m.type).sort()).toEqual(['consent_immediate_performance', 'consent_withdrawal_loss', 'license_terms', 'privacy', 'terms', 'withdrawal'].sort());
  });

  it('vollständig → ok; Protokoll mit Session, Tarif und Intervall', async () => {
    const ids = [docs.terms_b2c, docs.privacy11, docs.withdrawal, docs.license3, docs.c1, docs.c2];
    expect((await check(b2c, ids)).ok).toBe(true);
    const n = await h.asService(async () => (await h.rows<{ n: number }>(`select public.record_checkout_consents($1, $2::uuid[], 'cs_test_123', 'private', 'yearly') as n`, [b2c, ids]))[0].n);
    expect(n).toBe(6);
    const c = await h.rows<Obj>(`select context, plan, billing_interval, checkout_session_id, consent_type from public.legal_consents where user_id = $1 and context = 'checkout'`, [b2c]);
    expect(c.every((x) => x.plan === 'private' && x.billing_interval === 'yearly' && x.checkout_session_id === 'cs_test_123')).toBe(true);
    expect(c.filter((x) => x.consent_type === 'agreed')).toHaveLength(2);
  });

  it('veraltete Dokument-ID → outdated; Aufruf nur mit service_role', async () => {
    expect((await check(b2c, [docs.terms_b2c, docs.privacy1])).outdated).toBe(true);
    await h.asUser(b2c, async () => {
      expect(await h.fails(`select public.checkout_consent_check($1, '{}')`, [b2c])).toBe(true);
      expect(await h.fails(`select public.record_checkout_consents($1, '{}', 'cs_x', 'private', 'monthly')`, [b2c])).toBe(true);
    });
  });
});

describe('Admin-Übersicht', () => {
  it('zeigt Kundentyp, Paket/Intervall, Demo, Zustimmungen', async () => {
    const list = await h.asUser(admin, () => h.rows<Obj>('select * from public.admin_list_accounts()'));
    const kauf = list.find((r) => r.email === 'kauf@optik.de')!;
    expect(kauf).toMatchObject({ institution_type: 'business', billing_interval: 'yearly', demo_used: true, license_source: 'stripe', subscription_status: 'active' });
    expect(kauf.consent_count).toBe(2);
    expect(kauf.consent_summary.map((x: Obj) => `${x.type}@${x.version}`)).toEqual(['privacy@1.1', 'license_terms@3.0']);
    const firma = list.find((r) => r.email === 'firma@optik.de')!;
    expect(firma.vat_id).toBe('DE123456789');
    const consents = await h.asUser(admin, () => h.rows<Obj>('select * from public.admin_list_consents($1)', [firma.institution_id]));
    expect(consents).toHaveLength(2);
    const kunde = list.find((r) => r.email === 'kunde@privat.de')!;
    expect((await h.asUser(admin, () => h.rows<Obj>('select * from public.admin_list_consents($1)', [kunde.institution_id]))).length).toBe(8);
    const kundeUid = (await h.rows<{ user_id: string }>(`select user_id from public.profiles where email = 'kunde@privat.de'`))[0].user_id;
    expect(await h.asUser(kundeUid, () => h.fails('select * from public.admin_list_consents($1)', [firma.institution_id]))).toBe(true);
  });
});

/* ------------------------------ Kauf Ende-zu-Ende mit Zustimmungen ------------------------------ */
import { FakeStripe, pgBillingDb } from './stripeHarness';
import { handleCheckout, handleWebhook, type Deps } from '../../supabase/functions/_shared/handlers';
import { signStripePayload } from '../../supabase/functions/_shared/stripeSignature';

describe('Kauf Ende-zu-Ende (Handler + Datenbank): B2C jährlich mit Zustimmungen', () => {
  const stripe = new FakeStripe();
  let user: { id: string; email: string } | null = null;
  const env: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_p8', SITE_URL: 'http://localhost:5173' };
  const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => user, db: pgBillingDb(db, h), stripe });
  const post = (body: unknown) => new Request('https://fn.test', { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: JSON.stringify(body) });
  const hook = async (type: string, object: Obj, id: string) => {
    const payload = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });
    return handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, 'whsec_p8') }, body: payload }), deps());
  };
  let uid = '';
  let inst = '';
  let sessionId = '';

  it('ohne vollständige Zustimmung kein Checkout; mit Zustimmung Session + Protokoll', async () => {
    uid = await h.register('jahr@privat.de', { first_name: 'J', institution_type: 'private', legal_consents: [docs.privacy11, docs.license3] });
    inst = await h.institutionOf(uid);
    user = { id: uid, email: 'jahr@privat.de' };
    const missing = await handleCheckout(post({ plan: 'private', interval: 'yearly', consents: [docs.terms_b2c] }), deps());
    expect(missing.status).toBe(422);
    expect(stripe.calls).toHaveLength(0);
    const ids = [docs.terms_b2c, docs.privacy11, docs.withdrawal, docs.license3, docs.c1, docs.c2];
    const ok = await handleCheckout(post({ plan: 'private', interval: 'yearly', consents: ids, price: 'price_billig' }), deps());
    expect(ok.status).toBe(200);
    const session = stripe.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(session.params['line_items[0][price]']).toBe('price_1UKwPqDi0mx4WWPo6wJiRryZ');
    const c = await h.rows<Obj>(`select checkout_session_id, billing_interval from public.legal_consents where user_id = $1 and context = 'checkout'`, [uid]);
    expect(c).toHaveLength(6);
    sessionId = c[0].checkout_session_id;
    expect(sessionId).toMatch(/^cs_/);
    expect(c.every((x) => x.checkout_session_id === sessionId && x.billing_interval === 'yearly')).toBe(true);
    // Success-Redirect allein schaltet nichts frei
    expect((await h.licenseOf(uid)).status).toBe('pending');
  });

  it('Webhook (auch doppelt) aktiviert jährlich; Zustimmungen sind mit dem Abo verknüpft', async () => {
    const customer = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [inst]))[0].c;
    stripe.putSubscription('sub_jahr', customer, 'private', inst, { items: { data: [{ price: { id: 'price_1UKwPqDi0mx4WWPo6wJiRryZ', recurring: { interval: 'year' } }, current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400 }] } });
    const obj = { id: sessionId, object: 'checkout.session', mode: 'subscription', subscription: 'sub_jahr', customer };
    expect((await hook('checkout.session.completed', obj, 'evt_p8_1')).status).toBe(200);
    expect((await hook('checkout.session.completed', obj, 'evt_p8_1')).status).toBe(200);
    expect(await h.rows('select * from public.subscriptions where institution_id = $1', [inst])).toHaveLength(1);
    expect(await h.licenseOf(uid)).toMatchObject({ status: 'active', plan: 'private', source: 'stripe' });
    const sub = (await h.rows<Obj>('select billing_interval, checkout_session_id from public.subscriptions where stripe_subscription_id = $1', ['sub_jahr']))[0];
    expect(sub).toEqual({ billing_interval: 'yearly', checkout_session_id: sessionId });
    const consents = await h.asUser(admin, () => h.rows<Obj>('select * from public.admin_list_consents($1)', [inst]));
    expect(consents.filter((x) => x.context === 'checkout').every((x) => x.stripe_subscription_id === 'sub_jahr')).toBe(true);
    // späteres Login: Status bleibt (Browser nach Zahlung geschlossen – Webhook reicht)
    const b = await h.asUser(uid, async () => (await h.rows<Obj>('select * from public.my_billing_status()'))[0]);
    expect(b).toMatchObject({ has_access: true, billing_interval: 'yearly', subscription_status: 'active' });
  });
});
