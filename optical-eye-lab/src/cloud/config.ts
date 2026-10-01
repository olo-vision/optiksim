/**
 * Konfiguration der SaaS-Schicht (Phase 6).
 *
 * Betriebsarten:
 *   'supabase' – echte Anmeldung und Lizenzprüfung über Supabase (Standard, sobald URL + Key gesetzt sind)
 *   'local'    – bisherige lokale Demo-Anmeldung (Phase 3), z. B. für Offline-Entwicklung und die
 *                bestehenden E2E-Tests; KEINE Lizenzprüfung
 *   'mock'     – Supabase-Ersatz im Browser (nur Tests/Entwicklung, deutlich gekennzeichnet)
 */
export type AuthMode = 'supabase' | 'local' | 'mock';

const env = import.meta.env;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_KEY = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();

function resolveMode(): AuthMode {
  const m = (env.VITE_AUTH_MODE ?? '').trim();
  if (m === 'local' || m === 'mock' || m === 'supabase') return m;
  return SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';
}

export const AUTH_MODE: AuthMode = resolveMode();
/**
 * Supabase „Secure email change“ (Auth → Providers → Email; Standard: an). Dann muss eine E-Mail-Änderung
 * über Links an die bisherige UND die neue Adresse bestätigt werden. Die Einstellung ist im Browser nicht
 * abfragbar; nur wenn sie im Dashboard ausgeschaltet wird, hier VITE_SECURE_EMAIL_CHANGE=off setzen,
 * damit die Hinweistexte stimmen.
 */
export const SECURE_EMAIL_CHANGE = (env.VITE_SECURE_EMAIL_CHANGE ?? '').trim().toLowerCase() !== 'off';
/** Anmeldung + Lizenzprüfung aktiv (Supabase oder Mock) */
export const CLOUD_ENABLED = AUTH_MODE !== 'local';

/**
 * Prüft die Konfiguration. Ein geheimer Schlüssel (service_role / sb_secret_) im Frontend wird
 * abgelehnt – er würde RLS vollständig umgehen.
 */
export function configProblem(url = SUPABASE_URL, key = SUPABASE_KEY, mode: AuthMode = AUTH_MODE): string | null {
  if (mode !== 'supabase') return null;
  if (!url || !key) return 'VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY sind nicht gesetzt.';
  if (!/^https:\/\/[^/]+$/.test(url.replace(/\/$/, '')) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) return 'VITE_SUPABASE_URL ist keine gültige URL (erwartet https://<projekt>.supabase.co).';
  if (key.startsWith('sb_secret_')) return 'Im Frontend ist ein geheimer Supabase-Schlüssel (sb_secret_…) eingetragen. Bitte den Publishable Key verwenden.';
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') return 'Im Frontend ist der service_role-Schlüssel eingetragen. Bitte den anon/Publishable Key verwenden.';
    } catch {
      /* kein JWT */
    }
  }
  return null;
}
