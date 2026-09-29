/// <reference types="node" />
/**
 * SaaS-Grundstruktur – Datenbank- und RLS-Tests gegen echtes PostgreSQL (PGlite, im Prozess).
 * Lädt einen Supabase-Nachbau (auth-Schema, Rollen, Standardrechte) und die Migration aus
 * supabase/migrations/ und prüft Registrierung, Lizenzlogik und Zugriffsschutz.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(__dirname, '..', '..', 'supabase');
let db: PGlite;

async function register(email: string, meta: Record<string, unknown>): Promise<string> {
  await db.exec('reset role');
  const r = await db.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify(meta)]);
  return r.rows[0].id;
}

/** Führt fn als angemeldeter Benutzer (Rolle authenticated, JWT-sub = uid) aus. */
async function asUser<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '']);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

let alice = '';
let bob = '';
let carol = '';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(root, 'tests', 'auth_stub.sql'), 'utf8'));
  for (const f of readdirSync(join(root, 'migrations')).filter((x: string) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  alice = await register('alice@optik.de', { first_name: 'Alice', last_name: 'Auge', institution_type: 'business', institution_name: 'Optik Auge GmbH', contact_name: 'Alice Auge', city: 'Berlin' });
  bob = await register('bob@schule.de', { first_name: 'Bob', last_name: 'Brille', institution_type: 'education', institution_name: 'Berufsschule Optik' });
  carol = await register('carol@privat.de', { first_name: 'Carol', last_name: 'Cornea', institution_type: 'private', role: 'super_admin', status: 'active' });
}, 60000);

describe('Registrierung (Trigger handle_new_user)', () => {
  it('legt Institution, Profil (institution_admin) und Lizenz (pending) an', async () => {
    const p = await rows<{ role: string; first_name: string; institution_id: string }>('select role, first_name, institution_id from public.profiles where user_id = $1', [alice]);
    expect(p).toHaveLength(1);
    expect(p[0].role).toBe('institution_admin');
    expect(p[0].first_name).toBe('Alice');
    const inst = await rows<{ type: string; name: string; city: string }>('select type, name, city from public.institutions where id = $1', [p[0].institution_id]);
    expect(inst[0]).toMatchObject({ type: 'business', name: 'Optik Auge GmbH', city: 'Berlin' });
    const lic = await rows<{ plan: string; status: string; max_locations: number }>('select plan, status, max_locations from public.licenses where institution_id = $1', [p[0].institution_id]);
    expect(lic).toEqual([{ plan: 'business', status: 'pending', max_locations: 1 }]);
    const log = await rows<{ action: string }>('select action from public.audit_logs where actor_user_id = $1', [alice]);
    expect(log[0].action).toBe('account.registered');
  });

  it('Privatkonto: eigene minimale Institution; Rolle/Status aus Metadaten werden ignoriert', async () => {
    const r = await rows<{ role: string; type: string; name: string; status: string }>(
      `select p.role, i.type, i.name, l.status from public.profiles p join public.institutions i on i.id = p.institution_id
       join public.licenses l on l.institution_id = i.id where p.user_id = $1`,
      [carol],
    );
    expect(r[0]).toMatchObject({ role: 'institution_admin', type: 'private', status: 'pending' });
    expect(r[0].name).toContain('Carol');
  });
});

describe('RLS: Lesen nur innerhalb der eigenen Institution', () => {
  it('eigenes Profil, eigene Institution, eigene Lizenz sichtbar', async () => {
    await asUser(alice, async () => {
      expect(await rows('select * from public.profiles')).toHaveLength(1);
      expect(await rows('select * from public.institutions')).toHaveLength(1);
      const lic = await rows<{ status: string }>('select status from public.licenses');
      expect(lic).toEqual([{ status: 'pending' }]);
    });
  });

  it('fremde Profile, Institutionen, Lizenzen und Audit-Logs sind unsichtbar', async () => {
    await asUser(bob, async () => {
      expect(await rows('select * from public.profiles where user_id = $1', [alice])).toHaveLength(0);
      expect(await rows(`select * from public.institutions where name = 'Optik Auge GmbH'`)).toHaveLength(0);
      const all = await rows<{ plan: string }>('select plan from public.licenses');
      expect(all).toEqual([{ plan: 'education' }]);
      expect(await rows('select * from public.audit_logs where actor_user_id = $1', [alice])).toHaveLength(0);
    });
  });

  it('nicht angemeldet (anon): keine Daten, nur der öffentliche Tarifkatalog', async () => {
    await asUser(null, async () => {
      expect(await fails('select * from public.profiles')).toBe(true);
      expect(await fails('select * from public.licenses')).toBe(true);
      const plans = await rows<{ plan: string; monthly_price_cents: number }>('select plan, monthly_price_cents from public.plan_catalog order by monthly_price_cents');
      expect(plans).toEqual([
        { plan: 'private', monthly_price_cents: 1990 },
        { plan: 'business', monthly_price_cents: 3990 },
        { plan: 'education', monthly_price_cents: 9990 },
      ]);
    });
  });
});

