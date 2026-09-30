/**
 * Transaktionale E-Mails – austauschbarer Versandweg.
 *
 * Die Fachlogik kennt nur das Interface `Mailer`. Welcher Versandweg dahintersteht, entscheidet allein
 * die Konfiguration (Function Secrets):
 *
 *   MAIL_TRANSPORT   smtp (Standard, sobald SMTP_HOST gesetzt ist) – später z. B. ein API-Dienst
 *   SMTP_HOST        z. B. der SMTP-Server von united-domains
 *   SMTP_PORT        465 (SSL/TLS). Supabase Edge Functions erlauben KEINE ausgehenden Verbindungen
 *                    auf Port 25 und 587.
 *   SMTP_USER        Postfach, z. B. info@olo-vision.de
 *   SMTP_PASSWORD    Passwort des Postfachs – NUR als Supabase-Secret, nie im Code/Git/Frontend
 *   MAIL_FROM        Absender, z. B. "OLO Vision <info@olo-vision.de>" (Standard: SMTP_USER)
 *   MAIL_NOTIFY_TO   interne Benachrichtigungen (Standard: Adresse aus MAIL_FROM)
 *
 * Fehlt die Konfiguration, ist der Mailer „nicht konfiguriert“: Versuche werden als „skipped“ protokolliert,
 * die eigentliche Verarbeitung (Kauf, Kündigung, Widerruf) läuft trotzdem weiter.
 */
import type { EnvGetter } from './stripeConfig.ts';

export interface MailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  readonly configured: boolean;
  /** Absenderadresse (ohne Namen) – für interne Benachrichtigungen */
  readonly notifyTo: string | null;
  send(message: MailMessage): Promise<void>;
}

export interface MailConfig {
  transport: 'smtp' | 'none';
  host: string | null;
  port: number;
  user: string | null;
  password: string | null;
  from: string | null;
  notifyTo: string | null;
  /** Hinweis bei ungeeigneter Konfiguration (z. B. gesperrter Port) */
  warning: string | null;
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
export const isEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 320 && EMAIL_RE.test(s.trim());

/** reine Adresse aus "Name <adresse>" */
export const addressOf = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const m = /<([^>]+)>/.exec(s);
  const a = (m ? m[1] : s).trim();
  return isEmail(a) ? a : null;
};

export function mailConfig(env: EnvGetter): MailConfig {
  const host = env('SMTP_HOST')?.trim() || null;
  const user = env('SMTP_USER')?.trim() || null;
  const password = env('SMTP_PASSWORD') || null;
  const port = Number(env('SMTP_PORT') ?? 465) || 465;
  const from = env('MAIL_FROM')?.trim() || user;
  const notifyTo = addressOf(env('MAIL_NOTIFY_TO')) ?? addressOf(from);
  const wanted = (env('MAIL_TRANSPORT') ?? 'smtp').trim().toLowerCase();
  const complete = !!(host && user && password && addressOf(from));
  const warning = port === 25 || port === 587 ? `SMTP_PORT ${port} ist in Supabase Edge Functions gesperrt – bitte 465 (SSL/TLS) verwenden.` : null;
  return { transport: wanted === 'smtp' && complete ? 'smtp' : 'none', host, port, user, password, from, notifyTo, warning };
}

/** Mailer ohne Versand (fehlende Konfiguration, Tests) */
export const nullMailer = (notifyTo: string | null = null): Mailer => ({
  configured: false,
  notifyTo,
  async send() {
    throw new Error('E-Mail-Versand ist nicht konfiguriert');
  },
});

/** Text für .txt-Anhänge und E-Mails: einfache Markdown-Auszeichnung entfernen */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,3}\s+(.*)$/gm, (_m, t: string) => `${t.toUpperCase()}`)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
