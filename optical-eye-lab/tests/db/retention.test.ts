/// <reference types="node" />
/**
 * 0.10.1 – Aufbewahrung von Kundenkonten (Betreiberentscheidung 30.09.2026):
 *  - Lizenzende/Kündigung löscht NIE etwas.
 *  - Nur ausdrücklich geschlossene Konten werden nach 12 Monaten automatisch gelöscht – nach einer
 *    Erinnerungs-E-Mail mindestens 14 Tage vorher.
 *  - Admin-Center: Lizenz abgelaufen · Konto geschlossen (Löschung fällig am …) · Löschung beantragt.
 * Gegen echtes PostgreSQL (PGlite) inklusive Edge-Logik (mail-jobs + runAccountRetention).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, helpers } from './pg';
import { FakeMailer, FakeStripe, pgAccountDb, pgBillingDb, pgOpsDb } from './stripeHarness';
import { runAccountRetention } from '../../supabase/functions/_shared/accountOps';
import { handleMailJobs } from '../../supabase/functions/_shared/legalOps';
import type { Deps } from '../../supabase/functions/_shared/handlers';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: PGlite;
let h: ReturnType<typeof helpers>;
const users: Record<string, { id: string; inst: string }> = {};
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};

const stripe = new FakeStripe();
const mailer = new FakeMailer();
let env: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_x', SITE_URL: 'https://olo-lab.de', CRON_SECRET: 'cron-secret-0123456789' };
const deps = (): Deps => ({ env: (k) => env[k], authUser: async () => null, db: pgBillingDb(db, h), ops: pgOpsDb(db, h), accountDb: pgAccountDb(db, h), mailer, stripe });

async function account(key: string, email: string) {
  const id = await h.register(email, { first_name: key, last_name: 'Test', institution_type: 'private' });
  const inst = await h.institutionOf(id);
  await db.query(`update public.licenses set status = 'active', source = 'manual' where institution_id = $1`, [inst]);
  await h.asUser(id, () => db.query(`insert into public.user_simulations (id, name, doc, institution_id) values ($1, $1, '{"eye":{},"elements":[]}'::jsonb, public.my_institution_id())`, [`sim_${key}`]));
  users[key] = { id, inst };
  return id;
}
const profile = async (key: string) => (await h.rows<Obj>('select * from public.profiles where user_id = $1', [users[key].id]))[0];
const simsOf = async (key: string) => (await h.rows('select id from public.user_simulations where owner_user_id = $1', [users[key].id])).length;
/** Zeit „vorspulen“: Zeitpunkte eines geschlossenen Kontos in die Vergangenheit verschieben */
const shift = (key: string, sql: string) => db.query(`update public.profiles set ${sql} where user_id = $1`, [users[key].id]);

beforeAll(async () => {
  db = await createDb();
  h = helpers(db);
  await account('lena', 'lena@web.de'); // Lizenz endet
  await account('carl', 'carl@web.de'); // schließt Konto
  await account('rita', 'rita@web.de'); // Löschantrag per E-Mail
  await account('otto', 'otto@web.de'); // geschlossen, aber E-Mail-Versand fällt aus
  const admin = await h.register('admin@olo-vision.de', { first_name: 'Admin', institution_type: 'private' });
  await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [admin]);
  users.admin = { id: admin, inst: await h.institutionOf(admin) };
}, 60000);

describe('Lizenzende ist kein Löschwunsch', () => {
  it('abgelaufene Lizenz: Konto bleibt aktiv, keine Frist, kein Kandidat für Erinnerung oder Löschung', async () => {
    await db.query(`update public.licenses set status = 'expired', valid_until = now() - interval '800 days' where institution_id = $1`, [users.lena.inst]);
    // auch sehr lange nach Vertragsende
    await db.query(`update auth.users set last_sign_in_at = now() - interval '900 days' where id = $1`, [users.lena.id]);
    const p = await profile('lena');
    expect(p).toMatchObject({ account_status: 'active', deletion_due_at: null });
    const cands = await h.asService(() => h.rows<Obj>('select user_id from public.retention_reminder_candidates(100000)'));
    const due = await h.asService(() => h.rows<Obj>('select user_id from public.retention_due_accounts(100)'));
    expect(cands.map((c) => c.user_id)).not.toContain(users.lena.id);
    expect(due.map((c) => c.user_id)).not.toContain(users.lena.id);
    const r = await runAccountRetention(deps());
    expect(r).toMatchObject({ retention: { deleted: 0 } });
    expect(await simsOf('lena')).toBe(1);
  });
  it('automatische Löschung eines nicht geschlossenen Kontos ist serverseitig ausgeschlossen (OLA02)', async () => {
    expect(await code(() => h.asService(() => db.query(`select public.delete_account_data($1, 'retention')`, [users.lena.id])))).toBe('OLA02');
    expect(await simsOf('lena')).toBe(1);
  });
});

