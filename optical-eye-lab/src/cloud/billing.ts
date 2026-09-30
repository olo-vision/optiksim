/**
 * Abo-Hinweise und Checkout-Bestätigung (rein, testbar – ohne React).
 */
import { formatDate } from './plans';
import type { CloudAccount } from './types';

/** Wartezeiten zwischen den Statusabfragen nach dem Checkout: wachsend, begrenzt (~54 s), kein Dauer-Polling */
export const CONFIRM_BACKOFF_MS = [1500, 2500, 4000, 6000, 9000, 13000, 18000];

/** Hinweis bei fehlgeschlagener Zahlung bzw. gekündigtem Abo (null, wenn nichts zu melden ist) */
export function billingNotice(account: CloudAccount | null, now: Date = new Date()): { tone: 'warn' | 'info'; text: string; testId: string } | null {
  const l = account?.license;
  const b = account?.billing;
  if (!l) return null;
  if (l.status === 'past_due' && l.source !== 'manual') {
    return {
      tone: 'warn',
      testId: 'grace-note',
      text: l.gracePeriodUntil
        ? `Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihr Zahlungsmittel bis ${formatDate(l.gracePeriodUntil)} – danach wird die Lizenz gesperrt.`
        : 'Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihr Zahlungsmittel.',
    };
  }
  if (l.status === 'suspended' && l.source !== 'manual') {
    return { tone: 'warn', testId: 'suspended-note', text: 'Ihre Lizenz ist gesperrt, weil eine Zahlung offen ist. Aktualisieren Sie Ihr Zahlungsmittel, um den Zugriff sofort wiederherzustellen.' };
  }
  if (l.status === 'active' && b?.cancelAtPeriodEnd) {
    const end = l.validUntil ?? b.cancelAt ?? b.currentPeriodEnd;
    // private Jahreslizenz: endet planmäßig (keine Verlängerung) – Hinweis erst in den letzten 30 Tagen
    if (l.plan === 'private' && b.billingInterval === 'yearly') {
      const days = end ? (Date.parse(end) - now.getTime()) / 86400000 : Infinity;
      return days <= 30 ? { tone: 'info', testId: 'term-end-note', text: `Ihre Jahreslizenz endet am ${formatDate(end)} – sie verlängert sich nicht automatisch.` } : null;
    }
    return { tone: 'info', testId: 'cancel-note', text: `Gekündigt – Zugriff bis ${formatDate(end)}` };
  }
  return null;
}

