/// <reference types="node" />
/**
 * Rechtsbetrieb gegen echtes PostgreSQL: Entwurfs-Import der Rechtstexte, Impressum, Prüfhinweis-Sperre,
 * Kündigungs-/Widerrufserklärungen, Vertragsbestätigung, E-Mail-Protokoll und Ablauf-Erinnerung.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers, supabaseDir } from './pg';

let db: PGlite;
let h: ReturnType<typeof helpers>;
let admin = '';
const seedSql = () => readFileSync(join(supabaseDir, 'seed', 'legal_documents_v1_0_drafts.sql'), 'utf8');

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};

/** Registrierung mit Zustimmung zu den aktuell verlangten Dokumenten (wie das Frontend) */
async function registerWithConsents(email: string, meta: Record<string, unknown>) {
  const ids = (await h.asUser(null, () => h.rows<{ id: string }>(`select id from public.legal_required_documents('registration', $1)`, [meta.institution_type]))).map((x) => x.id);
  return h.register(email, { ...meta, legal_consents: ids });
}

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  admin = await h.register('admin@olo.de', { first_name: 'Ada', institution_type: 'private' });
  await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [admin]);
}, 60000);

describe('Entwurfs-Import der Rechtstexte 1.0', () => {
  it('legt alle 9 Dokumente als Entwurf an – nichts wird veröffentlicht', async () => {
    // bereits vorhandene veröffentlichte Version darf nicht überschrieben werden
    const old = await h.asUser(admin, async () => {
      const r = await h.rows<{ id: string }>(`select public.admin_legal_save_draft(null, 'terms', 'all', '1.0', 'Alte AGB', 'alter Text', null, null) as id`);
      await db.query('select public.admin_legal_activate($1)', [r[0].id]);
      return r[0].id;
    });
    await db.exec(seedSql());
    const docs = await h.rows<{ type: string; audience: string; version: string; status: string; title: string; content: string }>(
      `select type::text, audience::text, version, status::text, title, content from public.legal_documents order by type`,
    );
    const drafts = docs.filter((d) => d.status === 'draft');
    expect(drafts.map((d) => `${d.type}/${d.audience}`).sort()).toEqual(
      ['b2b_terms/b2b', 'consent_immediate_performance/b2c', 'consent_withdrawal_loss/b2c', 'imprint/all', 'license_terms/all', 'privacy/all', 'withdrawal/b2c', 'withdrawal_form/b2c'].sort(),
    );
    const terms = docs.filter((d) => d.type === 'terms');
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ status: 'active', title: 'Alte AGB', content: 'alter Text' });
    expect((await h.rows<{ id: string }>('select id from public.legal_documents where id = $1', [old]))).toHaveLength(1);
    // Titel steht separat, der Inhalt beginnt nicht mit der Titelüberschrift
    expect(drafts.every((d) => !d.content.startsWith('# '))).toBe(true);
  });

  it('erneutes Ausführen ändert nichts', async () => {
    const before = await h.rows('select id, content from public.legal_documents order by id');
    await db.exec(seedSql());
    expect(await h.rows('select id, content from public.legal_documents order by id')).toEqual(before);
  });

  it('Veröffentlichen mit offenem [Prüfhinweis] wird abgelehnt; nach Klärung möglich', async () => {
    const d = (await h.rows<{ id: string; content: string; title: string; checkbox_label: string | null }>(`select id, content, title, checkbox_label from public.legal_documents where type = 'privacy' and version = '1.0'`))[0];
    expect(d.content).toContain('[Prüfhinweis');
    expect(await h.asUser(admin, () => code(() => db.query('select public.admin_legal_activate($1)', [d.id])))).toBe('22023');
    const cleaned = d.content.replace(/\[Prüfhinweis[^\]]*\]\n?/g, '');
    await h.asUser(admin, () => db.query(`select public.admin_legal_save_draft($1, 'privacy', 'all', '1.0', $2, $3, $4, null)`, [d.id, d.title, cleaned, d.checkbox_label]));
    expect(await h.asUser(admin, () => code(() => db.query('select public.admin_legal_activate($1)', [d.id])))).toBeNull();
    const active = await h.rows<{ status: string; content_hash: string }>(`select status::text, content_hash from public.legal_documents where id = $1`, [d.id]);
    expect(active[0].status).toBe('active');
    expect(active[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Impressum ist öffentlich abrufbar, wird aber nie als Zustimmung verlangt', async () => {
    const d = (await h.rows<{ id: string; content: string; title: string }>(`select id, content, title from public.legal_documents where type = 'imprint'`))[0];
    await h.asUser(admin, async () => {
      await db.query(`select public.admin_legal_save_draft($1, 'imprint', 'all', '1.0', $2, $3, null, null)`, [d.id, d.title, d.content.replace(/\[Prüfhinweis[^\]]*\]\n?/g, '')]);
      await db.query('select public.admin_legal_activate($1)', [d.id]);
    });
    const pub = await h.asUser(null, () => h.rows<{ type: string }>(`select type::text from public.legal_published_documents()`));
    expect(pub.map((x) => x.type)).toContain('imprint');
    const doc = await h.asUser(null, () => h.rows<{ content: string }>(`select content from public.legal_document($1)`, [d.id]));
    expect(doc[0].content).toContain('Forsthausstraße 14');
    for (const [ctx, t] of [['registration', 'private'], ['checkout', 'private'], ['checkout', 'business'], ['demo', 'education']]) {
      const req = await h.asUser(null, () => h.rows<{ type: string }>(`select type::text from public.legal_required_documents($1, $2)`, [ctx, t]));
      expect(req.map((x) => x.type)).not.toContain('imprint');
    }
  });
});

