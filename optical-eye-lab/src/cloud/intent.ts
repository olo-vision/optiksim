/**
 * Gewähltes Paket über Registrierung / E-Mail-Bestätigung / Login hinweg merken (Phase 8).
 * Reine Komfortfunktion für den Ablauf „Paket wählen → Konto erstellen → bezahlen/Demo starten“.
 * Sicherheitsrelevant ist nichts davon: Preis, Berechtigung und Zustimmungen prüft der Server.
 */
import type { BillingInterval, LicensePlan } from './types';

export type PlanIntent = { plan: LicensePlan | 'demo'; interval: BillingInterval; /** Konto, für das die Wahl getroffen wurde (bei der Registrierung) */ email?: string };

const KEY = 'olo-plan-intent';
const TTL_MS = 24 * 60 * 60 * 1000;
const PLANS = ['private', 'business', 'education', 'demo'];

export function parseIntent(plan: string | null | undefined, interval?: string | null): PlanIntent | null {
  if (!plan || !PLANS.includes(plan)) return null;
  return { plan: plan as PlanIntent['plan'], interval: interval === 'yearly' ? 'yearly' : 'monthly' };
}

export function intentQuery(i: PlanIntent): string {
  return i.plan === 'demo' ? 'plan=demo' : `plan=${i.plan}&interval=${i.interval}`;
}

export function saveIntent(i: PlanIntent | null, email?: string): void {
  try {
    if (!i) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ plan: i.plan, interval: i.interval, ...(email ? { email: email.trim().toLowerCase() } : i.email ? { email: i.email } : {}), at: Date.now() }));
  } catch {
    /* Speicher nicht verfügbar – Ablauf funktioniert dann über die URL */
  }
}

/**
 * Gemerkte Paketwahl. Mit currentEmail nur, wenn sie zu diesem Konto gehört: eine bei der Registrierung
 * gespeicherte Wahl gilt nur für genau dieses Konto; eine Demo-Wahl ohne Kontobezug wird nie für ein
 * anderes (bestehendes) Konto übernommen – so startet niemand versehentlich die Demo eines Dritten.
 */
export function loadIntent(currentEmail?: string | null): PlanIntent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlanIntent & { at?: number };
    if (!v.at || Date.now() - v.at > TTL_MS) return null;
    const i = parseIntent(v.plan, v.interval);
    if (!i) return null;
    if (currentEmail !== undefined) {
      const me = (currentEmail ?? '').trim().toLowerCase();
      if (v.email ? v.email !== me : i.plan === 'demo') return null;
    }
    return v.email ? { ...i, email: v.email } : i;
  } catch {
    return null;
  }
}

/** Beim Abmelden: gemerkte Paketwahl verwerfen */
export function clearIntent(): void {
  saveIntent(null);
}
