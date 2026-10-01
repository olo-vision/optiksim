/**
 * E-Mail-Adresse ändern: Erfolg nur, wenn Supabase die Änderung nachweislich angenommen hat
 * (new_email + email_change_sent_at bzw. sofort geändert), klare Meldungen bei Fehlern,
 * „Secure email change“ (beide Adressen bestätigen), Rücksprung aus dem Bestätigungslink.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyEmailChangeReturn, emailChangeResultFrom, parseAuthRedirect, resendWaitSeconds } from '@/cloud/emailChange';
import { translateError } from '@/cloud/errors';
import { MockBackend } from '@/cloud/mockBackend';
import { CloudError, type RegistrationInput } from '@/cloud/types';

const NOW = Date.parse('2026-10-01T10:00:00Z');

describe('Auswertung der Supabase-Antwort', () => {
  it('angenommen und versendet → pending, mit Zieladresse und Versandzeit', () => {
    const r = emailChangeResultFrom('Neu@Web.de', { email: 'alt@web.de', new_email: 'neu@web.de', email_change_sent_at: '2026-10-01T10:00:01Z' }, 'alt@web.de', true, NOW);
    expect(r).toEqual({ status: 'pending', newEmail: 'neu@web.de', currentEmail: 'alt@web.de', sentAt: '2026-10-01T10:00:01Z', confirmBoth: true });
  });

  it('„Confirm email“ aus: Adresse sofort geändert → changed (keine Mail)', () => {
    expect(emailChangeResultFrom('neu@web.de', { email: 'neu@web.de', new_email: null }, 'alt@web.de', true)).toEqual({ status: 'changed', newEmail: 'neu@web.de' });
  });

  it('keine Versandzeit oder keine offene Änderung → kein Erfolg', () => {
    expect(() => emailChangeResultFrom('neu@web.de', { email: 'alt@web.de', new_email: 'neu@web.de', email_change_sent_at: null }, 'alt@web.de', true, NOW)).toThrow(/konnte nicht versendet werden/);
    // alte Versandzeit einer früheren Anfrage zählt nicht als neuer Versand
    expect(() => emailChangeResultFrom('neu@web.de', { email: 'alt@web.de', new_email: 'neu@web.de', email_change_sent_at: '2026-09-30T10:00:00Z' }, 'alt@web.de', true, NOW)).toThrow(CloudError);
    expect(() => emailChangeResultFrom('neu@web.de', { email: 'alt@web.de', new_email: null }, 'alt@web.de', true, NOW)).toThrow(/nicht angenommen/);
    expect(() => emailChangeResultFrom('neu@web.de', { email: 'alt@web.de', new_email: 'andere@web.de', email_change_sent_at: '2026-10-01T10:00:01Z' }, 'alt@web.de', true, NOW)).toThrow(/nicht angenommen/);
  });

  it('Wartezeit für „Erneut senden“ (Supabase: 60 s)', () => {
    expect(resendWaitSeconds(null)).toBe(0);
    expect(resendWaitSeconds('2026-10-01T10:00:00Z', NOW + 15_000)).toBe(45);
    expect(resendWaitSeconds('2026-10-01T10:00:00Z', NOW + 61_000)).toBe(0);
  });

  it('Fehler von Supabase werden verständlich und ohne Technik angezeigt', () => {
    expect(translateError({ code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 37 seconds.' }).message).toBe('Aus Sicherheitsgründen können Sie erst in 37 Sekunden erneut eine E-Mail anfordern.');
    for (const e of [
      { code: 'unexpected_failure', status: 500, message: 'Error sending email change email' },
      { code: 'email_address_not_authorized', status: 400, message: 'Email address "x@y.de" cannot be used as it is not authorized' },
    ]) {
      const m = translateError(e).message;
      expect(m).toMatch(/Bestätigungs-E-Mail konnte gerade nicht versendet werden/);
      expect(m).not.toMatch(/error|sending|authorized/i);
    }
    expect(translateError({ code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' })).toMatchObject({ field: 'email', message: 'Für diese E-Mail-Adresse existiert bereits ein Konto.' });
  });
});

describe('Rücksprung aus dem Bestätigungslink', () => {
  it('erster von zwei Links (Secure email change) → partial', () => {
    const info = parseAuthRedirect('#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email', '?email_changed=1');
    expect(classifyEmailChangeReturn(info, { email: 'alt@web.de', pendingEmail: 'neu@web.de' })).toEqual({ kind: 'partial', pendingEmail: 'neu@web.de', currentEmail: 'alt@web.de' });
  });

  it('letzter Link → confirmed mit neuer Adresse; ohne Hash entscheidet der Benutzerstand', () => {
    const info = parseAuthRedirect('#access_token=x&type=email_change', '?email_changed=1');
    expect(info).toMatchObject({ type: 'email_change', hasToken: true });
    expect(classifyEmailChangeReturn(info, { email: 'neu@web.de', pendingEmail: null })).toEqual({ kind: 'confirmed', email: 'neu@web.de' });
    // Hash bereits ausgewertet, aber Änderung noch offen → nicht „bestätigt“ melden
    expect(classifyEmailChangeReturn({}, { email: 'alt@web.de', pendingEmail: 'neu@web.de' }).kind).toBe('partial');
  });

  it('abgelaufener/benutzter Link → freundliche Fehlermeldung', () => {
    const info = parseAuthRedirect('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '');
    const r = classifyEmailChangeReturn(info, { email: 'alt@web.de', pendingEmail: 'neu@web.de' });
    expect(r).toMatchObject({ kind: 'error' });
    expect(r.kind === 'error' && r.message).toMatch(/abgelaufen oder wurde bereits verwendet/);
  });
});

/* ---------------------------------- Nachbau gegen das MockBackend ---------------------------------- */

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const reg = (email: string): RegistrationInput => ({ firstName: 'Eva', lastName: 'Mail', email, password: 'Geheim123', passwordConfirm: 'Geheim123', institutionType: 'private', institutionName: '', addressLine1: '', postalCode: '', city: '', country: 'DE' });