describe('Kündigung und Widerruf über die Website', () => {
  let paula = '';
  let inst = '';
  beforeAll(async () => {
    paula = await registerWithConsents('paula@web.de', { first_name: 'Paula', last_name: 'Privat', institution_type: 'private' });
    inst = await h.institutionOf(paula);
    await db.query(
      `insert into public.subscriptions (institution_id, stripe_subscription_id, stripe_customer_id, status, plan, billing_interval, current_period_start, current_period_end, checkout_session_id)
       values ($1, 'sub_paula', 'cus_paula', 'active', 'private', 'monthly', now() - interval '3 days', now() + interval '27 days', 'cs_paula')`,
      [inst],
    );
  });

  const record = (kind: string, email: string, name = 'Paula Privat') =>
    h.asService(() => h.rows<{ r: Record<string, any> }>(`select public.consumer_declaration_record($1, null, $2, $3, 'Private monatlich', null) as r`, [kind, name, email])).then((x) => x[0].r); // eslint-disable-line @typescript-eslint/no-explicit-any

  it('Konto wird serverseitig über die E-Mail zugeordnet (Groß-/Kleinschreibung egal)', async () => {
    const r = await record('cancellation', ' PAULA@web.de ');
    expect(r.account).toMatchObject({ user_id: paula, customer_type: 'private', first_name: 'Paula' });
    expect(r.subscription).toMatchObject({ stripe_subscription_id: 'sub_paula', plan: 'private', billing_interval: 'monthly' });
    const row = (await h.rows<{ cancellation_type: string; status: string; email: string }>(`select cancellation_type, status, email from public.consumer_declarations where id = $1`, [r.id]))[0];
    expect(row).toEqual({ cancellation_type: 'ordinary', status: 'received', email: 'paula@web.de' });
  });

  it('unbekannte E-Mail: Erklärung wird trotzdem gespeichert, ohne Zuordnung', async () => {
    const r = await record('withdrawal', 'fremd@example.org', 'Fremd');
    expect(r.account).toBeNull();
    expect(r.subscription).toBeNull();
  });

  it('zählt Erklärungen derselben Adresse der letzten Stunde (Missbrauchsschutz)', async () => {
    const r = await record('cancellation', 'paula@web.de');
    expect(r.recent_count).toBeGreaterThanOrEqual(1);
  });

  it('Browser-Rollen haben keinen Zugriff; Inhalt unveränderlich; Löschen erst nach 3 Jahren', async () => {
    for (const uid of [null, paula]) {
      expect(await h.asUser(uid, () => code(() => db.query(`select public.consumer_declaration_record('cancellation', null, 'X', 'x@y.de', null, null)`)))).toBe('42501');
      expect(await h.asUser(uid, () => code(() => db.query(`select * from public.consumer_declarations`)))).toBe('42501');
    }
    const id = (await h.rows<{ id: string }>(`select id from public.consumer_declarations limit 1`))[0].id;
    expect(await code(() => db.query(`update public.consumer_declarations set email = 'x@y.de' where id = $1`, [id]))).toBe('42501');
    expect(await code(() => db.query(`delete from public.consumer_declarations where id = $1`, [id]))).toBe('42501');
    await h.asService(() => db.query(`select public.consumer_declaration_update($1, 'processed', '{"cancel_at":"x"}', true, true)`, [id]));
    const row = (await h.rows<{ status: string; result: Record<string, string>; confirmation_sent_at: Date | null }>(`select status, result, confirmation_sent_at from public.consumer_declarations where id = $1`, [id]))[0];
    expect(row.status).toBe('processed');
    expect(row.result.cancel_at).toBe('x');
    expect(row.confirmation_sent_at).not.toBeNull();
  });

  it('Admin-Liste und Status nur für Super-Admins', async () => {
    expect(await h.asUser(paula, () => code(() => db.query('select * from public.admin_list_declarations()')))).toBe('42501');
    const list = await h.asUser(admin, () => h.rows<{ id: string; kind: string }>('select id, kind from public.admin_list_declarations()'));
    expect(list.length).toBeGreaterThanOrEqual(3);
    await h.asUser(admin, () => db.query(`select public.admin_set_declaration_status($1, 'done')`, [list[0].id]));
    expect(await h.asUser(admin, () => code(() => db.query(`select public.admin_set_declaration_status($1, 'processed')`, [list[0].id])))).toBe('22023');
  });
});

