/**
 * SMTP-Versand (nur Deno/Supabase Edge Runtime). Wird ausschließlich von deps.ts geladen – die Fachlogik
 * und die Tests kennen nur das Interface aus mailer.ts.
 *
 * Verbindung: SSL/TLS auf Port 465 (Ports 25/587 sind in Supabase Edge Functions gesperrt).
 * Zugangsdaten kommen aus Function Secrets (mailConfig) und werden nie geloggt.
 */
import nodemailer from 'nodemailer';
import { mailConfig, nullMailer, type Mailer } from './mailer.ts';
import type { EnvGetter } from './stripeConfig.ts';

export function mailerFromEnv(env: EnvGetter, log?: (m: string) => void): Mailer {
  const cfg = mailConfig(env);
  if (cfg.warning) log?.(`mailer: ${cfg.warning}`);
  if (cfg.transport !== 'smtp') return nullMailer(cfg.notifyTo);
  let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
  return {
    configured: true,
    notifyTo: cfg.notifyTo,
    async send(m) {
      transport ??= nodemailer.createTransport({
        host: cfg.host!,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user!, pass: cfg.password! },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      await transport.sendMail({
        from: cfg.from!,
        to: m.to,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType ?? 'text/plain; charset=utf-8' })),
      });
    },
  };
}
