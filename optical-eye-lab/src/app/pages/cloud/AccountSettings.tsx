/**
 * Kontoverwaltung (0.10.0): persönliche Daten, Anmeldung & Sicherheit, Lizenz & Abonnement,
 * Institution/Standort, Verträge, Daten & Datenschutz (Export, Konto schließen, endgültig löschen).
 *
 * Begriffe (auch in den Rechtstexten so verwendet):
 *  - Abonnement kündigen   → über „Abonnement verwalten“ (Stripe) oder /kuendigen; Zugriff bis Laufzeitende
 *  - Lizenzende            → Inhalte bleiben erhalten, Bearbeiten erst wieder mit aktiver Lizenz
 *  - Konto schließen       → umkehrbar; Anmeldung möglich, Nutzung gesperrt; Löschung nach 12 Monaten
 *  - Konto löschen         → endgültig und sofort (Art. 17 DSGVO); gesetzlich aufzubewahrende
 *                            Rechnungs- und Vertragsnachweise bleiben bis zum Fristende gespeichert
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Building2, Database, Download, FileText, KeyRound, LockKeyhole, LogOut, Mail, RotateCcw, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { Button, Notice, PageHeader, Pill, TextField } from '@/ui/ds';
import { confirmDialog } from '@/ui/ds/modals';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend, useCloud } from '../../cloudSession';
import { useSession } from '../../session';
import { LegalFooterLinks } from './LegalPages';
import { BillingSummary } from './Billing';
import { exportLibrary } from '../../library/actions';
import { DEMO_PLAN, formatDate, INSTITUTION_TYPE_LABEL, licenseLabel } from '@/cloud/plans';
import { translateError } from '@/cloud/errors';
import type { AccountOverview } from '@/cloud/types';
import { useAppStore } from '@/state/store';

const SUPPORT_MAIL = 'info@olo-vision.de';
const notify = (text: string, tone: 'success' | 'warning' = 'success') => useAppStore.getState().notify(text, tone);

function Section({ id, icon: Icon, title, description, children, testId }: { id?: string; icon: typeof UserRound; title: string; description?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="page-section account-section" id={id} data-testid={testId}>
      <div className="page-section__head">
        <h2 className="page-section__title">
          <Icon size={16} /> {title}
        </h2>
      </div>
      {description && <p className="account-section__desc">{description}</p>}
      {children}
    </section>
  );
}

/* ------------------------------ Persönliche Daten ------------------------------ */

function PersonalData() {
  const p = useCloud((s) => s.account?.profile);
  const [first, setFirst] = useState(p?.firstName ?? '');
  const [last, setLast] = useState(p?.lastName ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFirst(p?.firstName ?? '');
    setLast(p?.lastName ?? '');
  }, [p?.firstName, p?.lastName]);
  if (!p) return null;
  const dirty = first.trim() !== p.firstName || last.trim() !== p.lastName;
  return (
    <Section icon={UserRound} title="Persönliche Daten" testId="account-personal">
      <form
        className="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await useCloud.getState().updateName(first, last);
            notify('Name gespeichert');
          } catch (err) {
            notify(translateError(err).message, 'warning');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <TextField label="Vorname" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" />
          <TextField label="Nachname" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={!dirty || !first.trim()} loading={busy}>
            Name speichern
          </Button>
        </div>
      </form>
    </Section>
  );
}

/* ------------------------------ Anmeldung & Sicherheit ------------------------------ */