describe('Vertragsbestätigung, E-Mail-Protokoll, Ablauf-Erinnerung', () => {
  let kim = '';
  let inst = '';
  beforeAll(async () => {
    kim = await registerWithConsents('kim@web.de', { first_name: 'Kim', last_name: 'Kauf', institution_type: 'private' });
    inst = await h.institutionOf(kim);
    await db.query(
      `insert into public.subscriptions (institution_id, stripe_subscription_id, stripe_customer_id, status, plan, billing_interval, current_period_start, current_period_end, cancel_at_period_end, checkout_session_id)
       values ($1, 'sub_kim', 'cus_kim', 'active', 'private', 'yearly', now() - interval '351 days', now() + interval '10 days', true, 'cs_kim')`,
      [inst],
    );
    const priv = (await h.rows<{ id: string }>(`select id from public.legal_documents where type = 'privacy' and status = 'active'`))[0].id;
    await db.query(
      `insert into public.legal_consents (user_id, institution_id, customer_type, document_id, document_type, document_version, document_audience, document_hash, consent_type, context, plan, billing_interval, checkout_session_id)
       select $1, $2, 'private', d.id, d.type, d.version, d.audience, d.content_hash, 'acknowledged', 'checkout', 'private', 'yearly', 'cs_kim' from public.legal_documents d where d.id = $3`,
      [kim, inst, priv],
    );
  });

  it('liefert Empfänger, Tarif und die akzeptierten Dokumente in genau dieser Version', async () => {
    const r = (await h.asService(() => h.rows<{ r: Record<string, any> }>(`select public.contract_confirmation_data('cs_kim') as r`)))[0].r; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r).toMatchObject({ email: 'kim@web.de', first_name: 'Kim', customer_type: 'private', plan: 'private', billing_interval: 'yearly', cancel_at_period_end: true });
    expect(r.documents.map((d: { type: string }) => d.type)).toContain('privacy');
    expect(r.documents.find((d: { type: string }) => d.type === 'privacy').content).toContain('Verantwortlicher');
    expect(await h.asUser(kim, () => code(() => db.query(`select public.contract_confirmation_data('cs_kim')`)))).toBe('42501');
  });

  it('nach erfolgreichem Versand keine zweite Bestätigung (idempotent)', async () => {
    const log = (status: string) => h.asService(() => h.rows<{ ok: boolean }>(`select public.system_mail_log('contract_confirmation', 'kim@web.de', 'Vertragsbestätigung', 'cs_kim', $1, null) as ok`, [status]));
    expect((await log('failed'))[0].ok).toBe(true);
    expect((await h.asService(() => h.rows<{ r: unknown }>(`select public.contract_confirmation_data('cs_kim') as r`)))[0].r).not.toBeNull();
    expect((await log('sent'))[0].ok).toBe(true);
    expect((await log('sent'))[0].ok).toBe(false);
    expect((await h.asService(() => h.rows<{ r: unknown }>(`select public.contract_confirmation_data('cs_kim') as r`)))[0].r).toBeNull();
    expect(await h.asUser(kim, () => code(() => db.query(`select * from public.system_mails`)))).toBe('42501');
  });

  it('Erinnerung nur für private Jahreslizenzen kurz vor Ablauf, genau einmal', async () => {
    const cands = () => h.asService(() => h.rows<{ subscription_id: string; email: string }>(`select * from public.renewal_reminder_candidates(14)`));
    const c = await cands();
    expect(c.map((x) => x.email)).toEqual(['kim@web.de']);
    expect(await h.asService(() => h.rows(`select * from public.renewal_reminder_candidates(5)`))).toEqual([]);
    await h.asService(() => db.query(`select public.renewal_reminder_mark($1)`, [c[0].subscription_id]));
    expect(await cands()).toEqual([]);
  });
});

