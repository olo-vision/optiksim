/// <reference types="node" />
/**
 * 0.10.0 – Cloud-Speicherung der Kundeninhalte, Lizenz ≠ Daten, Kontostatus und endgültige Löschung
 * gegen echtes PostgreSQL (RLS, Trigger, Rechte wie in Supabase).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: PGlite;
let h: ReturnType<typeof helpers>;
let anna = '';
let bert = '';
let annaInst = '';
let bertInst = '';

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};
const setLicense = (inst: string, status: string) => db.query(`update public.licenses set status = $2, source = 'manual', valid_from = null, valid_until = null where institution_id = $1`, [inst, status]);
const doc = (name: string, extra: Obj = {}) => JSON.stringify({ name, eye: {}, elements: [], ...extra });
const insertSim = (uid: string, id: string, extra: Obj = {}) =>
  h.asUser(uid, () =>
    h.rows<Obj>(
      `insert into public.user_simulations (id, name, doc, owner_user_id, institution_id, created_at, updated_at, origin)
       values ($1, $2, $3::jsonb, coalesce($4::uuid, auth.uid()), coalesce($5::uuid, public.my_institution_id()), coalesce($6::timestamptz, now()), coalesce($7::timestamptz, now()), $8)
       returning id, owner_user_id, institution_id, doc_revision, created_at, updated_at`,
      [id, extra.name ?? id, doc(extra.name ?? id), extra.owner ?? null, extra.institution ?? null, extra.created ?? null, extra.updated ?? null, extra.origin ?? null],
    ),
  );

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  anna = await h.register('anna@privat.de', { first_name: 'Anna', institution_type: 'private' });
  bert = await h.register('bert@optik.de', { first_name: 'Bert', institution_type: 'business', institution_name: 'Optik Bert', address_line_1: 'Weg 1', postal_code: '1', city: 'X', country: 'DE' });
  annaInst = await h.institutionOf(anna);
  bertInst = await h.institutionOf(bert);
}, 60000);

describe('Cloud-Inhalte: Zuordnung und Rechte', () => {
  it('ohne Lizenz kann nichts gespeichert werden (Lesen ist erlaubt)', async () => {
    expect(await code(() => insertSim(anna, 'sim_nolicense'))).toBe('OLL01');
    expect(await h.asUser(anna, () => h.rows('select * from public.user_simulations'))).toEqual([]);
  });

  it('mit Lizenz: Besitzer und Institution setzt der Server – nie der Browser', async () => {
    await setLicense(annaInst, 'active');
    await setLicense(bertInst, 'active');
    const r = await insertSim(anna, 'sim_anna1', { owner: bert, institution: bertInst });
    expect(r[0]).toMatchObject({ owner_user_id: anna, institution_id: annaInst, doc_revision: 1 });
  });

  it('fremde Konten sehen, ändern und löschen nichts', async () => {
    expect(await h.asUser(bert, () => h.rows('select id from public.user_simulations'))).toEqual([]);
    const upd = await h.asUser(bert, () => h.rows(`update public.user_simulations set name = 'gehackt' where id = 'sim_anna1' returning id`));
    expect(upd).toEqual([]);
    const del = await h.asUser(bert, () => h.rows(`delete from public.user_simulations where id = 'sim_anna1' returning id`));
    expect(del).toEqual([]);
    expect(await code(() => insertSim(bert, 'sim_anna1'))).toBe('23505');
    expect(await h.asUser(null, () => h.fails('select * from public.user_simulations'))).toBe(true);
    const own = await h.asUser(anna, () => h.rows<Obj>('select id, name from public.user_simulations'));
    expect(own).toEqual([{ id: 'sim_anna1', name: 'sim_anna1' }]);
  });

  it('Besitzer/Institution sind unveränderlich', async () => {
    expect(await code(() => h.asUser(anna, () => db.query(`update public.user_simulations set owner_user_id = $1 where id = 'sim_anna1'`, [bert])))).not.toBeNull();
    expect(await code(() => h.asUser(anna, () => db.query(`update public.user_simulations set institution_id = $1 where id = 'sim_anna1'`, [bertInst])))).toBe('42501');
  });

  it('Revision: Dokumentänderung erhöht sie, Favorit/zuletzt geöffnet nicht; bedingtes Speichern erkennt Konflikte', async () => {
    const before = (await h.rows<Obj>(`select doc_revision, updated_at from public.user_simulations where id = 'sim_anna1'`))[0];
    await h.asUser(anna, () => db.query(`update public.user_simulations set favorite = true, last_opened_at = now() where id = 'sim_anna1'`));
    const fav = (await h.rows<Obj>(`select doc_revision, updated_at, favorite from public.user_simulations where id = 'sim_anna1'`))[0];
    expect(fav).toMatchObject({ doc_revision: before.doc_revision, favorite: true });
    expect(fav.updated_at).toEqual(before.updated_at);
    // Gerät A speichert (Revision 1 → 2)
    const a = await h.asUser(anna, () => h.rows<Obj>(`update public.user_simulations set doc = $1::jsonb where id = 'sim_anna1' and doc_revision = 1 returning doc_revision`, [doc('A')]));
    expect(a).toEqual([{ doc_revision: 2 }]);
    // Gerät B speichert mit veraltetem Stand → keine Zeile → Konflikt, nichts überschrieben
    const b = await h.asUser(anna, () => h.rows<Obj>(`update public.user_simulations set doc = $1::jsonb where id = 'sim_anna1' and doc_revision = 1 returning doc_revision`, [doc('B')]));
    expect(b).toEqual([]);
    expect((await h.rows<Obj>(`select doc->>'name' as n from public.user_simulations where id = 'sim_anna1'`))[0].n).toBe('A');
  });

  it('Übernahme lokaler Daten behält ursprüngliche Zeitpunkte – nie in der Zukunft', async () => {
    const r = await insertSim(anna, 'sim_alt', { created: '2025-01-02T10:00:00Z', updated: '2025-03-04T10:00:00Z', origin: 'local-migration' });
    expect(new Date(r[0].created_at).toISOString()).toBe('2025-01-02T10:00:00.000Z');
    expect(new Date(r[0].updated_at).toISOString()).toBe('2025-03-04T10:00:00.000Z');
    const f = await insertSim(anna, 'sim_future', { created: '2099-01-01T00:00:00Z', updated: '2099-01-01T00:00:00Z' });
    expect(new Date(f[0].created_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('Vorlagen und Einstellungen: nur eigene', async () => {
    await h.asUser(anna, () => db.query(`insert into public.user_templates (id, name, doc) values ('tpl_anna', 'Meine Vorlage', '{}'::jsonb)`));
    expect(await h.asUser(bert, () => h.rows('select id from public.user_templates'))).toEqual([]);
    await h.asUser(anna, () => db.query(`insert into public.user_preferences (prefs) values ('{"theme":"light"}'::jsonb) on conflict (user_id) do update set prefs = excluded.prefs`));
    expect(await code(() => h.asUser(bert, () => db.query(`insert into public.user_preferences (user_id, prefs) values ($1, '{}'::jsonb)`, [anna])))).not.toBeNull();
    expect(await h.asUser(bert, () => h.rows('select * from public.user_preferences'))).toEqual([]);
    expect((await h.asUser(anna, () => h.rows<Obj>('select prefs from public.user_preferences')))[0].prefs).toEqual({ theme: 'light' });
  });

  it('vorbereitet für mehrere Benutzer je Institution: „institution“-Inhalte sind für Kollegen lesbar, „private“ nicht', async () => {
    const carl = await h.register('carl@optik.de', { first_name: 'Carl', institution_type: 'private' });
    await db.query(`update public.profiles set institution_id = $1 where user_id = $2`, [bertInst, carl]);
    await insertSim(bert, 'sim_bert_priv');
    await insertSim(bert, 'sim_bert_team');
    await h.asUser(bert, () => db.query(`update public.user_simulations set visibility = 'institution' where id = 'sim_bert_team'`));
    const seen = await h.asUser(carl, () => h.rows<Obj>('select id from public.user_simulations order by id'));
    expect(seen.map((r) => r.id)).toEqual(['sim_bert_team']);
    expect(await h.asUser(carl, () => h.rows(`update public.user_simulations set name = 'x' where id = 'sim_bert_team' returning id`))).toEqual([]);
  });
});

describe('Lizenz endet → Daten bleiben; Neubuchung → Daten wieder nutzbar', () => {
  it('abgelaufene Lizenz: lesen ja, speichern nein, nichts wird gelöscht', async () => {
    await setLicense(annaInst, 'expired');
    const list = await h.asUser(anna, () => h.rows<Obj>('select id from public.user_simulations order by id'));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(await code(() => insertSim(anna, 'sim_after_end'))).toBe('OLL01');
    expect(await code(() => h.asUser(anna, () => db.query(`update public.user_simulations set name = 'neu' where id = 'sim_anna1'`)))).toBe('OLL01');
    await setLicense(annaInst, 'cancelled');
    expect((await h.asUser(anna, () => h.rows('select id from public.user_simulations'))).length).toBe(list.length);
  });
  it('erneute Lizenz: dieselben Inhalte sind wieder bearbeitbar', async () => {
    await setLicense(annaInst, 'active');
    const r = await h.asUser(anna, () => h.rows<Obj>(`update public.user_simulations set name = 'wieder da' where id = 'sim_anna1' returning name`));
    expect(r).toEqual([{ name: 'wieder da' }]);
  });
});

describe('Konto schließen und wieder öffnen', () => {
  it('mit laufendem, ungekündigtem Abo nicht möglich', async () => {
    await db.query(`insert into public.subscriptions (institution_id, stripe_subscription_id, status, plan, current_period_end) values ($1, 'sub_bert', 'active', 'business', now() + interval '20 days')`, [bertInst]);
    expect(await code(() => h.asUser(bert, () => db.query('select public.close_my_account()')))).toBe('OLA01');
    const o = (await h.asUser(bert, () => h.rows<Obj>('select public.my_account_overview() as o')))[0].o;
    expect(o).toMatchObject({ live_subscription: true, can_close: false, can_delete: false });
  });
  it('schließen: kein Speichern mehr, Inhalte bleiben 12 Monate; wieder öffnen stellt alles her', async () => {
    const o = (await h.asUser(anna, () => h.rows<Obj>('select public.close_my_account() as o')))[0].o;
    expect(o.account_status).toBe('closed');
    const due = new Date(o.deletion_due_at).getTime();
    expect(Math.round((due - Date.now()) / 86400000)).toBeGreaterThanOrEqual(364);
    expect(o.simulations).toBeGreaterThanOrEqual(3);
    expect(await code(() => insertSim(anna, 'sim_closed'))).toBe('OLL01');
    expect((await h.asUser(anna, () => h.rows('select id from public.user_simulations'))).length).toBeGreaterThanOrEqual(3);
    // Status nicht direkt änderbar
    expect(await code(() => h.asUser(anna, () => db.query(`update public.profiles set account_status = 'active' where user_id = auth.uid()`)))).not.toBeNull();
    const r = (await h.asUser(anna, () => h.rows<Obj>('select public.reopen_my_account() as o')))[0].o;
    expect(r).toMatchObject({ account_status: 'active', deletion_due_at: null });
    expect(await insertSim(anna, 'sim_reopened')).toHaveLength(1);
  });
});

describe('E-Mail-Änderung', () => {
  it('neue Adresse aus Supabase Auth wird ins Profil übernommen', async () => {
    await db.query(`update auth.users set email = 'anna.neu@privat.de' where id = $1`, [anna]);
    expect((await h.rows<Obj>('select email from public.profiles where user_id = $1', [anna]))[0].email).toBe('anna.neu@privat.de');
  });
});

describe('Endgültige Löschung', () => {
  it('nur serverseitig (service_role); nicht mit laufendem Abo', async () => {
    expect(await code(() => h.asUser(anna, () => db.query(`select public.delete_account_data($1, 'self')`, [anna])))).toBe('42501');
    expect(await code(() => h.asService(() => db.query(`select public.delete_account_data($1, 'self')`, [bert])))).toBe('OLA01');
  });
  it('entfernt Inhalte und Stammdaten, behält nur Nachweise; wiederholbar', async () => {
    await db.query(`update public.institutions set name = 'Anna Privat', address_line_1 = 'Str. 1', city = 'Ort' where id = $1`, [annaInst]);
    const r = (await h.asService(() => h.rows<Obj>(`select public.delete_account_data($1, 'self') as r`, [anna])))[0].r;
    expect(r).toMatchObject({ ok: true, email: 'anna.neu@privat.de' });
    expect(await h.rows('select id from public.user_simulations where owner_user_id = $1', [anna])).toEqual([]);
    expect(await h.rows('select id from public.user_templates where owner_user_id = $1', [anna])).toEqual([]);
    expect(await h.rows('select * from public.user_preferences where user_id = $1', [anna])).toEqual([]);
    expect(await h.rows('select * from public.profiles where user_id = $1', [anna])).toEqual([]);
    const inst = (await h.rows<Obj>('select name, address_line_1, city from public.institutions where id = $1', [annaInst]))[0];
    expect(inst).toEqual({ name: 'Gelöschtes Konto', address_line_1: null, city: null });
    const proof = (await h.rows<Obj>('select email_sha256, initiated_by, retain_until from public.deleted_accounts where former_user_id = $1', [anna]))[0];
    expect(proof.email_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.email_sha256).not.toContain('anna');
    expect(proof.initiated_by).toBe('self');
    // zweiter Aufruf (z. B. nach Fehler beim Löschen des Auth-Benutzers): nichts mehr zu tun
    expect((await h.asService(() => h.rows<Obj>(`select public.delete_account_data($1, 'self') as r`, [anna])))[0].r).toMatchObject({ already_deleted: true });
    // Auth-Benutzer löschen (Edge Function): Nachweistabellen verlieren nur den Bezug
    await db.query('delete from auth.users where id = $1', [anna]);
    expect(await h.rows('select * from public.deleted_accounts where former_user_id = $1', [anna])).toHaveLength(1);
  });
  it('Nachweise sind für Browser-Rollen nicht lesbar', async () => {
    expect(await h.asUser(bert, () => h.fails('select * from public.deleted_accounts'))).toBe(true);
  });
});

/* ------------------------------ Edge Function delete-account ------------------------------ */
import { FakeMailer, FakeStripe, pgAccountDb, pgBillingDb, pgOpsDb } from './stripeHarness';
import { handleDeleteAccount } from '../../supabase/functions/_shared/accountOps';
import type { Deps } from '../../supabase/functions/_shared/handlers';

