/**
 * Gewähltes Paket über Registrierung / E-Mail-Bestätigung / Login hinweg merken (Phase 8).
 * Reine Komfortfunktion für den Ablauf „Paket wählen → Konto erstellen → bezahlen/Demo starten“.
 * Sicherheitsrelevant ist nichts davon: Preis, Berechtigung und Zustimmungen prüft der Server.
 */
import type { BillingInterval, LicensePlan } from './types';

export type PlanIntent = { plan: LicensePlan | 'demo'; interval: BillingInterval };

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

export function saveIntent(i: PlanIntent | null): void {
  try {
    if (!i) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...i, at: Date.now() }));
  } catch {
    /* Speicher nicht verfügbar – Ablauf funktioniert dann über die URL */
  }
}

export function loadIntent(): PlanIntent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlanIntent & { at?: number };
    if (!v.at || Date.now() - v.at > TTL_MS) return null;
    return parseIntent(v.plan, v.interval);
  } catch {
    return null;
  }
}