function EmailChange() {
  const email = useCloud((s) => s.user?.email ?? '');
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <div className="account-row" data-testid="account-email">
      <div className="account-row__main">
        <strong>E-Mail-Adresse</strong>
        <span>{email}</span>
        {sentTo && (
          <p className="auth-note auth-note--ok" data-testid="email-change-sent">
            <Mail size={14} />
            <span>Wir haben einen Bestätigungslink an {sentTo} gesendet. Die neue Adresse gilt erst, wenn Sie den Link geöffnet haben.</span>
          </p>
        )}
      </div>
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)} data-testid="email-change-open">
          Ändern
        </Button>
      ) : (
        <form
          className="account-form account-row__form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const b = cloudBackend();
              await b.reauthenticate(pw);
              await b.changeEmail(next.trim(), `${window.location.origin}/account?email_changed=1`);
              setSentTo(next.trim());
              setOpen(false);
              setNext('');
              setPw('');
            } catch (x) {
              const t = translateError(x);
              setErr({ field: t.field, text: t.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label="Neue E-Mail-Adresse" type="email" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="email" required error={err?.field === 'email' ? err.text : null} />
          <TextField label="Aktuelles Passwort" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required error={err?.field === 'password' ? err.text : null} />
          {err && !err.field && <p className="ds-field__error">{err.text}</p>}
          <div className="form-actions">
            <Button onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!next.trim() || !pw}>
              Bestätigungslink senden
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const reset = () => {
    setOpen(false);
    setCur('');
    setPw('');
    setPw2('');
    setErr(null);
  };
  return (
    <div className="account-row" data-testid="account-password">
      <div className="account-row__main">
        <strong>Passwort</strong>
        <span>Mindestens 8 Zeichen mit Buchstaben und Ziffern.</span>
      </div>
      {!open ? (
        <Button size="sm" icon={KeyRound} onClick={() => setOpen(true)} data-testid="password-change-open">
          Passwort ändern
        </Button>
      ) : (
        <form
          className="account-form account-row__form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw !== pw2) {
              setErr({ field: 'confirm', text: 'Die Passwörter stimmen nicht überein.' });
              return;
            }
            if (pw.length < 8 || !/[A-Za-zÄÖÜäöüß]/.test(pw) || !/\d/.test(pw)) {
              setErr({ field: 'new', text: 'Bitte wählen Sie mindestens 8 Zeichen mit Buchstaben und Ziffern.' });
              return;
            }
            setBusy(true);
            setErr(null);
            try {
              await cloudBackend().changePassword(cur, pw);
              notify('Ihr Passwort wurde geändert.');
              reset();
            } catch (x) {
              const t = translateError(x);
              setErr({ field: t.field === 'password' && /aktuell|nicht korrekt/i.test(t.message) ? 'current' : t.field === 'password' ? 'new' : undefined, text: t.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label="Aktuelles Passwort" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required error={err?.field === 'current' ? err.text : null} />
          <div className="form-row">
            <TextField label="Neues Passwort" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required error={err?.field === 'new' ? err.text : null} />
            <TextField label="Neues Passwort wiederholen" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required error={err?.field === 'confirm' ? err.text : null} />
          </div>
          {err && !err.field && <p className="ds-field__error">{err.text}</p>}
          <div className="form-actions">
            <Button onClick={reset}>Abbrechen</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!cur || !pw || !pw2}>
              Passwort ändern
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------ Institution / Standort ------------------------------ */

function InstitutionData() {
  const i = useCloud((s) => s.account?.institution);
  if (!i) return null;
  const address = [i.addressLine1, i.addressLine2, [i.postalCode, i.city].filter(Boolean).join(' '), i.country && i.country !== 'DE' ? i.country : null].filter(Boolean).join(', ');
  const label = i.type === 'education' ? 'Bildungseinrichtung' : i.type === 'business' ? 'Unternehmen' : 'Kundenkonto';
  return (
    <Section
      icon={Building2}
      title={i.type === 'private' ? 'Kundendaten' : 'Institution und Standort'}
      testId="account-institution"
      description={
        <>
          Änderungen der Rechnungsdaten nehmen Sie unter „Abonnement verwalten“ vor. Für Änderungen von Name oder Anschrift{i.type === 'private' ? '' : ' der Institution'} schreiben Sie bitte an <a href={`mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent('OLO-LAB3D: Kundendaten ändern')}`}>{SUPPORT_MAIL}</a>.
        </>
      }
    >
      <dl className="account-grid">
        <div>
          <dt>{label}</dt>
          <dd>{i.name}</dd>
        </div>
        {address && (
          <div>
            <dt>Anschrift</dt>
            <dd>{address}</dd>
          </div>
        )}
        {i.vatId && (
          <div>
            <dt>USt-IdNr.</dt>
            <dd className="mono">{i.vatId}</dd>
          </div>
        )}
      </dl>
    </Section>
  );
}

/* ------------------------------ Daten & Datenschutz ------------------------------ */

function useOverview() {
  const [ov, setOv] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useCloud((s) => s.account?.profile?.accountStatus);
  const reload = async () => {
    try {
      setOv(await cloudBackend().accountOverview());
      setError(null);
    } catch (e) {
      setError(translateError(e).message);
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return { ov, error, reload };
}

function DeleteAccountForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  return (
    <form
      className="account-form danger-form"
      data-testid="delete-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const b = cloudBackend();
          await b.reauthenticate(pw);
          await b.deleteAccount(word);
          await useCloud.getState().signOut().catch(() => undefined);
          navigate('/login?deleted=1', { replace: true });
        } catch (x) {
          const t = translateError(x);
          setErr({ field: t.field, text: t.message });
          setBusy(false);
        }
      }}
    >
      <Notice tone="warn" icon={ShieldAlert} title="Endgültig und sofort">
        Ihr Konto, alle Simulationen, Vorlagen und Einstellungen werden unwiderruflich gelöscht. Gesetzlich aufzubewahrende Rechnungs- und Vertragsnachweise bleiben bis zum Ende der Aufbewahrungsfrist gespeichert. Exportieren Sie vorher, was Sie behalten möchten.
      </Notice>
      <TextField label="Aktuelles Passwort" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required error={err?.field === 'password' ? err.text : null} />
      <TextField label="Zur Bestätigung „LÖSCHEN“ eingeben" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" required data-testid="delete-confirm-word" />
      {err && err.field !== 'password' && <p className="ds-field__error" role="alert">{err.text}</p>}
      <div className="form-actions">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button type="submit" variant="danger" icon={Trash2} loading={busy} disabled={!pw || word.trim().toUpperCase() !== 'LÖSCHEN'} data-testid="delete-submit">
          Konto endgültig löschen
        </Button>
      </div>
    </form>
  );
}

function PrivacySection() {
  const { ov, error, reload } = useOverview();
  const sims = useSession((s) => s.sims.length);
  const [busy, setBusy] = useState<'close' | 'reopen' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const closed = ov?.accountStatus === 'closed';
  const privacyMail = `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent('Datenschutzanfrage OLO-LAB3D')}`;
  const blockedReason = ov && !ov.canClose ? `Sie haben ein laufendes Abonnement. Bitte kündigen Sie es zuerst unter „Abonnement verwalten“ – danach können Sie Ihr Konto schließen oder löschen.` : null;

  const close = async () => {
    const ok = await confirmDialog({
      title: 'Konto schließen?',
      message: 'Sie können sich weiterhin anmelden, Ihre Daten exportieren und das Konto jederzeit wieder öffnen. OLO-LAB3D ist währenddessen nicht nutzbar. Nach 12 Monaten wird das geschlossene Konto mit allen Inhalten gelöscht.',
      confirmLabel: 'Konto schließen',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('close');
    try {
      await cloudBackend().closeAccount();
      await useCloud.getState().refresh();
      await reload();
      notify('Ihr Konto wurde geschlossen.');
    } catch (e) {
      notify(translateError(e).message, 'warning');
    } finally {
      setBusy(null);
    }
  };
  const reopen = async () => {
    setBusy('reopen');
    try {
      await cloudBackend().reopenAccount();
      await useCloud.getState().refresh();
      await reload();
      notify('Willkommen zurück – Ihr Konto ist wieder geöffnet.');
    } catch (e) {
      notify(translateError(e).message, 'warning');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section id="privacy" icon={Database} title="Daten und Datenschutz" testId="account-privacy">
      {error && (
        <Notice tone="warn" role="alert" className="page-notice" actions={<Button size="sm" onClick={() => void reload()}>Erneut versuchen</Button>}>
          {error}
        </Notice>
      )}
      <div className="account-rows">
        <div className="account-row">
          <div className="account-row__main">
            <strong>Gespeicherte Inhalte</strong>
            <span data-testid="account-content-count">
              {ov ? `${ov.simulations} ${ov.simulations === 1 ? 'Simulation' : 'Simulationen'} · ${ov.templates} eigene ${ov.templates === 1 ? 'Vorlage' : 'Vorlagen'}` : '…'} – in Ihrem Konto gespeichert, auf allen Geräten verfügbar. Sie bleiben auch nach dem Ende einer Lizenz erhalten.
            </span>
          </div>
          <Button size="sm" icon={Download} onClick={() => void exportLibrary()} disabled={!sims} data-testid="account-export">
            Alle exportieren
          </Button>
        </div>
        <div className="account-row">
          <div className="account-row__main">
            <strong>Auskunft, Berichtigung, Datenkopie</strong>
            <span>Ihre Rechte nach der DSGVO können Sie jederzeit formlos per E-Mail wahrnehmen.</span>
          </div>
          <a className="ds-btn ds-btn--secondary ds-btn--sm" href={privacyMail}>
            <Mail size={14} /> <span>Anfrage senden</span>
          </a>
        </div>
        {closed ? (
          <div className="account-row" data-testid="account-closed-row">
            <div className="account-row__main">
              <strong>Konto geschlossen</strong>
              <span>Geschlossen am {formatDate(ov?.closedAt)}. Ohne erneute Öffnung wird das Konto am {formatDate(ov?.deletionDueAt)} gelöscht.</span>
            </div>
            <Button size="sm" variant="primary" icon={RotateCcw} loading={busy === 'reopen'} onClick={() => void reopen()} data-testid="account-reopen">
              Konto wieder öffnen
            </Button>
          </div>
        ) : (
          <div className="account-row">
            <div className="account-row__main">
              <strong>Konto schließen</strong>
              <span>Umkehrbar: Nutzung ruht, Inhalte bleiben 12 Monate erhalten und stehen nach dem Wiederöffnen wieder zur Verfügung.</span>
            </div>
            <Button size="sm" icon={LockKeyhole} loading={busy === 'close'} disabled={!ov?.canClose} onClick={() => void close()} data-testid="account-close">
              Konto schließen
            </Button>
          </div>
        )}
        <div className="account-row account-row--danger">
          <div className="account-row__main">
            <strong>Konto endgültig löschen</strong>
            <span>Löscht Konto und Inhalte sofort und unwiderruflich.</span>
          </div>
          {!deleting && (
            <Button size="sm" variant="danger" icon={Trash2} disabled={!ov?.canDelete} onClick={() => setDeleting(true)} data-testid="account-delete-open">
              Löschen …
            </Button>
          )}
        </div>
        {blockedReason && (
          <p className="auth-note" data-testid="account-blocked">
            <ShieldAlert size={14} />
            <span>{blockedReason}</span>
          </p>
        )}
        {deleting && <DeleteAccountForm onCancel={() => setDeleting(false)} />}
      </div>
    </Section>
  );
}

/* ------------------------------------ Seite ------------------------------------ */

export function AccountPage() {
  usePageTitle('Konto');
  const account = useCloud((s) => s.account);
  const user = useCloud((s) => s.user);
  const access = useCloud((s) => s.access);
  const navigate = useNavigate();
  const location = useLocation();
  const p = account?.profile;

  // Rücksprung aus dem Bestätigungslink der E-Mail-Änderung / Sprung zum Datenschutzbereich
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('email_changed')) {
      notify('Ihre neue E-Mail-Adresse ist bestätigt.');
      void useCloud.getState().refresh();
      navigate('/account', { replace: true });
    }
    if (location.hash === '#privacy') document.getElementById('privacy')?.scrollIntoView({ block: 'start' });
  }, [location.search, location.hash, navigate]);

  if (!user) return null;
  const closed = access === 'account-closed';
  return (
    <div className="page page--narrow account-page">
      <PageHeader eyebrow="Konto" title={p ? `${p.firstName} ${p.lastName}`.trim() || user.email : user.email} subtitle={user.email} />
      {closed && (
        <Notice tone="warn" icon={LockKeyhole} className="page-notice" title="Ihr Konto ist geschlossen" role="status">
          OLO-LAB3D ist derzeit nicht nutzbar. Ihre Inhalte bleiben bis zum {formatDate(p?.deletionDueAt)} erhalten. Sie können Ihr Konto unten unter „Daten und Datenschutz“ jederzeit wieder öffnen.
        </Notice>
      )}
      {p?.role === 'super_admin' && (
        <p className="auth-note">
          <Pill tone="accent">Super-Admin</Pill>
          <span>
            Kunden und Lizenzen verwalten Sie im <Link to="/admin">Admin-Center</Link>.
          </span>
        </p>
      )}

      <dl className="account-grid" data-testid="account-details">
        <div>
          <dt>Kundentyp</dt>
          <dd>{account?.institution ? INSTITUTION_TYPE_LABEL[account.institution.type] : '–'}</dd>
        </div>
        <div>
          <dt>Lizenz</dt>
          <dd data-testid="account-license">{account?.license?.source === 'demo' ? DEMO_PLAN.name : licenseLabel(account?.license?.plan, account?.license?.maxLocations)}</dd>
        </div>
      </dl>
      {account?.license?.status === 'pending' && (
        <p className="auth-note" data-testid="pending-note">
          <ShieldAlert size={14} />
          <span>
            Ihre Lizenz ist noch nicht aktiviert. <Link to="/license">Zur Lizenzseite</Link>
          </span>
        </p>
      )}

      <PersonalData />

      <Section icon={KeyRound} title="Anmeldung und Sicherheit" testId="account-security">
        <div className="account-rows">
          <EmailChange />
          <PasswordChange />
        </div>
      </Section>

      <BillingSummary />
      <p className="account-links">
        <Link to="/license">Lizenzübersicht und Tarife</Link>
      </p>

      <InstitutionData />

      <Section icon={FileText} title="Verträge und Rechtliches" testId="account-legal">
        <LegalFooterLinks compact />
        <p className="account-links">
          <Link to="/kuendigen">Verträge hier kündigen</Link>
          <Link to="/widerrufen">Vertrag widerrufen</Link>
        </p>
      </Section>

      <PrivacySection />

      <section className="page-section">
        <div className="form-actions form-actions--start">
          <Button
            icon={LogOut}
            onClick={async () => {
              await useCloud.getState().signOut();
              navigate('/login', { replace: true });
            }}
            data-testid="account-signout"
          >
            Abmelden
          </Button>
        </div>
      </section>
    </div>
  );
}