describe('Edge Function delete-account', () => {
  const stripe = new FakeStripe();
  const mailer = new FakeMailer();
  let caller: { id: string; email: string; issuedAt?: number } | null = null;
  const deps = (): Deps => ({ env: (k) => ({ STRIPE_SECRET_KEY: 'sk_test_x', SITE_URL: 'https://olo-lab.de' })[k], authUser: async () => caller, db: pgBillingDb(db, h), ops: pgOpsDb(db, h), accountDb: pgAccountDb(db, h), mailer, stripe });
  const call = async (body: Obj) => {
    const res = await handleDeleteAccount(new Request('https://fn.test', { method: 'POST', headers: { Origin: 'https://olo-lab.de' }, body: JSON.stringify(body) }), deps());
    return { status: res.status, body: (await res.json()) as Obj };
  };
  const fresh = () => Math.floor(Date.now() / 1000) - 30;
  let dora = '';
  let doraInst = '';

  beforeAll(async () => {
    dora = await h.register('dora@web.de', { first_name: 'Dora', last_name: 'Demo', institution_type: 'private' });
    doraInst = await h.institutionOf(dora);
    await setLicense(doraInst, 'active');
    await insertSim(dora, 'sim_dora');
    await db.query('insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, $2)', [doraInst, 'cus_dora']);
  });

  it('ohne Anmeldung, ohne Bestätigungswort oder mit alter Anmeldung: nichts passiert', async () => {
    caller = null;
    expect((await call({ confirm: 'LÖSCHEN' })).status).toBe(401);
    caller = { id: dora, email: 'dora@web.de', issuedAt: fresh() };
    expect((await call({ confirm: 'ja' })).body.code).toBe('confirm_required');
    caller = { id: dora, email: 'dora@web.de', issuedAt: Math.floor(Date.now() / 1000) - 3600 };
    expect((await call({ confirm: 'LÖSCHEN' })).body.code).toBe('reauth_required');
    expect(await h.rows('select id from public.user_simulations where owner_user_id = $1', [dora])).toHaveLength(1);
  });

  it('fremdes Konto nur durch Super-Admin', async () => {
    caller = { id: bert, email: 'bert@optik.de', issuedAt: fresh() };
    expect((await call({ confirm: 'LÖSCHEN', targetUserId: dora })).status).toBe(403);
  });

  it('laufendes, ungekündigtes Abo verhindert die Löschung mit klarer Meldung', async () => {
    await db.query(`insert into public.subscriptions (institution_id, stripe_subscription_id, status, plan) values ($1, 'sub_dora', 'active', 'private')`, [doraInst]);
    caller = { id: dora, email: 'dora@web.de', issuedAt: fresh() };
    const r = await call({ confirm: 'löschen' });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('kündigen Sie es zuerst');
    await db.query(`update public.subscriptions set cancel_at_period_end = true where stripe_subscription_id = 'sub_dora'`);
  });

  it('eigenes Konto: Inhalte und Stammdaten weg, Auth-Benutzer gelöscht, Stripe-Kunde markiert, Bestätigung per E-Mail', async () => {
    caller = { id: dora, email: 'dora@web.de', issuedAt: fresh() };
    const r = await call({ confirm: 'LÖSCHEN' });
    expect(r).toEqual({ status: 200, body: { ok: true, alreadyDeleted: false } });
    expect(await h.rows('select id from public.user_simulations where owner_user_id = $1', [dora])).toEqual([]);
    expect(await h.rows('select id from auth.users where id = $1', [dora])).toEqual([]);
    expect(await h.rows('select * from public.deleted_accounts where former_user_id = $1', [dora])).toHaveLength(1);
    expect(stripe.calls.find((c) => c.path === 'customers/cus_dora' && c.method === 'POST')?.params['metadata[account_deleted]']).toBeTruthy();
    const m = mailer.sent.find((x) => x.to === 'dora@web.de')!;
    expect(m.subject).toBe('Ihr OLO-LAB3D-Konto wurde gelöscht');
    expect(m.text).toContain('Guten Tag Dora Demo,');
    // erneuter Aufruf (z. B. Doppelklick) schadet nicht
    expect((await call({ confirm: 'LÖSCHEN' })).body).toMatchObject({ ok: true, alreadyDeleted: true });
  });
});
