/**
 * „Verträge hier kündigen“ (§ 312k BGB) und „Vertrag widerrufen“ (§ 356a BGB).
 *
 * - Ohne Anmeldung erreichbar (/kuendigen, /widerrufen), dauerhaft in der Fußzeile verlinkt.
 * - Zwei Schritte: Angaben → Bestätigungsseite mit eindeutigem Button („Jetzt kündigen“ bzw.
 *   „Widerruf bestätigen“) → Eingangsbestätigung mit Datum und Uhrzeit (speicher-/druckbar).
 * - Die Zuordnung zum Konto, eine automatische Kündigung bei Stripe und die Bestätigungs-E-Mail erledigt
 *   ausschließlich der Server. Die Seite zeigt nie an, ob zu einer E-Mail-Adresse ein Konto existiert.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CircleCheck, Printer, Send, ShieldCheck } from 'lucide-react';
import { Button, TextArea, TextField } from '@/ui/ds';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend, useCloud } from '../../cloudSession';
import { CloudError, type ConsumerDeclarationInput, type ConsumerDeclarationKind, type ConsumerDeclarationReceipt } from '@/cloud/types';
import { PRODUCT_NAME } from '@/cloud/plans';
import { PublicShell } from './LegalPages';

const TEXT = {
  cancellation: {
    title: 'Verträge hier kündigen',
    lead: `Hier kündigen Sie Ihr ${PRODUCT_NAME}-Abonnement – ohne Anmeldung. Sie erhalten sofort eine Eingangsbestätigung auf dieser Seite und per E-Mail.`,
    confirmTitle: 'Kündigung prüfen und absenden',
    button: 'Jetzt kündigen',
    doneTitle: 'Ihre Kündigung ist eingegangen',
  },
  withdrawal: {
    title: 'Vertrag widerrufen',
    lead: `Als Verbraucherin oder Verbraucher können Sie Ihren Vertrag über ${PRODUCT_NAME} innerhalb von 14 Tagen nach Vertragsschluss ohne Angabe von Gründen widerrufen. Einzelheiten stehen in der Widerrufsbelehrung.`,
    confirmTitle: 'Widerruf prüfen und absenden',
    button: 'Widerruf bestätigen',
    doneTitle: 'Ihr Widerruf ist eingegangen',
  },
} as const;

const fmt = (iso: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'medium' }).format(new Date(iso)) + ' Uhr';

export function ConsumerDeclarationPage({ kind }: { kind: ConsumerDeclarationKind }) {
  const t = TEXT[kind];
  usePageTitle(t.title);
  const account = useCloud((s) => s.account);
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [f, setF] = useState<ConsumerDeclarationInput>(() => ({
    kind,
    cancellationType: 'ordinary',
    name: account?.profile ? `${account.profile.firstName} ${account.profile.lastName}`.trim() : '',
    email: account?.profile?.email ?? account?.email ?? '',
    contract: '',
    reason: '',
    website: '',
  }));
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ConsumerDeclarationReceipt | null>(null);
  const set = <K extends keyof ConsumerDeclarationInput>(k: K, v: ConsumerDeclarationInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const extraordinary = kind === 'cancellation' && f.cancellationType === 'extraordinary';

  const check = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string | null> = {};
    if (!f.name.trim()) err.name = 'Bitte geben Sie Ihren Namen an.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) err.email = 'Bitte geben Sie die E-Mail-Adresse Ihres Kundenkontos an.';
    if (extraordinary && !f.reason?.trim()) err.reason = 'Bitte geben Sie bei einer außerordentlichen Kündigung den Grund an.';
    setErrors(err);
    if (!Object.values(err).some(Boolean)) setStep('confirm');
  };

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await cloudBackend().submitConsumerDeclaration({ ...f, cancellationType: kind === 'cancellation' ? f.cancellationType : undefined });
      setReceipt(r);
      setStep('done');
    } catch (e) {
      if (e instanceof CloudError && e.field) {
        setErrors({ [e.field]: e.message });
        setStep('form');
      } else setProblem(e instanceof Error ? e.message : 'Die Erklärung konnte nicht übermittelt werden.');
    } finally {
      setBusy(false);
    }
  };

  const summary = (
    <dl className="declaration__summary" data-testid="declaration-summary">
      {kind === 'cancellation' && (
        <>
          <dt>Art der Kündigung</dt>
          <dd>{extraordinary ? 'Außerordentliche Kündigung' : 'Ordentliche Kündigung zum nächstmöglichen Zeitpunkt'}</dd>
        </>
      )}
      <dt>Name</dt>
      <dd>{f.name}</dd>
      <dt>E-Mail-Adresse des Kundenkontos</dt>
      <dd>{f.email}</dd>
      {f.contract?.trim() && (
        <>
          <dt>Vertrag</dt>
          <dd>{f.contract}</dd>
        </>
      )}
      {f.reason?.trim() && (
        <>
          <dt>{kind === 'cancellation' ? 'Grund' : 'Anmerkung'}</dt>
          <dd>{f.reason}</dd>
        </>
      )}
    </dl>
  );

  return (
    <PublicShell>
      <section className="declaration" data-testid={`declaration-${kind}`} data-step={step}>
        {step === 'form' && (
          <form className="declaration__card" onSubmit={check} noValidate data-testid="declaration-form">
            <header>
              <h1>{t.title}</h1>
              <p>{t.lead}</p>
            </header>
            {kind === 'cancellation' && (
              <fieldset className="declaration__choice">
                <legend>Art der Kündigung</legend>
                <label>
                  <input type="radio" name="ctype" checked={f.cancellationType === 'ordinary'} onChange={() => set('cancellationType', 'ordinary')} data-testid="ctype-ordinary" />
                  <span>
                    <strong>Ordentliche Kündigung</strong>
                    <small>zum nächstmöglichen Zeitpunkt (Ende des bezahlten Abrechnungszeitraums)</small>
                  </span>
                </label>
                <label>
                  <input type="radio" name="ctype" checked={f.cancellationType === 'extraordinary'} onChange={() => set('cancellationType', 'extraordinary')} data-testid="ctype-extraordinary" />
                  <span>
                    <strong>Außerordentliche Kündigung</strong>
                    <small>aus wichtigem Grund – bitte den Grund angeben</small>
                  </span>
                </label>
              </fieldset>
            )}
            <TextField label="Vor- und Nachname" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" error={errors.name} required />
            <TextField label="E-Mail-Adresse Ihres Kundenkontos" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" error={errors.email} hint="Die Bestätigung senden wir an die E-Mail-Adresse Ihres Kundenkontos." required />
            <TextField
              label={kind === 'cancellation' ? 'Vertrag' : 'Vertrag und Bestelldatum'}
              optional
              value={f.contract ?? ''}
              onChange={(e) => set('contract', e.target.value)}
              placeholder={kind === 'cancellation' ? 'z. B. Private monatlich' : 'z. B. Private jährlich, bestellt am …'}
            />
            <TextArea
              label={kind === 'cancellation' ? 'Grund der Kündigung' : 'Anmerkung'}
              optional={!extraordinary}
              rows={3}
              value={f.reason ?? ''}
              onChange={(e) => set('reason', e.target.value)}
              error={errors.reason}
            />
            {/* Honeypot: für Menschen unsichtbar, Bots füllen es aus */}
            <div className="declaration__hp" aria-hidden="true">
              <label>
                Website <input tabIndex={-1} autoComplete="off" value={f.website ?? ''} onChange={(e) => set('website', e.target.value)} />
              </label>
            </div>
            <Button type="submit" variant="primary" size="lg" block iconRight={Send} data-testid="declaration-next">
              Weiter zur Bestätigung
            </Button>
            <p className="declaration__note">
              <ShieldCheck size={13} /> Alternativ per E-Mail an info@olo-vision.de oder per Post an OLO Vision, Forsthausstraße 14, 66709 Weiskirchen.
              {kind === 'withdrawal' && (
                <>
                  {' '}
                  <Link to="/legal/withdrawal">Widerrufsbelehrung</Link> · <Link to="/legal/withdrawal_form">Muster-Widerrufsformular</Link>
                </>
              )}
            </p>
          </form>
        )}

        {step === 'confirm' && (
          <div className="declaration__card" data-testid="declaration-confirm">
            <header>
              <h1>{t.confirmTitle}</h1>
              <p>Bitte prüfen Sie Ihre Angaben. Mit dem Klick auf „{t.button}“ wird Ihre Erklärung verbindlich übermittelt.</p>
            </header>
            {summary}
            {problem && (
              <p className="ds-field__error" role="alert" data-testid="declaration-error">
                {problem}
              </p>
            )}
            <div className="declaration__actions">
              <Button icon={ArrowLeft} onClick={() => setStep('form')} disabled={busy}>
                Angaben ändern
              </Button>
              <Button variant="primary" size="lg" loading={busy} onClick={() => void submit()} data-testid="declaration-submit">
                {t.button}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && receipt && (
          <div className="declaration__card declaration__card--done" data-testid="declaration-done">
            <header>
              <CircleCheck size={30} />
              <h1>{t.doneTitle}</h1>
              <p data-testid="declaration-received">Eingegangen am {fmt(receipt.receivedAt)}</p>
            </header>
            {summary}
            {receipt.id && <p className="declaration__ref">Vorgangsnummer: {receipt.id}</p>}
            <p>
              {kind === 'cancellation'
                ? 'Wir haben Ihre Kündigung erhalten. Die Bestätigung mit dem Zeitpunkt, zu dem Ihr Vertrag endet, senden wir an die E-Mail-Adresse Ihres Kundenkontos. Eine ordentliche Kündigung wird automatisch zum Ende des bezahlten Abrechnungszeitraums wirksam.'
                : 'Wir haben Ihren Widerruf erhalten und senden Ihnen eine Eingangsbestätigung per E-Mail. Die Erstattung erfolgt spätestens 14 Tage nach Eingang über Ihr ursprüngliches Zahlungsmittel.'}
            </p>
            <p className="declaration__note">Kommt keine E-Mail an, prüfen Sie bitte Ihren Spam-Ordner oder schreiben Sie an info@olo-vision.de. Sie können diese Seite zusätzlich speichern oder drucken.</p>
            <div className="declaration__actions">
              <Button icon={Printer} onClick={() => window.print()}>
                Seite drucken / speichern
              </Button>
              <Link to="/" className="btn btn--ghost">
                Zur Startseite
              </Link>
            </div>
          </div>
        )}
      </section>
    </PublicShell>
  );
}

export const CancellationPage = () => <ConsumerDeclarationPage kind="cancellation" />;
export const WithdrawalPage = () => <ConsumerDeclarationPage kind="withdrawal" />;