/* ------------------------------ Ende-zu-Ende: Handler + Datenbank ------------------------------ */
import { FakeMailer, FakeStripe, pgBillingDb, pgOpsDb } from './stripeHarness';
import { handleCheckout, handleWebhook, type Deps } from '../../supabase/functions/_shared/handlers';
import { handleConsumerRequest, handleMailJobs } from '../../supabase/functions/_shared/legalOps';
import { signStripePayload } from '../../supabase/functions/_shared/stripeSignature';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Ende-zu-Ende: Kauf → Vertragsbestätigung, Kündigung/Widerruf, Mail-Jobs', () => {
  const stripe = new FakeStripe();
  const mailer = new FakeMailer();
  let user: { id: string; email: string } | null = null;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_lo',
    SITE_URL: 'https://olo-lab.de',
    STRIPE_TAX_RATE_ID: 'txr_19inkl',
    CRON_SECRET: 'cron-secret-0123456789',
  };
  const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => user, db: pgBillingDb(db, h), ops: pgOpsDb(db, h), mailer, stripe });
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://fn.test', { method: 'POST', headers: { Origin: 'https://olo-lab.de', ...headers }, body: JSON.stringify(body) });
  const hook = async (type: string, object: Obj, id: string) => {
    const payload = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });
    return handleWebhook(new Request('https://fn.test', { method: 'POST', headers: { 'Stripe-Signature': await signStripePayload(payload, 'whsec_lo') }, body: payload }), deps());
  };
  const required = (ctx: string, t: string) => h.asUser(null, () => h.rows<{ id: string; type: string; required: boolean }>(`select id, type::text, required from public.legal_required_documents($1, $2)`, [ctx, t]));
  let uid = '';
  let inst = '';
  let sessionId = '';

  beforeAll(async () => {
    // alle Entwürfe 1.0 nach „Klärung“ der Prüfhinweise veröffentlichen
    const drafts = await h.rows<{ id: string; type: string; audience: string; title: string; content: string; checkbox_label: string | null }>(
      `select id, type::text, audience::text, title, content, checkbox_label from public.legal_documents where status = 'draft'`,
    );
    await h.asUser(admin, async () => {
      for (const d of drafts) {
        await db.query(`select public.admin_legal_save_draft($1, $2, $3, '1.0', $4, $5, $6, null)`, [d.id, d.type, d.audience, d.title, d.content.replace(/\[Prüfhinweis[^\]]*\]\n?/g, ''), d.checkbox_label]);
        await db.query('select public.admin_legal_activate($1)', [d.id]);
      }
    });
  });

  it('B2C: erforderliche Dokumente sind die neuen Texte (inkl. Wertersatz-Hinweis), Formular nur als Link', async () => {
    const r = await required('checkout', 'private');
    expect(r.filter((x) => x.required).map((x) => x.type).sort()).toEqual(['consent_immediate_performance', 'consent_withdrawal_loss', 'license_terms', 'privacy', 'terms', 'withdrawal'].sort());
    expect(r.find((x) => x.type === 'withdrawal_form')?.required).toBe(false);
    const b2b = await required('checkout', 'business');
    expect(b2b.map((x) => x.type).sort()).toEqual(['b2b_terms', 'license_terms', 'privacy', 'terms'].sort());
  });

  it('Checkout: Steuersatz 19 % inkl., Hinweis am Stripe-Button; B2B nur mit Sitz in Deutschland', async () => {
    const reg = await required('registration', 'private');
    uid = await h.register('kunde@web.de', { first_name: 'Karla', last_name: 'Kunde', institution_type: 'private', legal_consents: reg.map((x) => x.id) });
    inst = await h.institutionOf(uid);
    user = { id: uid, email: 'kunde@web.de' };
    const ids = (await required('checkout', 'private')).filter((x) => x.required).map((x) => x.id);
    const res = await handleCheckout(post({ plan: 'private', interval: 'yearly', consents: ids }), deps());
    expect(res.status).toBe(200);
    const call = stripe.calls.find((c) => c.path === 'checkout/sessions')!;
    expect(call.params['subscription_data[default_tax_rates][0]']).toBe('txr_19inkl');
    expect(call.params['custom_text[submit][message]']).toContain('Mit Klick auf „Abonnieren“ bestellen Sie OLO-LAB3D Private zahlungspflichtig: 199,00 € für 12 Monate inkl. 19 % USt.; Laufzeit 12 Monate, endet automatisch');
    sessionId = (await h.rows<{ s: string }>(`select distinct checkout_session_id as s from public.legal_consents where user_id = $1 and context = 'checkout'`, [uid]))[0].s;

    const regB2b = await required('registration', 'business');
    const at = await h.register('firma@example.at', {
      first_name: 'Franz', institution_type: 'business', institution_name: 'Optik Wien', address_line_1: 'Ring 1', postal_code: '1010', city: 'Wien', country: 'AT', legal_consents: regB2b.map((x) => x.id),
    });
    user = { id: at, email: 'firma@example.at' };
    const b2bIds = (await required('checkout', 'business')).map((x) => x.id);
    const refused = await handleCheckout(post({ plan: 'business', interval: 'monthly', consents: b2bIds }), deps());
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'b2b_country' });
    user = { id: uid, email: 'kunde@web.de' };
  });

  it('Webhook: Vertragsbestätigung genau einmal, mit allen akzeptierten Dokumenten als Anhang', async () => {
    const customer = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [inst]))[0].c;
    const start = Math.floor(Date.now() / 1000);
    stripe.putSubscription('sub_karla', customer, 'private', inst, { items: { data: [{ price: { id: 'price_1UKwPqDi0mx4WWPo6wJiRryZ', recurring: { interval: 'year' } }, current_period_start: start, current_period_end: start + 365 * 86400 }] } });
    const obj = { id: sessionId, object: 'checkout.session', mode: 'subscription', subscription: 'sub_karla', customer, payment_status: 'paid', customer_details: { address: { country: 'DE' } } };
    mailer.sent = [];
    expect((await hook('checkout.session.completed', obj, 'evt_lo_1')).status).toBe(200);
    expect((await hook('checkout.session.completed', obj, 'evt_lo_1')).status).toBe(200);
    expect((await hook('checkout.session.async_payment_succeeded', obj, 'evt_lo_2')).status).toBe(200);
    const confirmations = mailer.sent.filter((m) => m.subject.startsWith('Vertragsbestätigung'));
    expect(confirmations).toHaveLength(1);
    const m = confirmations[0];
    expect(m.to).toBe('kunde@web.de');
    expect(m.text).toContain('199,00 € für 12 Monate inkl. 19 % USt.');
    expect(m.text).toContain('keine automatische Verlängerung');
    expect(m.text).toContain('Ich verlange ausdrücklich, dass OLO Vision mit der Leistung');
    expect(m.text).toContain('Wertersatz');
    const names = (m.attachments ?? []).map((a) => a.filename);
    for (const part of ['AGB', 'Lizenz', 'Datenschutz', 'Widerrufsbelehrung', 'Muster-Widerrufsformular']) expect(names.some((n) => n.includes(part))).toBe(true);
    expect(m.attachments!.find((a) => a.filename.includes('AGB'))!.content).toContain('Prüfsumme (SHA-256):');
    expect(m.attachments!.every((a) => !a.content.includes('[Prüfhinweis'))).toBe(true);
    // private Jahreslizenz endet automatisch
    expect(stripe.calls.filter((c) => c.method === 'POST' && c.path === 'subscriptions/sub_karla')).toHaveLength(1);
  });

  it('Kündigungsbutton: Abo wird zum Periodenende gekündigt, Bestätigung an die Konto-Adresse, Hinweis an OLO Vision', async () => {
    // private Jahreslizenz ist schon beendet → Kündigung bestätigt nur das bestehende Ende
    await hook('customer.subscription.updated', { id: 'sub_karla', object: 'subscription' }, 'evt_lo_3');
    mailer.sent = [];
    const res = await handleConsumerRequest(post({ kind: 'cancellation', name: 'Karla Kunde', email: 'KUNDE@web.de', contract: 'Private jährlich' }), deps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['confirmationSent', 'id', 'ok', 'receivedAt']);
    const conf = mailer.sent.find((x) => x.subject.startsWith('Eingangsbestätigung Ihrer Kündigung'))!;
    expect(conf.to).toBe('kunde@web.de');
    expect(conf.text).toMatch(/Ihr Vertrag endet zum \d{1,2}\. \S+ \d{4}/);
    const notice = mailer.sent.find((x) => x.subject.startsWith('[OLO-LAB3D] Kündigung'))!;
    expect(notice.to).toBe('info@olo-vision.de');
    expect(notice.replyTo).toBe('kunde@web.de');
    const row = (await h.rows<Obj>(`select status, result, confirmation_sent_at, notified_at from public.consumer_declarations where id = $1`, [body.id]))[0];
    expect(row.status).toBe('processed');
    expect(row.confirmation_sent_at).not.toBeNull();
    expect(row.notified_at).not.toBeNull();
  });

  it('Monatsabo: Kündigung setzt bei Stripe „endet zum Periodenende“', async () => {
    const reg = await required('registration', 'private');
    const mo = await h.register('monat@web.de', { first_name: 'Moni', institution_type: 'private', legal_consents: reg.map((x) => x.id) });
    const moInst = await h.institutionOf(mo);
    const start = Math.floor(Date.now() / 1000);
    stripe.putSubscription('sub_monat', 'cus_monat', 'private', moInst, { items: { data: [{ price: { id: 'price_1UKgZZDi0mx4WWPoSxzWozbG' }, current_period_start: start, current_period_end: start + 30 * 86400 }] } });
    await db.query('insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, $2)', [moInst, 'cus_monat']);
    await hook('customer.subscription.created', { id: 'sub_monat', object: 'subscription' }, 'evt_lo_4');
    expect(stripe.calls.filter((c) => c.path === 'subscriptions/sub_monat' && c.method === 'POST')).toHaveLength(0);
    const res = await handleConsumerRequest(post({ kind: 'cancellation', name: 'Moni', email: 'monat@web.de' }), deps());
    expect(res.status).toBe(200);
    const upd = stripe.calls.filter((c) => c.path === 'subscriptions/sub_monat' && c.method === 'POST');
    expect(upd.map((c) => c.params)).toEqual([{ cancel_at_period_end: 'true' }]);
  });

  it('unbekannte Adresse: gleiche Antwort; Bestätigung an die angegebene Adresse; manuelle Prüfung', async () => {
    mailer.sent = [];
    const res = await handleConsumerRequest(post({ kind: 'cancellation', name: 'Niemand', email: 'niemand@example.org' }), deps());
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(['confirmationSent', 'id', 'ok', 'receivedAt']);
    const conf = mailer.sent.find((x) => x.subject.startsWith('Eingangsbestätigung'))!;
    expect(conf.to).toBe('niemand@example.org');
    expect(conf.text).toContain('kein laufendes Abonnement automatisch zuordnen');
  });

  it('Widerrufsbutton: Eingangsbestätigung und Aufgabe für OLO Vision (Erstattung manuell)', async () => {
    mailer.sent = [];
    const res = await handleConsumerRequest(post({ kind: 'withdrawal', name: 'Karla Kunde', email: 'kunde@web.de' }), deps());
    expect(res.status).toBe(200);
    expect(mailer.sent.find((x) => x.subject.startsWith('Eingangsbestätigung Ihres Widerrufs'))?.to).toBe('kunde@web.de');
    expect(mailer.sent.find((x) => x.subject.startsWith('[OLO-LAB3D] Widerruf'))?.text).toContain('Erstattung in Stripe ausführen');
  });

  it('Eingaben werden geprüft; Honeypot und Missbrauchsschutz', async () => {
    expect((await handleConsumerRequest(post({ kind: 'cancellation', name: '', email: 'x@y.de' }), deps())).status).toBe(422);
    expect((await handleConsumerRequest(post({ kind: 'cancellation', name: 'A', email: 'kein-mail' }), deps())).status).toBe(422);
    expect((await handleConsumerRequest(post({ kind: 'cancellation', cancellationType: 'extraordinary', name: 'A', email: 'a@b.de' }), deps())).status).toBe(422);
    expect((await handleConsumerRequest(post({ kind: 'kaufen', name: 'A', email: 'a@b.de' }), deps())).status).toBe(422);
    const before = (await h.rows<{ n: number }>('select count(*)::int as n from public.consumer_declarations'))[0].n;
    expect((await handleConsumerRequest(post({ kind: 'cancellation', name: 'Bot', email: 'bot@spam.de', website: 'http://spam' }), deps())).status).toBe(200);
    expect((await h.rows<{ n: number }>('select count(*)::int as n from public.consumer_declarations'))[0].n).toBe(before);
    mailer.sent = [];
    for (let i = 0; i < 5; i++) await handleConsumerRequest(post({ kind: 'withdrawal', name: 'Flut', email: 'flut@example.org' }), deps());
    expect(mailer.sent.filter((m) => m.to === 'flut@example.org')).toHaveLength(3);
    expect((await h.rows<{ n: number }>(`select count(*)::int as n from public.consumer_declarations where email = 'flut@example.org'`))[0].n).toBe(5);
  });

  it('SMTP-Ausfall: Vertragsbestätigung wird als fehlgeschlagen protokolliert und vom Mail-Job nachgeholt; Erinnerung einmal', async () => {
    const reg = await required('registration', 'private');
    const ids = (await required('checkout', 'private')).filter((x) => x.required).map((x) => x.id);
    const pia = await h.register('pia@web.de', { first_name: 'Pia', institution_type: 'private', legal_consents: reg.map((x) => x.id) });
    const piaInst = await h.institutionOf(pia);
    user = { id: pia, email: 'pia@web.de' };
    expect((await handleCheckout(post({ plan: 'private', interval: 'yearly', consents: ids }), deps())).status).toBe(200);
    const sess = (await h.rows<{ s: string }>(`select distinct checkout_session_id as s from public.legal_consents where user_id = $1 and context = 'checkout'`, [pia]))[0].s;
    const cus = (await h.rows<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [piaInst]))[0].c;
    const start = Math.floor(Date.now() / 1000) - 355 * 86400;
    stripe.putSubscription('sub_pia', cus, 'private', piaInst, { items: { data: [{ price: { id: 'price_1UKwPqDi0mx4WWPo6wJiRryZ', recurring: { interval: 'year' } }, current_period_start: start, current_period_end: start + 365 * 86400 }] } });
    mailer.sent = [];
    mailer.failNext = 1;
    expect((await hook('checkout.session.completed', { id: sess, object: 'checkout.session', mode: 'subscription', subscription: 'sub_pia', customer: cus, payment_status: 'paid' }, 'evt_lo_9')).status).toBe(200);
    expect(await h.licenseOf(pia)).toMatchObject({ status: 'active' });
    expect((await h.rows<{ status: string }>(`select status from public.system_mails where kind = 'contract_confirmation' and related_key = $1`, [sess])).map((x) => x.status)).toEqual(['failed']);
    await hook('customer.subscription.updated', { id: 'sub_pia', object: 'subscription' }, 'evt_lo_10');

    const cron = (secret: string) => handleMailJobs(new Request('https://fn.test', { method: 'POST', headers: { 'x-cron-secret': secret } }), deps());
    expect((await cron('falsch')).status).toBe(401);
    const r1 = await cron(env.CRON_SECRET);
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.confirmations).toBeGreaterThanOrEqual(1);
    expect(b1.reminders.sent).toBe(1);
    expect(mailer.sent.some((m) => m.to === 'pia@web.de' && m.subject.startsWith('Vertragsbestätigung'))).toBe(true);
    expect(mailer.sent.some((m) => m.to === 'pia@web.de' && m.subject.startsWith('Ihre Jahreslizenz'))).toBe(true);
    const r2 = await (await cron(env.CRON_SECRET)).json();
    expect(r2).toEqual({ confirmations: 0, reminders: { checked: 0, sent: 0 } });
  });

  it('ohne SMTP-Konfiguration läuft alles weiter; Versuch wird als „skipped“ protokolliert', async () => {
    const off = new FakeMailer(false);
    const res = await handleConsumerRequest(post({ kind: 'withdrawal', name: 'Ohne Mail', email: 'ohne@example.org' }), { ...deps(), mailer: off });
    expect(res.status).toBe(200);
    expect((await res.json()).confirmationSent).toBe(false);
    expect((await h.rows<{ status: string }>(`select status from public.system_mails where recipient = 'ohne@example.org'`)).map((x) => x.status)).toEqual(['skipped']);
  });
});