describe('Geschlossenes Konto: 12 Monate, Erinnerung, automatische Löschung', () => {
  it('schließen setzt die Frist; vor Fristnähe keine Erinnerung', async () => {
    await h.asUser(users.carl.id, () => db.query('select public.close_my_account()'));
    const p = await profile('carl');
    expect(p.account_status).toBe('closed');
    expect(Math.round((new Date(p.deletion_due_at).getTime() - Date.now()) / 86400000)).toBeGreaterThanOrEqual(364);
    const cands = await h.asService(() => h.rows<Obj>('select user_id from public.retention_reminder_candidates(30)'));
    expect(cands.map((c) => c.user_id)).not.toContain(users.carl.id);
  });

  it('30 Tage vor Fristende: Erinnerungs-E-Mail, danach nicht erneut', async () => {
    await shift('carl', `deletion_due_at = now() + interval '20 days'`);
    const sentBefore = mailer.sent.length;
    const r = await runAccountRetention(deps());
    expect(r).toMatchObject({ retention: { reminded: 1, deleted: 0 } });
    const m = mailer.sent.slice(sentBefore).find((x) => x.to === 'carl@web.de')!;
    expect(m.subject).toMatch(/^Ihr geschlossenes OLO-LAB3D-Konto wird am .+ gelöscht$/);
    expect(m.text).toContain('wieder');
    expect(m.text).toContain('Alle exportieren');
    expect((await profile('carl')).deletion_reminder_sent_at).not.toBeNull();
    const again = await runAccountRetention(deps());
    expect(again).toMatchObject({ retention: { reminded: 0 } });
    expect((await h.rows<Obj>(`select count(*)::int as n from public.system_mails where kind = 'account_deletion_reminder' and recipient = 'carl@web.de'`))[0].n).toBe(1);
  });

  it('Frist abgelaufen, aber Erinnerung erst vor < 14 Tagen: noch keine Löschung', async () => {
    await shift('carl', `deletion_due_at = now() - interval '1 day', deletion_reminder_sent_at = now() - interval '5 days'`);
    expect(await code(() => h.asService(() => db.query(`select public.delete_account_data($1, 'retention')`, [users.carl.id])))).toBe('OLA02');
    const r = await runAccountRetention(deps());
    expect(r).toMatchObject({ retention: { due: 0, deleted: 0 } });
    expect(await simsOf('carl')).toBe(1);
  });

  it('wieder öffnen innerhalb der Frist: alles bleibt, Erinnerung zurückgesetzt', async () => {
    await h.asUser(users.carl.id, () => db.query('select public.reopen_my_account()'));
    expect(await profile('carl')).toMatchObject({ account_status: 'active', deletion_due_at: null, deletion_reminder_sent_at: null });
    await h.asUser(users.carl.id, () => db.query('select public.close_my_account()'));
    expect((await profile('carl')).deletion_reminder_sent_at).toBeNull();
  });

  it('Frist abgelaufen und rechtzeitig erinnert: automatische Löschung mit Nachweis und Bestätigung', async () => {
    await db.query('insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, $2)', [users.carl.inst, 'cus_carl']);
    await shift('carl', `deletion_due_at = now() - interval '1 day', deletion_reminder_sent_at = now() - interval '31 days'`);
    const sentBefore = mailer.sent.length;
    const r = await runAccountRetention(deps());
    expect(r).toMatchObject({ retention: { due: 1, deleted: 1, skipped: 0 } });
    expect(await simsOf('carl')).toBe(0);
    expect(await h.rows('select 1 from public.profiles where user_id = $1', [users.carl.id])).toEqual([]);
    expect(await h.rows('select 1 from auth.users where id = $1', [users.carl.id])).toEqual([]);
    expect((await h.rows<Obj>('select initiated_by from public.deleted_accounts where former_user_id = $1', [users.carl.id]))[0].initiated_by).toBe('retention');
    expect((await h.rows<Obj>('select name from public.institutions where id = $1', [users.carl.inst]))[0].name).toBe('Gelöschtes Konto');
    // Rechnungsbezug bleibt (Stripe-Kunde), wird nur markiert
    expect(await h.rows('select 1 from public.billing_customers where stripe_customer_id = $1', ['cus_carl'])).toHaveLength(1);
    expect(stripe.calls.some((c) => c.path === 'customers/cus_carl' && c.method === 'POST')).toBe(true);
    const m = mailer.sent.slice(sentBefore).find((x) => x.to === 'carl@web.de')!;
    expect(m.subject).toBe('Ihr OLO-LAB3D-Konto wurde gelöscht');
    expect(m.text).toContain('seit 12 Monaten geschlossen');
  });

  it('ohne erfolgreich versendete Erinnerung wird nie automatisch gelöscht', async () => {
    await h.asUser(users.otto.id, () => db.query('select public.close_my_account()'));
    await shift('otto', `deletion_due_at = now() - interval '60 days'`);
    const offline = { ...deps(), mailer: { configured: false, notifyTo: null, send: async () => undefined } as unknown as Deps['mailer'] };
    const r = await runAccountRetention(offline);
    expect(r).toMatchObject({ retention: { reminded: 0, deleted: 0 } });
    expect(await simsOf('otto')).toBe(1);
    expect((await profile('otto')).deletion_reminder_sent_at).toBeNull();
  });

  it('abschaltbar mit ACCOUNT_AUTO_DELETE=off', async () => {
    env = { ...env, ACCOUNT_AUTO_DELETE: 'off' };
    expect(await runAccountRetention(deps())).toEqual({ disabled: true });
    env = { ...env, ACCOUNT_AUTO_DELETE: '' };
  });

  it('mail-jobs führt den Aufbewahrungs-Job mit aus', async () => {
    const res = await handleMailJobs(new Request('https://fn.test', { method: 'POST', headers: { 'x-cron-secret': 'cron-secret-0123456789' } }), deps(), { retention: runAccountRetention });
    const body = (await res.json()) as Obj;
    expect(res.status).toBe(200);
    expect(body.retention).toMatchObject({ retention: { reminded: 1 } }); // otto (jetzt mit Mailversand)
  });

  it('Job-Funktionen sind für Browser-Rollen gesperrt', async () => {
    for (const sql of ['select * from public.retention_reminder_candidates(30)', 'select * from public.retention_due_accounts(10)', `select public.retention_mark_reminded('${users.otto.id}')`]) {
      expect(await h.asUser(users.otto.id, () => h.fails(sql))).toBe(true);
    }
  });
});

