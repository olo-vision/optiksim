/// <reference types="node" />
/**
 * Hilfen für Datenbanktests gegen echtes PostgreSQL (PGlite): Supabase-Nachbau + alle Migrationen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const supabaseDir = join(__dirname, '..', '..', 'supabase');

/**
 * @param legacyDefaults true = früheres Supabase-Verhalten (automatische Tabellenrechte für alle API-Rollen);
 *                       Standard false = aktuelles Verhalten (keine automatischen Tabellenrechte).
 */
export async function createDb(opts: { legacyDefaults?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(supabaseDir, 'tests', 'auth_stub.sql'), 'utf8'));
  if (opts.legacyDefaults) await db.exec(readFileSync(join(supabaseDir, 'tests', 'legacy_default_privileges.sql'), 'utf8'));
  for (const f of migrationFiles()) await db.exec(readFileSync(join(supabaseDir, 'migrations', f), 'utf8'));
  return db;
}

export const migrationFiles = () => readdirSync(join(supabaseDir, 'migrations')).filter((x: string) => x.endsWith('.sql')).sort();
export const readMigration = (f: string) => readFileSync(join(supabaseDir, 'migrations', f), 'utf8');

export function helpers(db: PGlite) {
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const fails = async (sql: string, params: unknown[] = []) => {
    try {
      await db.query(sql, params);
      return false;
    } catch {
      return true;
    }
  };
  async function register(email: string, meta: Record<string, unknown>): Promise<string> {
    await db.exec('reset role');
    const r = await db.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify(meta)]);
    return r.rows[0].id;
  }
  /** als angemeldeter Benutzer (authenticated) bzw. anon (uid = null) */
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
  /** als service_role (Edge Functions mit Server-Schlüssel) */
  async function asService<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec('set role service_role');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }
  const institutionOf = async (uid: string) => (await rows<{ institution_id: string }>('select institution_id from public.profiles where user_id = $1', [uid]))[0].institution_id;
  const licenseOf = async (uid: string) =>
    (
      await rows<{ id: string; status: string; plan: string; source: string; grace_period_until: Date | null; valid_until: Date | null }>(
        `select l.id, l.status, l.plan, l.source, l.grace_period_until, l.valid_until from public.licenses l
         join public.profiles p on p.institution_id = l.institution_id where p.user_id = $1 order by l.created_at desc limit 1`,
        [uid],
      )
    )[0];
  return { rows, fails, register, asUser, asService, institutionOf, licenseOf };
}
