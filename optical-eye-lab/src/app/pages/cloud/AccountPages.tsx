/**
 * Öffentliche Seiten (Startseite, Pricing) und Konto-Seiten (Lizenz, Konto, Admin) der SaaS-Schicht.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, BadgeCheck, CircleAlert, CreditCard, Hourglass, RefreshCcw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { BrandMark } from '../../Brand';
import { Button, EmptyState, PageHeader, Pill, TextField } from '@/ui/ds';
import { usePageTitle } from '../../usePageTitle';
import { useCloud, cloudBackend } from '../../cloudSession';
import { PlanCards } from './PlanCards';
import { LegalFooterLinks, PublicShell } from './LegalPages';
import { ACCESS_MESSAGE, canUseSimulator } from '@/cloud/access';
import { BillingNotice, BillingSummary, CheckoutConfirmation } from './Billing';
import { BILLING_INTERVAL_LABEL, CUSTOMER_KIND_LABEL, DEMO_PLAN, formatDate, INSTITUTION_TYPE_LABEL, LEGAL_DOC_TYPE_LABEL, LICENSE_SOURCE_LABEL, LICENSE_STATUS_LABEL, licenseLabel, PRODUCT_NAME, SUBSCRIPTION_STATUS_LABEL } from '@/cloud/plans';
import { loadIntent, parseIntent } from '@/cloud/intent';
import { AdminTabs } from './AdminLegalPage';
import { LICENSE_STATUSES, type AdminAccountRow, type AdminConsentRow, type LicenseSource, type LicenseStatus } from '@/cloud/types';
import { useAppStore } from '@/state/store';

/* ------------------------------ öffentlicher Rahmen ------------------------------ */

export function HomePage() {
  usePageTitle('Start');
  return (
    <PublicShell>
      <section className="public-hero">
        <BrandMark size={56} />
        <h1>{PRODUCT_NAME}</h1>
        <p>Interaktive 3D-Simulation für die Augenoptik: vollständiger Simulator und fokussierte Module für Skiaskopie, Refraktion, Patientensicht, Kontaktlinse und Brillenglas – physikalisch berechnet.</p>
        <div className="public-hero__cta">
          <Link to="/pricing" className="btn btn--accent btn--lg-app" data-testid="home-plans">
            Paket wählen <ArrowRight size={16} />
          </Link>
          <Link to="/register?plan=demo" className="btn btn--lg-app" data-testid="home-demo">
            <Sparkles size={15} /> {DEMO_PLAN.durationLabel} kostenlos testen
          </Link>
          <Link to="/login" className="btn btn--ghost btn--lg-app">
            Anmelden
          </Link>
        </div>
        <p className="public-hero__hint">Demo ohne Zahlungsdaten · voller Funktionsumfang · endet automatisch</p>
      </section>
    </PublicShell>
  );
}

export function PricingPage() {
  usePageTitle('Tarife');
  const plan = useCloud((s) => s.account?.license?.plan);
  const [params, setParams] = useSearchParams();
  const cancelled = params.get('checkout') === 'cancelled';
  const intent = parseIntent(params.get('plan'), params.get('interval'));
  return (
    <PublicShell>
      <section className="pricing">
        <h1>Tarife</h1>
        <p className="pricing__lead">Ein Paket für jede Nutzung – privat, im Betrieb oder in der Ausbildung. Monatlich oder jährlich – oder zuerst {DEMO_PLAN.durationLabel} kostenlos testen.</p>
        {cancelled && (
          <p className="auth-note checkout-cancelled" data-testid="checkout-cancelled">
            <CircleAlert size={14} />
            <span>Der Bezahlvorgang wurde abgebrochen – es wurde nichts berechnet. Sie können jederzeit erneut buchen.</span>
            <button type="button" className="banner__close" aria-label="Hinweis schließen" onClick={() => setParams({}, { replace: true })}>
              ×
            </button>
          </p>
        )}
        <PlanCards current={plan} intent={intent} />
      </section>
    </PublicShell>
  );
}

