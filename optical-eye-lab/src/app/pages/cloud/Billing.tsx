/**
 * Abo-Anzeigen (Phase 7): Abo-Übersicht, „Abonnement verwalten“ (Stripe Customer Portal) und die
 * Bestätigung nach der Rückkehr aus dem Stripe Checkout.
 *
 * Wichtig: Der URL-Parameter ?checkout=success schaltet NICHTS frei. Die Seite lädt nur den Status aus
 * Supabase neu – freigeschaltet ist erst, wenn der Stripe-Webhook die Lizenz serverseitig aktiviert hat.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { serverNow } from '@/cloud/serverClock';
import { ArrowRight, BadgeCheck, CalendarClock, CircleAlert, CreditCard, Loader2, RefreshCcw } from 'lucide-react';
import { Button, Pill } from '@/ui/ds';
import { cloudBackend, useCloud } from '../../cloudSession';
import { canUseSimulator } from '@/cloud/access';
import { DEMO_PLAN, PRODUCT_NAME, formatDate, LICENSE_SOURCE_LABEL, LICENSE_STATUS_LABEL, licenseLabel, SUBSCRIPTION_STATUS_LABEL } from '@/cloud/plans';
import { billingNotice, CONFIRM_BACKOFF_MS } from '@/cloud/billing';

export { billingNotice };
import { useAppStore } from '@/state/store';

/* ------------------------------ Abonnement verwalten ------------------------------ */

