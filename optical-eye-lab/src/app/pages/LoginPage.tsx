/**
 * Anmeldung: E-Mail/Passwort, Konto erstellen, Demo starten, bekannte Konten (Benutzer wechseln).
 * Lokale Demo-Anmeldung – im UI klar als solche gekennzeichnet, keine Sicherheitsversprechen.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Info, LogIn, PlayCircle, UserPlus } from 'lucide-react';
import { useSession, errorMessage } from '../session';
import { platform } from '../platformInstance';
import { BrandMark, useProductName } from '../Brand';
import { landingPath } from '../landing';
import { Avatar, Button, SelectField, Tabs, TextField } from '@/ui/ds';
import { Toasts } from '@/ui/overlays/HudOverlays';
import { AuthError } from '@/platform/auth';
import { ORG_TYPE_LABELS, type OrganizationType, type User } from '@/platform/models';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/platform/seed';
import { roleLabel } from '@/platform/permissions';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const user = useSession((s) => s.user);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const productName = useProductName();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [known, setKnown] = useState<User[]>([]);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [firstAccount, setFirstAccount] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrganizationType>('business');

  useEffect(() => {
    void (async () => {
      setKnown(await platform.auth.knownAccounts());
      const users = await platform.repos.listUsers();
      setDemoAvailable(users.some((u) => u.email === DEMO_EMAIL && u.active));
      setFirstAccount(!users.some((u) => !u.isDemo && u.role !== 'guest'));
    })();
  }, []);

  if (user) return <Navigate to={params.get('next') || landingPath()} replace />;

  const go = () => navigate(params.get('next') || landingPath(), { replace: true });

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      go();
    } catch (e) {
      setError({ msg: errorMessage(e), field: e instanceof AuthError ? e.field : undefined });
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') void run('signin', () => useSession.getState().signIn(email, password));
    else
      void run('signup', () =>
        useSession.getState().signUp({ firstName, lastName, email, password, organizationName: firstAccount ? orgName : undefined, organizationType: firstAccount ? orgType : undefined }),
      );
  };

  const fieldErr = (f: string) => (error?.field === f ? error.msg : null);
  const generalErr = error && !error.field ? error.msg : null;

  return (
    <div className="login">
      <section className="login__hero" aria-hidden>
        <div className="login__hero-inner">
          <div className="login__logo">
            <BrandMark size={44} />
          </div>
          <h1 className="login__product">{productName}</h1>
          <p className="login__tagline">Interaktive 3D-Simulation für Augenoptik – Refraktion, Brillenglas, Kontaktlinse und Tränenlinse physikalisch berechnet.</p>
          <ul className="login__features">
            <li>Parametrisches Modellauge mit Schnittansicht</li>
            <li>Sphäre, Zylinder und Achse mit echtem Raytracing</li>
            <li>Korrektion live – inklusive HSA und Tränenlinse</li>
            <li>Vorlagen für Unterricht, Ausbildung und Beratung</li>
          </ul>
        </div>
        <svg className="login__rays" viewBox="0 0 600 300" preserveAspectRatio="none">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M0 ${60 + i * 22} C 260 ${60 + i * 22}, 330 150, 600 150`} />
          ))}
        </svg>
      </section>

      <section className="login__panel">
        <div className="login__card">
          {known.length > 0 && mode === 'signin' && (
            <div className="login__known">
              <div className="login__known-title">Auf diesem Gerät</div>
              <div className="login__known-list">
                {known.slice(0, 4).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`login__known-item${email === u.email ? ' is-active' : ''}`}
                    onClick={() => {
                      setEmail(u.email);
                      setPassword('');
                      setError(null);
                      window.setTimeout(() => document.getElementById('login-password')?.focus(), 0);
                    }}
                  >
                    <Avatar name={u.displayName} color={u.avatarColor} src={u.avatarDataUrl} size={28} />
                    <span>
                      <strong>{u.displayName}</strong>
                      <small>{roleLabel(u.role)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Tabs<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            items={[
              { value: 'signin', label: 'Anmelden', icon: LogIn },
              { value: 'signup', label: 'Konto erstellen', icon: UserPlus },
            ]}
          />

          <form className="login__form" onSubmit={onSubmit} noValidate>
            {mode === 'signup' && (
              <div className="form-row">
                <TextField label="Vorname" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" error={fieldErr('firstName')} required />
                <TextField label="Nachname" optional value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
              </div>
            )}
            <TextField label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" error={fieldErr('email')} autoFocus required />
            <TextField
              id="login-password"
              label="Passwort"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              error={fieldErr('password')}
              hint={mode === 'signup' ? 'Mindestens 4 Zeichen. Nur für die lokale Anmeldung auf diesem Gerät.' : undefined}
              required
            />
            {mode === 'signup' && firstAccount && (
              <div className="login__org">
                <p className="login__org-hint">Dies ist das erste Konto auf diesem Gerät. Es erhält Administrationsrechte und legt die Organisation an.</p>
                <div className="form-row">
                  <TextField label="Organisation" optional placeholder="z. B. Augenoptik Muster" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />
                  <SelectField<OrganizationType> label="Art" value={orgType} onChange={setOrgType} options={Object.entries(ORG_TYPE_LABELS).map(([value, label]) => ({ value: value as OrganizationType, label }))} />
                </div>
              </div>
            )}
            {generalErr && (
              <p className="ds-field__error" role="alert">
                {generalErr}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" block iconRight={ArrowRight} loading={busy === 'signin' || busy === 'signup'}>
              {mode === 'signin' ? 'Anmelden' : 'Konto erstellen'}
            </Button>
          </form>

          <div className="login__divider">
            <span>oder</span>
          </div>

          <Button size="lg" block icon={PlayCircle} loading={busy === 'guest'} onClick={() => void run('guest', () => useSession.getState().signInAsGuest())}>
            Demo starten (ohne Konto)
          </Button>

          {demoAvailable && mode === 'signin' && (
            <button
              type="button"
              className="login__demo-hint"
              onClick={() => {
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
                setError(null);
              }}
            >
              Demo-Trainer: <code>{DEMO_EMAIL}</code> · Passwort <code>{DEMO_PASSWORD}</code> <span>übernehmen</span>
            </button>
          )}

          <p className="login__notice">
            <Info size={13} />
            <span>
              Lokale Demo-Anmeldung: Konten und Simulationen werden nur in diesem Browser gespeichert. Es gibt keinen Server, keine E-Mail-Bestätigung und keine abgesicherte Kontoverwaltung.
            </span>
          </p>
        </div>
      </section>
      <div className="page-toasts">
        <Toasts />
      </div>
    </div>
  );
}
