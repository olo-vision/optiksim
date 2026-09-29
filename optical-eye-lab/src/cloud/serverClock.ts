/**
 * Serverzeit im Browser (Phase 8).
 *
 * Alle Zeitprüfungen (Demo-Ende, Kündigung, Zahlungsfrist) laufen im Browser auf Basis der Serverzeit,
 * die bei jeder Kontoabfrage mitkommt (my_billing_status.server_now), fortgeschrieben mit einer
 * MONOTONEN Uhr (performance.now). Ein Verstellen der Systemuhr ändert die Rechnung daher nicht.
 * Die eigentliche Berechtigung prüft ohnehin der Server (valid_until / has_active_license).
 */
type Mono = () => number;

let base: { server: number; mono: number } | null = null;
let mono: Mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Serverzeit übernehmen (ISO-String aus der Datenbank) */
export function syncServerTime(serverIso: string | null | undefined): void {
  const t = serverIso ? Date.parse(serverIso) : NaN;
  if (Number.isFinite(t)) base = { server: t, mono: mono() };
}

/** aktuelle Serverzeit (ms); ohne Synchronisierung die Browserzeit */
export function serverNow(): number {
  return base ? base.server + (mono() - base.mono) : Date.now();
}

export const serverDate = () => new Date(serverNow());

/** Nur für Tests */
export function _setMonotonicClock(fn: Mono | null): void {
  mono = fn ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  base = null;
}