export function ManageSubscriptionButton({ variant = 'secondary', size }: { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  const canManage = useCloud((s) => s.account?.billing?.canManage ?? false);
  const [busy, setBusy] = useState(false);
  if (!canManage) return null;
  return (
    <Button
      variant={variant}
      size={size}
      icon={CreditCard}
      loading={busy}
      data-testid="manage-subscription"
      onClick={async () => {
        setBusy(true);
        try {
          window.location.assign(await cloudBackend().openCustomerPortal());
        } catch (e) {
          useAppStore.getState().notify(e instanceof Error ? e.message : 'Abo-Verwaltung nicht erreichbar', 'warning');
          setBusy(false);
        }
      }}
    >
      Abonnement verwalten
    </Button>
  );
}

/* ------------------------------ Hinweise (Frist, Kündigung) ------------------------------ */

export function BillingNotice() {
  const account = useCloud((s) => s.account);
  const n = billingNotice(account);
  if (!n) return null;
  return (
    <p className={`auth-note${n.tone === 'warn' ? ' auth-note--warn' : ''}`} data-testid={n.testId}>
      <CircleAlert size={14} /> <span>{n.text}</span>
    </p>
  );
}

/* ------------------------------ Abo-Übersicht ------------------------------ */

export function BillingSummary() {
  const account = useCloud((s) => s.account);
  const l = account?.license;
  const b = account?.billing;
  if (!l) return null;
  const manual = l.source === 'manual';
  const cancelled = !!b?.cancelAtPeriodEnd && l.status === 'active';
  const nextBilling = !manual && b?.subscriptionStatus === 'active' && !b.cancelAtPeriodEnd ? b.currentPeriodEnd : null;
  return (
    <section className="page-section" data-testid="billing-summary">
      <div className="page-section__head">
        <h2 className="page-section__title">
          <CreditCard size={16} /> Abonnement
        </h2>
      </div>
      <dl className="account-grid">
        <div>
          <dt>Tarif</dt>
          <dd data-testid="billing-plan">{l.source === 'demo' ? DEMO_PLAN.name : licenseLabel(l.plan, l.maxLocations)}</dd>
        </div>
        {b?.billingInterval && l.source === 'stripe' && (
          <div>
            <dt>Abrechnung</dt>
            <dd data-testid="billing-interval">{b.billingInterval === 'yearly' ? 'Jährlich' : 'Monatlich'}</dd>
          </div>
        )}
        {l.source === 'demo' && b?.demoExpiresAt && (
          <div>
            <dt>Demo</dt>
            <dd data-testid="billing-demo">{Date.parse(b.demoExpiresAt) > serverNow() ? `läuft bis ${new Date(b.demoExpiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : 'beendet'}</dd>
          </div>
        )}
        <div>
          <dt>Lizenzstatus</dt>
          <dd data-testid="billing-license-status" data-status={l.status}>
            <Pill tone={l.status === 'active' ? 'ok' : l.status === 'pending' ? 'neutral' : 'warn'}>{LICENSE_STATUS_LABEL[l.status]}</Pill>
          </dd>
        </div>
        <div>
          <dt>Abostatus</dt>
          <dd data-testid="billing-subscription-status">{manual ? LICENSE_SOURCE_LABEL.manual : b?.subscriptionStatus ? SUBSCRIPTION_STATUS_LABEL[b.subscriptionStatus] : l.source === 'demo' ? 'Kein Abonnement (Demo)' : 'Noch kein Abonnement'}</dd>
        </div>
        {nextBilling && (
          <div>
            <dt>Nächste Abrechnung</dt>
            <dd data-testid="billing-next">{formatDate(nextBilling)}</dd>
          </div>
        )}
        {cancelled && (l.plan === 'private' && b?.billingInterval === 'yearly' ? (
          <div>
            <dt>Laufzeit</dt>
            <dd data-testid="billing-term-end">endet am {formatDate(l.validUntil ?? b?.cancelAt ?? b?.currentPeriodEnd)} – keine automatische Verlängerung</dd>
          </div>
        ) : (
          <div>
            <dt>Kündigung</dt>
            <dd data-testid="billing-cancel">Gekündigt – Zugriff bis {formatDate(l.validUntil ?? b?.cancelAt ?? b?.currentPeriodEnd)}</dd>
          </div>
        ))}
        {l.status === 'past_due' && l.gracePeriodUntil && (
          <div>
            <dt>Zahlungsfrist</dt>
            <dd data-testid="billing-grace">bis {formatDate(l.gracePeriodUntil)}</dd>
          </div>
        )}
      </dl>
      <BillingNotice />
      <div className="form-actions">
        <ManageSubscriptionButton variant={l.status === 'past_due' || l.status === 'suspended' ? 'primary' : 'secondary'} />
      </div>
    </section>
  );
}

/* ------------------------------ Rückkehr aus dem Checkout ------------------------------ */


/**
 * Nach ?checkout=success: Status kontrolliert neu laden, bis der Webhook die Lizenz aktiviert hat –
 * mit wachsenden Abständen und begrenzter Anzahl (kein Dauer-Polling). Danach manuell „erneut prüfen“.
 */
export function CheckoutConfirmation({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const access = useCloud((s) => s.access);
  const [phase, setPhase] = useState<'waiting' | 'done' | 'slow'>(canUseSimulator(access) ? 'done' : 'waiting');
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (phase !== 'waiting') return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled.current) return;
      await useCloud.getState().refresh().catch(() => undefined);
      if (cancelled.current) return;
      if (canUseSimulator(useCloud.getState().access)) {
        setPhase('done');
        return;
      }
      i += 1;
      if (i >= CONFIRM_BACKOFF_MS.length) {
        setPhase('slow');
        return;
      }
      timer = setTimeout(tick, CONFIRM_BACKOFF_MS[i]);
    };
    timer = setTimeout(tick, CONFIRM_BACKOFF_MS[0]);
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (canUseSimulator(access)) setPhase('done');
  }, [access]);

  if (phase === 'done')
    return (
      <div className="checkout-confirm is-done" data-testid="checkout-confirm" data-phase="done">
        <BadgeCheck size={20} />
        <div>
          <strong>Willkommen bei {PRODUCT_NAME} – deine Lizenz ist aktiv.</strong>
          <span>Vielen Dank für deinen Kauf! Die Zahlung ist bestätigt, alle Funktionen sind freigeschaltet. Die Rechnung erhältst du per E-Mail von Stripe.</span>
        </div>
        <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={() => navigate('/dashboard')} data-testid="checkout-start">
          {PRODUCT_NAME} starten
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Schließen
        </Button>
      </div>
    );
  if (phase === 'slow')
    return (
      <div className="checkout-confirm is-slow" data-testid="checkout-confirm" data-phase="slow">
        <CalendarClock size={20} />
        <div>
          <strong>Die Bestätigung dauert länger als üblich.</strong>
          <span>Stripe hat die Zahlung noch nicht an uns gemeldet. Sobald das passiert, wird deine Lizenz automatisch aktiviert – du musst nicht erneut bezahlen.</span>
        </div>
        <Button
          size="sm"
          icon={RefreshCcw}
          loading={busy}
          data-testid="checkout-recheck"
          onClick={async () => {
            setBusy(true);
            await useCloud.getState().refresh().catch(() => undefined);
            setBusy(false);
            if (canUseSimulator(useCloud.getState().access)) setPhase('done');
          }}
        >
          Erneut prüfen
        </Button>
      </div>
    );
  return (
    <div className="checkout-confirm" data-testid="checkout-confirm" data-phase="waiting" role="status" aria-live="polite">
      <Loader2 size={20} className="spin" />
      <div>
        <strong>Zahlung wird bestätigt …</strong>
        <span>Wir warten auf die Bestätigung von Stripe. Das dauert meist nur wenige Sekunden.</span>
      </div>
    </div>
  );
}
