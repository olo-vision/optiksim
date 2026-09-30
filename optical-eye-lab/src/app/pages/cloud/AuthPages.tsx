/**
 * SaaS-Anmeldung (Phase 6): Anmelden, Registrieren, Passwort vergessen, Passwort zurücksetzen.
 * Optisch identisch zur bisherigen Anmeldung (gleiches Layout, Design-System), fachlich über Supabase Auth.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Building2, CheckCircle2, GraduationCap, Info, KeyRound, LogIn, MailCheck, Sparkles, UserRound, UserPlus } from 'lucide-react';
import { BrandMark } from '../../Brand';
import { Button, SelectField, TextField } from '@/ui/ds';
import { Toasts } from '@/ui/overlays/HudOverlays';
import { useCloud } from '../../cloudSession';
import { AUTH_MODE } from '@/cloud/config';
import { CloudError, type InstitutionType, type RegistrationInput } from '@/cloud/types';
import { B2B_COUNTRY_MESSAGE, BILLING_INTERVAL_LABEL, DEMO_PLAN, PRODUCT_NAME, planInfo, planPrice } from '@/cloud/plans';
import { intentQuery, loadIntent, parseIntent, saveIntent, type PlanIntent } from '@/cloud/intent';
import { allConsentsGiven, requiredDocs } from '@/cloud/legal';
import { LegalConsentList, useConsentState, useRequiredLegalDocs } from './LegalConsents';
import { LegalFooterLinks } from './LegalPages';
import { MIN_PASSWORD } from '@/cloud/validation';
import { usePageTitle } from '../../usePageTitle';
import { cloudLandingPath } from './cloudLanding';

type FieldError = { msg: string; field?: string } | null;
const toFieldError = (e: unknown): FieldError => (e instanceof CloudError ? { msg: e.message, field: e.field } : { msg: e instanceof Error ? e.message : 'Unbekannter Fehler.' });

/** Gemeinsamer Rahmen: Produktbild links, Formular rechts */
export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="login">
      <section className="login__hero" aria-hidden>
        <div className="login__hero-inner">
          <div className="login__logo">
            <BrandMark size={44} />
          </div>
          <h1 className="login__product">{PRODUCT_NAME}</h1>
          <p className="login__tagline">Interaktive 3D-Simulation für Augenoptik – Refraktion, Skiaskopie, Brillenglas, Kontaktlinse und Patientensicht physikalisch berechnet.</p>
          <ul className="login__features">
            <li>Vollständiger Simulator und fokussierte Module</li>
            <li>Sphäre, Zylinder und Achse mit echtem Raytracing</li>
            <li>Für Privat, Augenoptikbetriebe und Bildungseinrichtungen</li>
            <li>
              <Link to="/pricing" className="login__hero-link">
                Tarife ansehen
              </Link>
            </li>
          </ul>
        </div>
        <svg className="login__rays" viewBox="0 0 600 300" preserveAspectRatio="none">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M0 ${60 + i * 22} C 260 ${60 + i * 22}, 330 150, 600 150`} />
          ))}
        </svg>
      </section>
      <section className="login__panel">
        <div className="login__card auth-card">
          <header className="auth-card__head">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
          {footer && <div className="auth-card__foot">{footer}</div>}
          <LegalFooterLinks />
          {AUTH_MODE === 'mock' && (
            <p className="login__notice" data-testid="mock-notice">
              <Info size={13} />
              <span>Testmodus: Mock-Backend im Browser (VITE_AUTH_MODE=mock) – keine Verbindung zu Supabase.</span>
            </p>
          )}
        </div>
      </section>
      <div className="page-toasts">
        <Toasts />
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: FieldError }) {
  if (!error || error.field) return null;
  return (
    <p className="ds-field__error" role="alert" data-testid="auth-error">
      {error.msg}
    </p>
  );
}

/* --------------------------------- Anmelden --------------------------------- */

export function CloudLoginPage() {
  usePageTitle('Anmelden');
  const user = useCloud((s) => s.user);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  if (user) return <Navigate to={params.get('next') || cloudLandingPath()} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await useCloud.getState().signIn(email, password);
      navigate(params.get('next') || cloudLandingPath(), { replace: true });
    } catch (err) {
      setError(toFieldError(err));
      setBusy(false);
    }
  };
  const fe = (f: string) => (error?.field === f ? error.msg : null);
  return (
    <AuthFrame
      title="Anmelden"
      subtitle={`Willkommen bei ${PRODUCT_NAME}.`}
      footer={
        <>
          Noch kein Konto? <Link to="/register">Jetzt registrieren</Link>
        </>
      }
    >
      {params.get('confirmed') && (
        <p className="auth-note auth-note--ok">
          <CheckCircle2 size={14} /> E-Mail-Adresse bestätigt. Sie können sich jetzt anmelden.
        </p>
      )}
      {params.get('reset') && (
        <p className="auth-note auth-note--ok">
          <CheckCircle2 size={14} /> Passwort geändert. Bitte melden Sie sich mit dem neuen Passwort an.
        </p>
      )}
      {params.get('deleted') && (
        <p className="auth-note auth-note--ok" data-testid="account-deleted-note">
          <CheckCircle2 size={14} /> <span>Ihr Konto wurde gelöscht. Eine Bestätigung haben wir an Ihre bisherige E-Mail-Adresse gesendet.</span>
        </p>
      )}
      <form className="login__form" onSubmit={submit} noValidate data-testid="login-form">
        <TextField label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" error={fe('email')} autoFocus required />
        <TextField label="Passwort" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fe('password')} required />
        <div className="auth-row">
          <Link to="/forgot-password" className="auth-link">
            Passwort vergessen?
          </Link>
        </div>
        <ErrorLine error={error} />
        <Button type="submit" variant="primary" size="lg" block icon={LogIn} loading={busy}>
          Anmelden
        </Button>
      </form>
    </AuthFrame>
  );
}

/* -------------------------------- Registrieren -------------------------------- */

/** B2C = Privatperson (Paket Private), B2B = Betrieb (Business) oder Bildungseinrichtung (Education) */
const TYPE_OPTIONS: Array<{ value: InstitutionType; icon: typeof UserRound; label: string; hint: string; kind: 'B2C' | 'B2B' }> = [
  { value: 'private', icon: UserRound, label: 'Privatperson', hint: 'Lernen und Weiterbildung', kind: 'B2C' },
  { value: 'business', icon: Building2, label: 'Unternehmen', hint: 'Augenoptikbetrieb', kind: 'B2B' },
  { value: 'education', icon: GraduationCap, label: 'Bildungseinrichtung', hint: 'Schule, Akademie', kind: 'B2B' },
];

const COUNTRIES = [
  ['DE', 'Deutschland'],
  ['AT', 'Österreich'],
  ['CH', 'Schweiz'],
  ['LU', 'Luxemburg'],
  ['LI', 'Liechtenstein'],
  ['NL', 'Niederlande'],
  ['BE', 'Belgien'],
  ['FR', 'Frankreich'],
  ['IT', 'Italien'],
  ['DK', 'Dänemark'],
  ['PL', 'Polen'],
  ['CZ', 'Tschechien'],
] as const;

const EMPTY: RegistrationInput = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  passwordConfirm: '',
  institutionType: 'private',
  institutionName: '',
  contactName: '',
  addressLine1: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  country: 'DE',
  vatId: '',
  contactPosition: '',
};

export function RegisterPage() {
  usePageTitle('Registrieren');
  const user = useCloud((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Paketwahl aus Pricing/Landingpage übernehmen (URL, sonst gemerkte Auswahl)
  const [intent] = useState<PlanIntent | null>(() => parseIntent(params.get('plan'), params.get('interval')) ?? loadIntent());
  const [f, setF] = useState<RegistrationInput>(() => ({ ...EMPTY, institutionType: intent && intent.plan !== 'demo' ? intent.plan : 'private' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const [confirmMail, setConfirmMail] = useState<string | null>(null);
  const { docs } = useRequiredLegalDocs('registration', f.institutionType);
  const { checked, toggle } = useConsentState();
  useEffect(() => {
    if (intent) saveIntent(intent);
  }, [intent]);
  if (user && !confirmMail) return <Navigate to={intent ? `/license?${intentQuery(intent)}` : cloudLandingPath()} replace />;

  const set = <K extends keyof RegistrationInput>(k: K, v: RegistrationInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const fe = (field: string) => (error?.field === field ? error.msg : null);
  const org = f.institutionType !== 'private';
  const consentsOk = !docs || allConsentsGiven(docs, checked);
  const chosen = intent && intent.plan !== 'demo' ? planInfo(intent.plan) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consentsOk) {
      setError({ msg: 'Bitte bestätigen Sie die erforderlichen Rechtstexte.' });
      return;
    }
    setBusy(true);
    try {
      const consentDocumentIds = docs ? requiredDocs(docs).filter((d) => checked.has(d.id)).map((d) => d.id) : [];
      const r = await useCloud.getState().signUp({ ...f, contactName: org ? `${f.firstName} ${f.lastName}`.trim() : '', consentDocumentIds });
      if (r.needsConfirmation) setConfirmMail(f.email.trim());
      else navigate(intent ? `/license?${intentQuery(intent)}` : cloudLandingPath(), { replace: true });
    } catch (err) {
      setError(toFieldError(err));
    } finally {
      setBusy(false);
    }
  };

  if (confirmMail)
    return (
      <AuthFrame title="Bitte E-Mail bestätigen" footer={<Link to="/login">Zur Anmeldung</Link>}>
        <div className="auth-done" data-testid="confirm-notice">
          <MailCheck size={28} />
          <p>
            Wir haben eine Bestätigungs-E-Mail an <strong>{confirmMail}</strong> gesendet. Öffnen Sie den Link darin und melden Sie sich anschließend an.
          </p>
          <p className="muted">{intent ? (intent.plan === 'demo' ? 'Nach der Anmeldung können Sie die Demo direkt starten.' : 'Nach der Anmeldung geht es mit Ihrem gewählten Paket weiter.') : 'Nach der Anmeldung wählen Sie Ihr Paket oder starten die kostenlose Demo.'}</p>
        </div>
      </AuthFrame>
    );

  return (
    <AuthFrame
      title="Konto erstellen"
      subtitle={intent?.plan === 'demo' ? `Danach starten Sie die kostenlose Demo (${DEMO_PLAN.durationLabel}, ohne Zahlungsdaten).` : 'Wählen Sie, wie Sie OLO-LAB3D nutzen möchten.'}
      footer={
        <>
          Bereits registriert? <Link to="/login">Anmelden</Link>
        </>
      }
    >
      {intent && (
        <p className="chosen-plan" data-testid="chosen-plan">
          {intent.plan === 'demo' ? (
            <>
              <Sparkles size={14} /> {DEMO_PLAN.name} · {DEMO_PLAN.durationLabel} · 0 €
            </>
          ) : (
            chosen && (
              <>
                <CheckCircle2 size={14} /> {chosen.name} · {planPrice(chosen, intent.interval).label} {planPrice(chosen, intent.interval).unit} · {BILLING_INTERVAL_LABEL[intent.interval]}
              </>
            )
          )}
        </p>
      )}
      <form className="login__form" onSubmit={submit} noValidate data-testid="register-form">
        <fieldset className="type-choice" aria-label="Kundentyp">
          {TYPE_OPTIONS.map((o) => (
            <label key={o.value} className={`type-choice__item${f.institutionType === o.value ? ' is-on' : ''}`} data-testid={`type-${o.value}`}>
              <input type="radio" name="institutionType" value={o.value} checked={f.institutionType === o.value} onChange={() => set('institutionType', o.value)} />
              <o.icon size={18} />
              <span>
                <strong>{o.label}</strong>
                <small>{o.hint}</small>
              </span>
              <em className={`type-choice__kind type-choice__kind--${o.kind.toLowerCase()}`}>{o.kind}</em>
            </label>
          ))}
        </fieldset>
        {fe('institutionType') && <p className="ds-field__error">{fe('institutionType')}</p>}
        {intent && intent.plan !== 'demo' && intent.plan !== f.institutionType && (
          <p className="auth-note" data-testid="plan-mismatch-note">
            <Info size={13} /> Das Paket {planInfo(intent.plan)?.name} ist für einen anderen Kundentyp. Gebucht werden kann das zum Kundentyp passende Paket.
          </p>
        )}

        {org && (
          <TextField
            label={f.institutionType === 'business' ? 'Firmenname' : 'Name der Schule / Bildungseinrichtung'}
            value={f.institutionName}
            onChange={(e) => set('institutionName', e.target.value)}
            autoComplete="organization"
            error={fe('institutionName')}
            required
          />
        )}
        <div className="form-row">
          <TextField label="Vorname" value={f.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="given-name" error={fe('firstName')} required />
          <TextField label="Nachname" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="family-name" error={fe('lastName')} required />
        </div>
        {org && <TextField label="Position" optional value={f.contactPosition} onChange={(e) => set('contactPosition', e.target.value)} autoComplete="organization-title" placeholder="z. B. Inhaberin, Ausbildungsleiter" error={fe('contactPosition')} />}
        <TextField label="E-Mail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" error={fe('email')} required />
        <div className="form-row">
          <TextField label="Passwort" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" error={fe('password')} hint={`Mind. ${MIN_PASSWORD} Zeichen, Buchstaben und Ziffern.`} required />
          <TextField label="Passwort bestätigen" type="password" value={f.passwordConfirm} onChange={(e) => set('passwordConfirm', e.target.value)} autoComplete="new-password" error={fe('passwordConfirm')} required />
        </div>

        {org && (
          <div className="login__org" data-testid="org-fields">
            <p className="login__org-title">Rechnungsanschrift</p>
            <TextField label="Straße und Hausnummer" value={f.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} autoComplete="address-line1" error={fe('addressLine1')} required />
            <div className="form-row form-row--zip">
              <TextField label="PLZ" value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} autoComplete="postal-code" error={fe('postalCode')} required />
              <TextField label="Ort" value={f.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" error={fe('city')} required />
            </div>
            <div className="form-row">
              <SelectField label="Land" value={f.country ?? 'DE'} options={COUNTRIES.map(([value, label]) => ({ value, label }))} onChange={(v) => set('country', v)} autoComplete="country" />
              <TextField label="USt-IdNr." optional value={f.vatId} onChange={(e) => set('vatId', e.target.value)} placeholder="z. B. DE123456789" error={fe('vatId')} />
            </div>
            {(f.country ?? 'DE') !== 'DE' && (
              <p className="auth-note auth-note--warn" data-testid="register-country-note">
                <Info size={13} /> {B2B_COUNTRY_MESSAGE} Die kostenlose Demo können Sie trotzdem nutzen.
              </p>
            )}
            <p className="login__org-hint">
              <Info size={13} /> {f.institutionType === 'business' ? 'Die Lizenz gilt für einen Betriebsstandort.' : 'Die Lizenz gilt für einen Bildungsstandort.'}
            </p>
          </div>
        )}

        {docs && docs.length > 0 && <LegalConsentList docs={docs} checked={checked} onToggle={toggle} compact />}

        <ErrorLine error={error} />
        <Button type="submit" variant="primary" size="lg" block icon={UserPlus} iconRight={ArrowRight} loading={busy} disabled={!consentsOk}>
          {intent?.plan === 'demo' ? 'Konto erstellen und Demo starten' : 'Konto erstellen'}
        </Button>
        <p className="login__notice">
          <Info size={13} />
          <span>{intent?.plan === 'demo' ? 'Die Demo ist kostenlos, braucht keine Zahlungsdaten und endet automatisch – es beginnt kein Abonnement.' : 'Nach der Registrierung wählen Sie Ihr Paket oder testen OLO-LAB3D zuerst 2 Stunden kostenlos.'}</span>
        </p>
      </form>
    </AuthFrame>
  );
}

/* ----------------------------- Passwort vergessen ----------------------------- */

export function ForgotPasswordPage() {
  usePageTitle('Passwort vergessen');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!email.trim()) throw new CloudError('Bitte E-Mail-Adresse eingeben.', 'email');
      await useCloud.getState().requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(toFieldError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Passwort vergessen" subtitle="Wir senden Ihnen einen Link zum Zurücksetzen." footer={<Link to="/login">Zurück zur Anmeldung</Link>}>
      {sent ? (
        <div className="auth-done" data-testid="reset-sent">
          <MailCheck size={28} />
          <p>Falls ein Konto zu dieser Adresse existiert, ist eine E-Mail mit einem Link unterwegs. Der Link ist nur kurze Zeit gültig.</p>
        </div>
      ) : (
        <form className="login__form" onSubmit={submit} noValidate>
          <TextField label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" error={error?.field === 'email' ? error.msg : null} autoFocus required />
          <ErrorLine error={error} />
          <Button type="submit" variant="primary" size="lg" block icon={KeyRound} loading={busy}>
            Link anfordern
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

/* --------------------------- Passwort zurücksetzen --------------------------- */

export function ResetPasswordPage() {
  usePageTitle('Neues Passwort');
  const navigate = useNavigate();
  const user = useCloud((s) => s.user);
  const status = useCloud((s) => s.status);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const [waited, setWaited] = useState(false);
  // Supabase verarbeitet den Link aus der E-Mail (Token im URL-Fragment) beim Start; kurz warten
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < MIN_PASSWORD) return setError({ msg: `Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`, field: 'password' });
    if (pw !== pw2) return setError({ msg: 'Die Passwörter stimmen nicht überein.', field: 'passwordConfirm' });
    setBusy(true);
    try {
      await useCloud.getState().updatePassword(pw);
      await useCloud.getState().signOut();
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(toFieldError(err));
      setBusy(false);
    }
  };

  if (!user)
    return (
      <AuthFrame title="Neues Passwort" footer={<Link to="/forgot-password">Neuen Link anfordern</Link>}>
        <p className="auth-note">{status === 'loading' || !waited ? 'Link wird geprüft …' : 'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.'}</p>
      </AuthFrame>
    );
  return (
    <AuthFrame title="Neues Passwort festlegen" subtitle={user.email}>
      <form className="login__form" onSubmit={submit} noValidate data-testid="reset-form">
        <TextField label="Neues Passwort" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" error={error?.field === 'password' ? error.msg : null} autoFocus required />
        <TextField label="Passwort bestätigen" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" error={error?.field === 'passwordConfirm' ? error.msg : null} required />
        <ErrorLine error={error} />
        <Button type="submit" variant="primary" size="lg" block icon={KeyRound} loading={busy}>
          Passwort speichern
        </Button>
      </form>
    </AuthFrame>
  );
}