describe('Admin-Center: Lebenszyklus', () => {
  it('nur Super-Admins', async () => {
    expect(await code(() => h.asUser(users.rita.id, () => db.query('select * from public.admin_account_lifecycle()')))).toBe('42501');
    expect(await code(() => h.asUser(users.rita.id, () => db.query('select public.admin_set_deletion_request($1, true, null)', [users.rita.id])))).toBe('42501');
  });
  it('unterscheidet Lizenz abgelaufen · Konto geschlossen (mit Datum) · Löschung beantragt', async () => {
    await h.asUser(users.admin.id, () => db.query(`select public.admin_set_deletion_request($1, true, 'E-Mail vom 30.09., Identität geprüft')`, [users.rita.id]));
    const rows = await h.asUser(users.admin.id, () => h.rows<Obj>('select category, email, deletion_due_at, deletion_reminder_sent_at, deletion_requested_at, deletion_request_note, simulations from public.admin_account_lifecycle()'));
    const by = (email: string) => rows.find((r) => r.email === email);
    expect(by('lena@web.de')).toMatchObject({ category: 'license_ended', deletion_due_at: null });
    expect(by('otto@web.de')).toMatchObject({ category: 'closed' });
    expect(by('otto@web.de')!.deletion_due_at).not.toBeNull();
    expect(by('rita@web.de')).toMatchObject({ category: 'deletion_requested', deletion_request_note: 'E-Mail vom 30.09., Identität geprüft' });
    // aktive Konten ohne Besonderheit erscheinen nicht
    expect(by('admin@olo-vision.de')).toBeUndefined();
    // Reihenfolge: beantragt vor geschlossen vor Lizenz abgelaufen
    expect(rows.map((r) => r.category)).toEqual([...rows.map((r) => r.category)].sort((a, b) => ['deletion_requested', 'closed', 'license_ended'].indexOf(a) - ['deletion_requested', 'closed', 'license_ended'].indexOf(b)));
    // Antrag zurücknehmen
    await h.asUser(users.admin.id, () => db.query('select public.admin_set_deletion_request($1, false, null)', [users.rita.id]));
    const after = await h.asUser(users.admin.id, () => h.rows<Obj>('select email from public.admin_account_lifecycle()'));
    expect(after.map((r) => r.email)).not.toContain('rita@web.de');
  });
});