/* ------------------------------------ Lizenz ------------------------------------ */

function licenseHeadline(access: string, status: string | undefined): { title: string; subtitle?: string } {
  if (access === 'active') return { title: 'Ihre Lizenz ist aktiv' };
  if (access === 'demo') return { title: 'Ihre Demo läuft', subtitle: `Voller Funktionsumfang für ${DEMO_PLAN.durationLabel}. Wählen Sie jederzeit ein Paket, um ${PRODUCT_NAME} danach weiter zu nutzen.` };
  if (access === 'demo-ended') return { title: 'Ihre OLO-LAB Demo ist beendet.', subtitle: 'Vielen Dank fürs Testen. Wählen Sie jetzt eine Lizenz, um OLO-LAB weiter zu nutzen.' };
  if (access === 'grace') return { title: 'Zahlung fehlgeschlagen', subtitle: 'Ihr Zugriff bleibt während der Zahlungsfrist erhalten. Bitte aktualisieren Sie Ihr Zahlungsmittel.' };
  if (status === 'suspended') return { title: 'Ihre Lizenz ist gesperrt', subtitle: 'Eine Zahlung ist offen. Nach erfolgreicher Zahlung wird die Lizenz automatisch wieder freigeschaltet.' };
  if (status === 'cancelled') return { title: 'Ihr Abonnement ist beendet', subtitle: 'Buchen Sie einen Tarif, um den Simulator wieder zu nutzen. Ihre gespeicherten Simulationen bleiben erhalten und stehen danach wieder zur Verfügung.' };
  if (status === 'expired' || access === 'expired') return { title: 'Ihre Lizenz ist abgelaufen', subtitle: 'Buchen Sie einen Tarif, um den Simulator wieder zu nutzen. Ihre gespeicherten Simulationen bleiben erhalten und stehen danach wieder zur Verfügung.' };
  if (access === 'inactive') return { title: 'Ihre Lizenz ist noch nicht aktiv', subtitle: 'Wählen Sie Ihren Tarif. Nach erfolgreicher Zahlung stehen Dashboard, vollständiger Simulator und alle Module sofort zur Verfügung.' };
  return { title: 'Ihre Lizenz ist noch nicht aktiv', subtitle: access === 'signed-out' ? undefined : ACCESS_MESSAGE[access as keyof typeof ACCESS_MESSAGE] };
}

const LIVE_SUB = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