let server: ReturnType<typeof memoryStorage>;
let b: MockBackend;
beforeEach(async () => {
  server = memoryStorage();
  b = new MockBackend(server, { isolatedSession: true });
  await b.signUp(reg('eva@web.de'));
  await b.signUp(reg('belegt@web.de')).catch(() => undefined);
  await b.signIn('eva@web.de', 'Geheim123');
});

describe('E-Mail-Änderung (Mock wie Supabase)', () => {
  it('Erfolgsfall mit Secure email change: Mails an beide Adressen, erst nach beiden Links gilt die neue Adresse', async () => {
    const r = await b.changeEmail('neu@web.de', 'x');
    expect(r).toMatchObject({ status: 'pending', newEmail: 'neu@web.de', currentEmail: 'eva@web.de', confirmBoth: true });
    expect(b.hooks().emailChangeMails()).toEqual(['new:neu@web.de', 'current:eva@web.de']);
    expect(await b.getUser()).toMatchObject({ email: 'eva@web.de', pendingEmail: 'neu@web.de' });
    expect(b.hooks().confirmEmailChange('current')).toMatch(/other\+email/);
    expect((await b.getUser())!.email).toBe('eva@web.de');
    expect(b.hooks().confirmEmailChange('new')).toMatch(/type=email_change/);
    expect(await b.getUser()).toMatchObject({ email: 'neu@web.de', pendingEmail: null });
    await b.signOut();
    await expect(b.signIn('neu@web.de', 'Geheim123')).resolves.toMatchObject({ email: 'neu@web.de' });
  });

  it('Fehlerfall SMTP: kein Erfolg, keine offene Änderung, verständliche Meldung', async () => {
    b.hooks().setEmailChangeMode('smtp_error');
    await expect(b.changeEmail('neu@web.de', 'x')).rejects.toThrow(/konnte gerade nicht versendet werden/);
    expect((await b.getUser())!.pendingEmail).toBeNull();
  });

  it('„Confirm email“ aus: sofort geändert, keine Mail', async () => {
    b.hooks().setEmailChangeMode('autoconfirm');
    await expect(b.changeEmail('neu@web.de', 'x')).resolves.toEqual({ status: 'changed', newEmail: 'neu@web.de' });
    expect(b.hooks().emailChangeMails()).toEqual([]);
  });

  it('vergebene oder gleiche Adresse → Fehler am Feld', async () => {
    await expect(b.changeEmail('belegt@web.de', 'x')).rejects.toMatchObject({ field: 'email' });
    await expect(b.changeEmail('eva@web.de', 'x')).rejects.toMatchObject({ field: 'email' });
  });

  it('Erneut senden: erst nach 60 s, dann neue Versandzeit; ohne offene Änderung nicht möglich', async () => {
    await expect(b.resendEmailChange('x')).rejects.toMatchObject({ code: 'no_pending_email' });
    const first = await b.changeEmail('neu@web.de', 'x');
    await expect(b.resendEmailChange('x')).rejects.toThrow(/erst in \d+ Sekunden/);
    b.hooks().ageEmailChange(61);
    const again = await b.resendEmailChange('x');
    expect(again.status).toBe('pending');
    expect(again.status === 'pending' && first.status === 'pending' && Date.parse(again.sentAt!) > Date.parse(first.sentAt!) - 61_000).toBe(true);
    expect(b.hooks().emailChangeMails()).toHaveLength(4);
  });
});
