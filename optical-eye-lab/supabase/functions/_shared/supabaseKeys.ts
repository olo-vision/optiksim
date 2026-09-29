/**
 * Auswahl der Supabase-Schlüssel für die Edge Functions (reines TypeScript → auch in Vitest prüfbar).
 *
 * Aktuelle Supabase-Architektur: Die Edge Runtime stellt automatisch bereit
 *   SUPABASE_SECRET_KEYS       JSON {"default":"sb_secret_…", …}   → privilegierter Admin-Client
 *   SUPABASE_PUBLISHABLE_KEYS  JSON {"default":"sb_publishable_…"} → nur für die Identitätsprüfung
 * Legacy-Rückfall (nur falls die neuen Variablen fehlen): SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.
 *
 * Sicherheitsregeln:
 *  - Als Server-Schlüssel wird NUR ein Secret Key (sb_secret_…) bzw. ein legacy service_role-JWT akzeptiert –
 *    niemals ein Publishable/Anon-Key (der liefe als Rolle anon und würde still an Rechten scheitern).
 *  - Der Admin-Client bekommt NIE den Benutzer-JWT; dessen Rolle wäre sonst authenticated statt service_role.
 */
import type { EnvGetter } from './stripeConfig.ts';

export type ServerKey = { source: 'secret_keys'; name: string; key: string } | { source: 'legacy_service_role'; name: null; key: string };

export class KeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyConfigError';
  }
}

/** JSON-Schlüsselsatz ({"name":"key"}) lesen; ungültig/leer → {} */
export function parseKeySet(raw: string | undefined | null): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val.trim()) out[k] = val.trim();
    return out;
  } catch {
    return {};
  }
}

/** Nutzlast eines JWT lesen (ohne Prüfung – nur zur Einordnung von Schlüsseln) */
export function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** Server-Schlüssel für den Admin-Client: default-Secret, sonst erstes Secret, sonst legacy service_role */
export function resolveServerKey(env: EnvGetter): ServerKey {
  const set = parseKeySet(env('SUPABASE_SECRET_KEYS'));
  const name = set.default ? 'default' : Object.keys(set)[0];
  if (name) {
    const key = set[name];
    if (!key.startsWith('sb_secret_')) throw new KeyConfigError(`SUPABASE_SECRET_KEYS["${name}"] ist kein Secret Key (sb_secret_…).`);
    return { source: 'secret_keys', name, key };
  }
  const legacy = (env('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (legacy) {
    if (jwtRole(legacy) !== 'service_role') throw new KeyConfigError('SUPABASE_SERVICE_ROLE_KEY ist kein service_role-Schlüssel.');
    return { source: 'legacy_service_role', name: null, key: legacy };
  }
  throw new KeyConfigError('Kein Server-Schlüssel verfügbar (SUPABASE_SECRET_KEYS bzw. SUPABASE_SERVICE_ROLE_KEY fehlt).');
}

/** Öffentlicher Schlüssel – ausschließlich für die Identitätsprüfung beim Auth-Server */
export function resolvePublishableKey(env: EnvGetter): string {
  const set = parseKeySet(env('SUPABASE_PUBLISHABLE_KEYS'));
  const key = set.default ?? Object.values(set)[0] ?? (env('SUPABASE_ANON_KEY') ?? '').trim();
  if (!key) throw new KeyConfigError('Kein Publishable Key verfügbar (SUPABASE_PUBLISHABLE_KEYS bzw. SUPABASE_ANON_KEY fehlt).');
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') throw new KeyConfigError('Als Publishable Key ist ein geheimer Schlüssel eingetragen.');
  return key;
}

/** Bearer-Token aus dem Authorization-Header; API-Schlüssel (sb_…) gelten nicht als Benutzer-Token */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  if (!m) return null;
  const token = m[1];
  if (token.startsWith('sb_') || token.split('.').length !== 3) return null;
  return token;
}

/** Sichere Optionen für serverseitige Clients: keine Sitzung, keine fremden Header */
export const SERVER_CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: {} as Record<string, string> },
} as const;