export function LicensePage() {
  usePageTitle('Lizenz');
  const account = useCloud((s) => s.account);
  const access = useCloud((s) => s.access);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const l = account?.license;
  const allowed = canUseSimulator(access);
  const returning = params.get('checkout') === 'success';
  // Paketwahl aus Landingpage/Registrierung (URL, sonst gemerkte Auswahl) – öffnet den passenden Schritt
  const [intent] = useState(() => parseIntent(params.get('plan'), params.get('interval')) ?? loadIntent(account?.email ?? null));
  const demoEnded = access === 'demo-ended';
  // Während der Bestätigung keine erneute Buchung anbieten (der Webhook kommt gleich)
  const confirming = returning && !allowed;
  const head = confirming ? { title: 'Zahlung wird bestätigt', subtitle: 'Sobald Stripe die Zahlung bestätigt hat, wird Ihre Lizenz automatisch aktiviert.' } : licenseHeadline(access, l?.status);
  const liveSub = !!account?.billing?.subscriptionStatus && LIVE_SUB.has(account.billing.subscriptionStatus);
  const showBilling = !!l && (liveSub || !!account?.billing?.hasCustomer || l.source === 'manual');
  return (
    <div className="page">
      {returning && <CheckoutConfirmation onDone={() => setParams({}, { replace: true })} />}
      {demoEnded && (
        <section className="demo-ended" data-testid="demo-ended">
          <Hourglass size={26} />
          <div>
            <h2>Ihre OLO-LAB Demo ist beendet.</h2>
            <p>Vielen Dank fürs Testen. Wählen Sie jetzt eine Lizenz, um OLO-LAB weiter zu nutzen. Was Sie in der Demo gespeichert haben, bleibt in Ihrem Konto erhalten.</p>
          </div>
        </section>
      )}
      {!demoEnded && <PageHeader eyebrow="Lizenz" title={head.title} subtitle={allowed && access === 'active' ? `${licenseLabel(l?.plan, l?.maxLocations)} – alle Funktionen sind freigeschaltet.` : head.subtitle} />}
      <div className={`license-status${allowed ? ' is-active' : ''}`} data-testid="license-status" data-status={l?.status ?? 'none'}>
        {allowed ? <BadgeCheck size={22} /> : <CircleAlert size={22} />}
        <div>
          <strong>{l?.source === 'demo' ? DEMO_PLAN.name : licenseLabel(l?.plan, l?.maxLocations)}</strong>
          <span>Status: {l ? (l.source === 'demo' ? (access === 'demo' ? 'Demo aktiv' : 'Demo beendet') : LICENSE_STATUS_LABEL[l.status]) : 'keine Lizenz'}</span>
          {l?.validUntil && l.source !== 'demo' && <span>{l.status === 'active' ? 'Zugriff bis' : 'gültig bis'} {formatDate(l.validUntil)}</span>}
        </div>
        <div className="license-status__actions">
          {allowed ? (
            <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/dashboard')}>
              Zum Dashboard
            </Button>
          ) : (
            <Button
              icon={RefreshCcw}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await useCloud.getState().refresh().catch(() => undefined);
                setBusy(false);
              }}
              data-testid="license-refresh"
            >
              Status erneut prüfen
            </Button>
          )}
        </div>
      </div>
      {!confirming && (showBilling ? <BillingSummary /> : <BillingNotice />)}
      {!confirming && (!allowed || access === 'demo') && !liveSub && l?.source !== 'manual' && (
        <section className="page-section">
          <div className="page-section__head">
            <h2 className="page-section__title">
              <CreditCard size={16} /> {demoEnded ? 'Lizenz wählen' : 'Pakete'}
            </h2>
          </div>
          <PlanCards current={l?.plan} intent={intent} />
        </section>
      )}
      <LegalFooterLinks compact />
    </div>
  );
}

/* ------------------------------------ Konto ------------------------------------ */

export { AccountPage } from './AccountSettings';

/* ------------------------------------ Admin ------------------------------------ */

