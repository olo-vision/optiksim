/**
 * Paketauswahl (Pricing-Seite und Lizenzseite) – Phase 8.
 *
 * - Demo-Karte (2 Stunden, 0 €, voller Funktionsumfang, einmal je Kundenkonto) + drei Bezahlpakete.
 * - Umschalter Monatlich | Jährlich; Jahrespreise sind eigene Stripe-Preise (keine Umrechnung).
 * - Übergeben werden nur Tarif + Intervall; die Price ID wählt die Edge Function aus einer Whitelist.
 * - Tarifregel: buchbar ist nur der Tarif passend zum Kontotyp (Privat → Private, Betrieb → Business,
 *   Bildungseinrichtung → Education); der Server prüft dieselbe Regel.
 * - Nicht angemeldet: Auswahl führt zur Registrierung und wird dort übernommen.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BadgeCheck, Check, Clock3, CreditCard, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { DEMO_PLAN, formatCountdown, PLAN_ONLY_FOR, planAllowedFor, planPrice, PLANS } from '@/cloud/plans';
import type { BillingInterval, LicensePlan } from '@/cloud/types';
import { canStartDemo, canUseSimulator, demoRemainingMs } from '@/cloud/access';
import { intentQuery, saveIntent, type PlanIntent } from '@/cloud/intent';
import { serverDate } from '@/cloud/serverClock';
import { useCloud } from '../../cloudSession';
import { ManageSubscriptionButton } from './Billing';
import { CheckoutDialog, useDemoStart } from './PurchaseDialogs';

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

/** Sekündliche Aktualisierung (nur solange aktiv, z. B. für den Demo-Countdown) */
export function useSecondTick(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);
}

export function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  return (
    <div className="interval-toggle" role="radiogroup" aria-label="Abrechnungsintervall">
      {(['monthly', 'yearly'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)} data-testid={`interval-${v}`}>
          {v === 'monthly' ? 'Monatlich' : 'Jährlich'}
        </button>
      ))}
    </div>
  );
}

export function PlanCards({ current, intent, showDemo = true }: { current?: LicensePlan | null; intent?: PlanIntent | null; showDemo?: boolean }) {
  const navigate = useNavigate();
  const user = useCloud((s) => s.user);
  const account = useCloud((s) => s.account);
  const access = useCloud((s) => s.access);
  const [interval, setBillingInterval] = useState<BillingInterval>(intent?.interval ?? account?.billing?.billingInterval ?? 'monthly');
  const [checkout, setCheckout] = useState<{ plan: LicensePlan; interval: BillingInterval } | null>(null);
  const demo = useDemoStart();

  const type = account?.institution?.type ?? null;
  const license = account?.license ?? null;
  const manualActive = license?.source === 'manual' && canUseSimulator(access);
  const hasLiveSubscription = !!account?.billing?.subscriptionStatus && LIVE.has(account.billing.subscriptionStatus);
  const isAdmin = account?.profile?.role === 'institution_admin' || account?.profile?.role === 'super_admin';
  const demoRunning = access === 'demo';

  // Paketwahl aus Registrierung/Landingpage einmalig übernehmen
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current || !intent || !user || !account?.institution) return;
    consumed.current = true;
    saveIntent(null);
    if (intent.plan === 'demo') {
      if (canStartDemo(account, access)) void demo.begin();
    } else if (planAllowedFor(type, intent.plan) && !hasLiveSubscription && !manualActive && isAdmin && access !== 'active' && access !== 'grace') {
      setBillingInterval(intent.interval);
      setCheckout({ plan: intent.plan, interval: intent.interval });
    }
  }, [intent, user, account, access, type, hasLiveSubscription, manualActive, isAdmin, demo]);

  const choose = (plan: LicensePlan) => {
    if (!user) {
      const i: PlanIntent = { plan, interval };
      saveIntent(i);
      navigate(`/register?${intentQuery(i)}`);
      return;
    }
    setCheckout({ plan, interval });
  };

  return (
    <div className="plans" data-testid="plan-cards">
      <div className="plans__toolbar">
        <IntervalToggle value={interval} onChange={setBillingInterval} />
        <span className="plans__toolbar-note">{interval === 'yearly' ? 'Jährliche Abrechnung' : 'Monatliche Abrechnung'}</span>
      </div>
      <div className={`plan-grid${showDemo ? ' plan-grid--with-demo' : ''}`}>
        {showDemo && <DemoCard onStart={() => (user ? void demo.begin() : (saveIntent({ plan: 'demo', interval: 'monthly' }), navigate('/register?plan=demo')))} busy={demo.busy} running={demoRunning} />}
        {PLANS.map((p) => {
          const isCurrent = !!user && current === p.id && ((canUseSimulator(access) && license?.source !== 'demo') || hasLiveSubscription);
          const fits = !!user && planAllowedFor(type, p.id);
          const recommended = fits && !isCurrent;
          const price = planPrice(p, interval);
          return (
            <article
              key={p.id}
              className={`plan-card${isCurrent ? ' is-current' : ''}${recommended ? ' is-recommended' : ''}${(!user && p.id === 'business') || recommended ? ' is-featured' : ''}${user && !fits ? ' is-unavailable' : ''}`}
              data-testid={`plan-${p.id}`}
              data-fits={user ? String(fits) : undefined}
            >
              {isCurrent && <span className="plan-card__badge">Dein Tarif</span>}
              {recommended && <span className="plan-card__badge">Passend zu deinem Konto</span>}
              <h3 className="plan-card__name">{p.name}</h3>
              <p className="plan-card__price">
                <strong data-testid={`price-${p.id}`}>{price.label}</strong>
                <span> {price.unit}</span>
              </p>
              <p className="plan-card__billing">{price.note}</p>
              <p className="plan-card__audience">{p.audience}</p>
              {p.locationNote && <p className="plan-card__note">{p.locationNote}</p>}
              <ul className="plan-card__features">
                {p.features.map((f) => (
                  <li key={f}>
                    <Check size={14} /> {f}
                  </li>
                ))}
              </ul>
              {!user ? (
                <button type="button" className="btn btn--accent plan-card__cta" onClick={() => choose(p.id)} data-testid={`choose-${p.id}`}>
                  <span>Konto erstellen</span>
                </button>
              ) : !fits ? (
                <button type="button" className="btn plan-card__cta" disabled data-testid={`choose-${p.id}`} title="Der Tarif richtet sich nach dem Kontotyp aus der Registrierung.">
                  <Lock size={15} />
                  <span>{PLAN_ONLY_FOR[p.id]}</span>
                </button>
              ) : manualActive ? (
                <button type="button" className="btn plan-card__cta" disabled data-testid={`choose-${p.id}`}>
                  <BadgeCheck size={15} />
                  <span>Sonderlizenz aktiv</span>
                </button>
              ) : hasLiveSubscription ? (
                <div className="plan-card__manage" data-testid={`choose-${p.id}`}>
                  <ManageSubscriptionButton />
                </div>
              ) : (
                <button type="button" className="btn btn--accent plan-card__cta" disabled={!isAdmin} onClick={() => choose(p.id)} data-testid={`choose-${p.id}`}>
                  <CreditCard size={15} />
                  <span>{isAdmin ? 'Jetzt buchen' : 'Buchung durch die Administration'}</span>
                </button>
              )}
            </article>
          );
        })}
      </div>
      <p className="plan-grid__note" data-testid="stripe-note">
        <ShieldCheck size={13} /> Sichere Zahlung über Stripe. Freischaltung erst nach bestätigter Zahlung. Kündbar über „Abonnement verwalten“. Der buchbare Tarif richtet sich nach dem Kontotyp aus der Registrierung.
      </p>
      {checkout && <CheckoutDialog plan={checkout.plan} interval={checkout.interval} onClose={() => setCheckout(null)} />}
      {demo.dialog}
    </div>
  );
}