describe('RLS: keine Selbstfreischaltung, keine Rechteausweitung', () => {
  it('Lizenzstatus kann nicht selbst auf active gesetzt werden', async () => {
    await asUser(alice, async () => {
      expect(await fails(`update public.licenses set status = 'active'`)).toBe(true);
      expect(await fails(`insert into public.licenses (institution_id, plan, status) select id, 'business', 'active' from public.institutions`)).toBe(true);
      expect(await fails(`delete from public.licenses`)).toBe(true);
    });
    const lic = await rows<{ status: string }>(`select l.status from public.licenses l join public.profiles p on p.institution_id = l.institution_id where p.user_id = $1`, [alice]);
    expect(lic[0].status).toBe('pending');
  });

  it('Rolle kann nicht auf super_admin gesetzt werden; Institution nicht gewechselt', async () => {
    await asUser(alice, async () => {
      expect(await fails(`update public.profiles set role = 'super_admin' where user_id = auth.uid()`)).toBe(true);
      expect(await fails(`update public.profiles set institution_id = gen_random_uuid() where user_id = auth.uid()`)).toBe(true);
      // Name ändern ist erlaubt
      await db.query(`update public.profiles set first_name = 'Alicia' where user_id = auth.uid()`);
    });
    const p = await rows<{ role: string; first_name: string }>('select role, first_name from public.profiles where user_id = $1', [alice]);
    expect(p[0]).toEqual({ role: 'institution_admin', first_name: 'Alicia' });
  });

  it('Stripe-Felder und Abos sind schreibgeschützt; Institutionstyp unveränderlich', async () => {
    await asUser(alice, async () => {
      expect(await fails(`insert into public.subscriptions (institution_id, stripe_customer_id) select id, 'cus_x' from public.institutions`)).toBe(true);
      expect(await fails(`update public.institutions set type = 'education'`)).toBe(true);
      // Stammdaten der eigenen Institution darf der Institution-Admin ändern
      await db.query(`update public.institutions set city = 'Potsdam'`);
    });
    await asUser(bob, async () => {
      // fremde Institution: kein Treffer (RLS), keine Änderung
      await db.query(`update public.institutions set city = 'Hack' where name = 'Optik Auge GmbH'`);
    });
    const c = await rows<{ city: string }>(`select city from public.institutions where name = 'Optik Auge GmbH'`);
    expect(c[0].city).toBe('Potsdam');
  });

  it('Audit-Log kann nicht vom Frontend geschrieben werden', async () => {
    await asUser(alice, async () => {
      expect(await fails(`insert into public.audit_logs (action) values ('fake')`)).toBe(true);
    });
  });
});

describe('Super-Admin (gesonderter Weg über geprüfte Funktionen)', () => {
  it('normale Benutzer dürfen Admin-Funktionen nicht aufrufen', async () => {
    await asUser(alice, async () => {
      expect(await fails('select * from public.admin_list_accounts()')).toBe(true);
      expect(await fails(`select public.admin_set_license_status(gen_random_uuid(), 'active')`)).toBe(true);
    });
  });

  it('Super-Admin (serverseitig ernannt) sieht alle Konten und kann eine Lizenz aktivieren', async () => {
    await db.query(`update public.profiles set role = 'super_admin' where user_id = $1`, [carol]); // SQL-Editor / service_role
    const aliceLicense = (await rows<{ id: string }>(`select l.id from public.licenses l join public.profiles p on p.institution_id = l.institution_id where p.user_id = $1`, [alice]))[0].id;
    await asUser(carol, async () => {
      const list = await rows<{ email: string; license_status: string }>('select email, license_status from public.admin_list_accounts()');
      expect(list.map((r) => r.email).sort()).toEqual(['alice@optik.de', 'bob@schule.de', 'carol@privat.de']);
      await db.query(`select public.admin_set_license_status($1, 'active')`, [aliceLicense]);
    });
    await asUser(alice, async () => {
      expect(await rows('select status from public.licenses')).toEqual([{ status: 'active' }]);
      expect(await rows<{ has_active_license: boolean }>('select public.has_active_license()')).toEqual([{ has_active_license: true }]);
    });
    await asUser(bob, async () => {
      expect(await rows<{ has_active_license: boolean }>('select public.has_active_license()')).toEqual([{ has_active_license: false }]);
    });
  });

  it('Institution-Admin sieht die Profile der eigenen Institution, nicht fremde', async () => {
    const inst = (await rows<{ institution_id: string }>('select institution_id from public.profiles where user_id = $1', [alice]))[0].institution_id;
    // zweiter Benutzer derselben Institution (später über Einladung; hier serverseitig angelegt)
    const dave = await register('dave@optik.de', { first_name: 'Dave', institution_type: 'private' });
    await db.query(`update public.profiles set institution_id = $1, role = 'user' where user_id = $2`, [inst, dave]);
    await asUser(alice, async () => {
      expect((await rows<{ email: string }>('select email from public.profiles order by email')).map((r) => r.email)).toEqual(['alice@optik.de', 'dave@optik.de']);
    });
    await asUser(dave, async () => {
      // normaler Benutzer: nur das eigene Profil, keine Abos/Audit-Logs
      expect(await rows('select * from public.profiles')).toHaveLength(1);
      expect(await rows('select * from public.subscriptions')).toHaveLength(0);
      expect(await rows('select * from public.audit_logs')).toHaveLength(0);
      // aber die Lizenz der Institution ist lesbar (für die Freischaltung)
      expect(await rows('select status from public.licenses')).toEqual([{ status: 'active' }]);
    });
  });
});