export function CloudAdminPage() {
  usePageTitle('Admin');
  const [rows, setRows] = useState<AdminAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => {
    try {
      setRows(await cloudBackend().adminListAccounts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const filtered = useMemo(() => (rows ?? []).filter((r) => !q || `${r.institutionName} ${r.email} ${r.firstName} ${r.lastName}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const setSource = async (licenseId: string, source: LicenseSource) => {
    try {
      await cloudBackend().adminSetLicenseSource(licenseId, source);
      useAppStore.getState().notify(source === 'stripe' ? 'Lizenz folgt wieder dem Stripe-Abo' : 'Lizenz als Sonderlizenz markiert', 'success');
      await load();
      await useCloud.getState().refresh();
    } catch (e) {
      useAppStore.getState().notify(e instanceof Error ? e.message : 'Fehler', 'warning');
    }
  };
  const setStatus = async (licenseId: string, status: LicenseStatus) => {
    try {
      await cloudBackend().adminSetLicenseStatus(licenseId, status);
      useAppStore.getState().notify(`Lizenzstatus: ${LICENSE_STATUS_LABEL[status]} (manuell – Sonderlizenz)`, 'success');
      await load();
      await useCloud.getState().refresh();
    } catch (e) {
      useAppStore.getState().notify(e instanceof Error ? e.message : 'Fehler', 'warning');
    }
  };
  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={13} /> Super-Admin
          </>
        }
        title="Kunden & Lizenzen"
        subtitle="Alle Kundenkonten mit Paket, Abrechnung, Demo und Zustimmungen (serverseitig geprüft). Eine manuelle Statusänderung macht die Lizenz zur Sonderlizenz – Stripe-Ereignisse ändern sie dann nicht mehr, bis sie an Stripe zurückgegeben wird."
        actions={
          <Button icon={RefreshCcw} onClick={() => void load()}>
            Aktualisieren
          </Button>
        }
      />
      <AdminTabs />
      {error ? (
        <EmptyState icon={Users} title="Keine Daten" text={error} />
      ) : (
        <>
          <TextField label="Suchen" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Institution, E-Mail, Name" />
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-table">
              <thead>
                <tr>
                  <th>Kunde</th>
                  <th>Kundentyp</th>
                  <th>Paket</th>
                  <th>Lizenzstatus</th>
                  <th>Quelle</th>
                  <th>Abostatus</th>
                  <th>Demo</th>
                  <th>Verträge</th>
                  <th>Stripe Customer</th>
                  <th>Subscription</th>
                  <th>Periodenende</th>
                  <th>Kündigung</th>
                  <th>Registriert</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <AdminRow key={`${r.institutionId}-${r.email}`} r={r} open={open === r.institutionId + r.email} onToggle={() => setOpen(open === r.institutionId + r.email ? null : r.institutionId + r.email)} setStatus={setStatus} setSource={setSource} />
                ))}
                {rows && !filtered.length && (
                  <tr>
                    <td colSpan={13}>Keine Einträge.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AdminRow({ r, open, onToggle, setStatus, setSource }: { r: AdminAccountRow; open: boolean; onToggle: () => void; setStatus: (id: string, s: LicenseStatus) => Promise<void>; setSource: (id: string, s: LicenseSource) => Promise<void> }) {
  const plan = r.licenseSource === 'demo' ? DEMO_PLAN.name : licenseLabel(r.licensePlan);
  return (
    <>
      <tr data-testid="admin-row" data-email={r.email}>
        <td>
          <strong>{r.institutionName}</strong>
          <small>
            {r.firstName} {r.lastName} · {r.email}
          </small>
        </td>
        <td>
          <Pill tone={r.institutionType === 'private' ? 'neutral' : 'accent'}>{CUSTOMER_KIND_LABEL(r.institutionType)}</Pill>
          <span className="admin-sub">{INSTITUTION_TYPE_LABEL[r.institutionType]}</span>
          {r.vatId && <span className="admin-sub mono">{r.vatId}</span>}
        </td>
        <td>
          {plan}
          <span className="admin-sub" data-testid="admin-interval">{r.billingInterval ? BILLING_INTERVAL_LABEL[r.billingInterval] : '–'}</span>
        </td>
        <td>
          {r.licenseId ? (
            <select value={r.licenseStatus ?? 'pending'} onChange={(e) => void setStatus(r.licenseId!, e.target.value as LicenseStatus)} aria-label={`Lizenzstatus ${r.email}`}>
              {LICENSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LICENSE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            '–'
          )}
          {r.licenseStatus === 'past_due' && r.gracePeriodUntil && <span className="admin-sub">Frist bis {formatDate(r.gracePeriodUntil)}</span>}
        </td>
        <td data-testid="admin-source">
          {r.licenseSource ? (
            <span className="admin-source">
              <Pill tone={r.licenseSource === 'manual' ? 'accent' : 'neutral'}>{r.licenseSource === 'manual' ? 'Manuell' : r.licenseSource === 'demo' ? 'Demo' : 'Stripe'}</Pill>
              {r.licenseSource === 'manual' && r.licenseId && (
                <button type="button" onClick={() => void setSource(r.licenseId!, 'stripe')} title={LICENSE_SOURCE_LABEL.stripe} aria-label={`An Stripe zurückgeben ${r.email}`}>
                  an Stripe zurückgeben
                </button>
              )}
            </span>
          ) : (
            '–'
          )}
        </td>
        <td>{r.subscriptionStatus ? SUBSCRIPTION_STATUS_LABEL[r.subscriptionStatus] : '–'}</td>
        <td data-testid="admin-demo">
          {r.demoUsed ? (
            <>
              <Pill tone="neutral">genutzt</Pill>
              <span className="admin-sub">Start {r.demoStartedAt ? new Date(r.demoStartedAt).toLocaleString('de-DE') : '–'}</span>
              <span className="admin-sub">Ende {r.demoExpiresAt ? new Date(r.demoExpiresAt).toLocaleString('de-DE') : '–'}</span>
            </>
          ) : (
            'nein'
          )}
        </td>
        <td data-testid="admin-consents">
          <button type="button" className="admin-link" onClick={onToggle} aria-expanded={open}>
            {r.consentCount ? `${r.consentCount} Zustimmung${r.consentCount === 1 ? '' : 'en'}` : 'keine'}
          </button>
          {r.consentSummary?.length ? <span className="admin-sub">{r.consentSummary.map((c) => `${LEGAL_DOC_TYPE_LABEL[c.type]} ${c.version}`).join(' · ')}</span> : null}
        </td>
        <td className="mono">{r.stripeCustomerId ?? '–'}</td>
        <td className="mono">{r.stripeSubscriptionId ?? '–'}</td>
        <td>{formatDate(r.currentPeriodEnd)}</td>
        <td>{r.cancelAtPeriodEnd ? 'zum Periodenende' : '–'}</td>
        <td>{r.registeredAt ? new Date(r.registeredAt).toLocaleDateString('de-DE') : '–'}</td>
      </tr>
      {open && (
        <tr className="admin-detail">
          <td colSpan={13}>
            <ConsentHistory institutionId={r.institutionId} />
          </td>
        </tr>
      )}
    </>
  );
}

const CONTEXT_LABEL = { registration: 'Registrierung', demo: 'Demo', checkout: 'Kauf' } as const;
const CONSENT_LABEL = { accepted: 'akzeptiert', acknowledged: 'zur Kenntnis genommen', agreed: 'zugestimmt' } as const;

function ConsentHistory({ institutionId }: { institutionId: string }) {
  const [list, setList] = useState<AdminConsentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    cloudBackend()
      .adminListConsents(institutionId)
      .then(setList)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Fehler'));
  }, [institutionId]);
  if (err) return <p className="ds-field__error">{err}</p>;
  if (!list) return <p className="muted">Wird geladen …</p>;
  if (!list.length) return <p className="muted">Keine protokollierten Zustimmungen.</p>;
  return (
    <table className="consent-history" data-testid="consent-history">
      <thead>
        <tr>
          <th>Zeitpunkt</th>
          <th>Benutzer</th>
          <th>Dokument</th>
          <th>Version</th>
          <th>Art</th>
          <th>Anlass</th>
          <th>Paket</th>
          <th>Checkout / Abo</th>
        </tr>
      </thead>
      <tbody>
        {list.map((c, i) => (
          <tr key={i}>
            <td>{new Date(c.acceptedAt).toLocaleString('de-DE')}</td>
            <td>{c.email ?? '–'}</td>
            <td>
              <a href={`/legal/doc/${c.documentId}`} target="_blank" rel="noopener noreferrer">
                {LEGAL_DOC_TYPE_LABEL[c.documentType]}
              </a>
            </td>
            <td className="mono" title={c.documentHash}>
              {c.documentVersion}
            </td>
            <td>{CONSENT_LABEL[c.consentType]}</td>
            <td>{CONTEXT_LABEL[c.context]}</td>
            <td>{c.plan ? `${c.plan}${c.billingInterval ? ` · ${BILLING_INTERVAL_LABEL[c.billingInterval]}` : ''}` : '–'}</td>
            <td className="mono">{c.stripeSubscriptionId ?? c.checkoutSessionId ?? '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