function DemoCard({ onStart, busy, running }: { onStart: () => void; busy: boolean; running: boolean }) {
  const navigate = useNavigate();
  const user = useCloud((s) => s.user);
  const account = useCloud((s) => s.account);
  const access = useCloud((s) => s.access);
  const used = !!account?.billing?.demoUsed;
  const licensed = canUseSimulator(access) && !running;
  const startable = !user || canStartDemo(account, access);
  useSecondTick(running);
  return (
    <article className={`plan-card demo-card${running ? ' is-running' : ''}`} data-testid="plan-demo">
      <span className="demo-card__badge">
        <Sparkles size={12} /> Kostenlos testen
      </span>
      <h3 className="demo-card__name">{DEMO_PLAN.name}</h3>
      <p className="plan-card__price">
        <strong data-testid="demo-price">{DEMO_PLAN.priceLabel}</strong>
        <span> · {DEMO_PLAN.durationLabel}</span>
      </p>
      <p className="plan-card__billing">keine Zahlungsdaten · kein Abonnement</p>
      <ul className="plan-card__features demo-card__features">
        {DEMO_PLAN.highlights.map((f) => (
          <li key={f}>
            <Check size={14} /> {f}
          </li>
        ))}
      </ul>
      {running ? (
        <button type="button" className="btn btn--accent plan-card__cta" onClick={() => navigate('/dashboard')} data-testid="demo-start">
          <Clock3 size={15} />
          <span>Demo läuft · {formatCountdown(demoRemainingMs(account, serverDate()))}</span>
        </button>
      ) : startable ? (
        <button type="button" className="btn btn--accent plan-card__cta" onClick={onStart} disabled={busy} data-testid="demo-start">
          <Sparkles size={15} />
          <span>{busy ? 'Demo wird gestartet …' : 'Demo starten'}</span>
        </button>
      ) : (
        <button type="button" className="btn plan-card__cta" disabled data-testid="demo-start">
          <Lock size={15} />
          <span>{licensed ? 'Lizenz bereits aktiv' : used ? 'Demo bereits genutzt' : 'Nur für die Administration'}</span>
        </button>
      )}
    </article>
  );
}
