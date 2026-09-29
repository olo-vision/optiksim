/**
 * Kaufabschluss und Demo-Start (Phase 8).
 *
 * CheckoutDialog – „Bestellung prüfen“: Paket, Intervall, Preis, erforderliche Rechtstexte (aktuelle
 *   Versionen, verlinkt) → Weiterleitung zu Stripe. Der Server prüft Preis und Zustimmungen erneut.
 * DemoDialog / useDemoStart – kostenlose Demo: 0 €, keine Zahlungsdaten, kein Abo; nur falls noch
 *   Zustimmungen fehlen (z. B. neue Version der Nutzungsbedingungen) erscheint ein Dialog, sonst startet
 *   die Demo direkt.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { CircleCheck, Clock3, CreditCard, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Dialog } from '@/ui/common/overlays';
import { Button } from '@/ui/ds';
import { cloudBackend, useCloud } from '../../cloudSession';
import { allConsentsGiven, requiredDocs } from '@/cloud/legal';
import { B2B_COUNTRY_MESSAGE, DEMO_PLAN, endsAutomatically, isB2B, planInfo, planPrice } from '@/cloud/plans';
import type { BillingInterval, LegalDocRef, LicensePlan } from '@/cloud/types';
import { CloudError } from '@/cloud/types';
import { useAppStore } from '@/state/store';
import { LegalConsentList, useConsentState, useRequiredLegalDocs } from './LegalConsents';

const notify = (m: string, tone: 'success' | 'warning' = 'warning') => useAppStore.getState().notify(m, tone);

/* ------------------------------------------------------------------------------------------------ */

export function CheckoutDialog({ plan, interval, onClose }: { plan: LicensePlan; interval: BillingInterval; onClose: () => void }) {
  const type = useCloud((s) => s.account?.institution?.type ?? null);
  const country = useCloud((s) => s.account?.institution?.country ?? 'DE');
  // B2B vorerst nur mit Sitz in Deutschland (der Server prüft das ebenfalls)
  const blocked = isB2B(type) && (country ?? 'DE').toUpperCase() !== 'DE';
  const { docs, error, reload } = useRequiredLegalDocs('checkout', type);
  const { checked, toggle, reset } = useConsentState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const info = planInfo(plan)!;
  const price = planPrice(info, interval);
  const ready = !!docs && allConsentsGiven(docs, checked) && !blocked;
  const autoEnd = endsAutomatically(plan, interval);

  const submit = async () => {
    if (!docs) return;
    setBusy(true);
    setProblem(null);
    try {
      const ids = requiredDocs(docs).filter((d) => checked.has(d.id)).map((d) => d.id);
      window.location.assign(await cloudBackend().startCheckout(plan, interval, ids));
    } catch (e) {
      const code = e instanceof CloudError ? e.code : undefined;
      if (code === 'consents_outdated' || code === 'OLC02') {
        reset();
        await reload();
      }
      setProblem(e instanceof Error ? e.message : 'Die Zahlungsseite konnte nicht geöffnet werden.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Bestellung prüfen"
      subtitle="Im nächsten Schritt gibst du deine Zahlungsdaten sicher bei Stripe ein."
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <span className="flex-spacer" />
          <Button variant="primary" icon={Lock} loading={busy} disabled={!ready} onClick={() => void submit()} data-testid="checkout-continue">
            Weiter zur sicheren Zahlung
          </Button>
        </>
      }
    >
      <div className="purchase" data-testid="checkout-dialog">
        <div className="purchase__summary">
          <div>
            <strong>{info.name}</strong>
            <span>{info.locationNote ?? info.audience}</span>
          </div>
          <div className="purchase__price">
            <strong data-testid="checkout-price">{price.label}</strong>
            <span>
              {price.unit} · {price.note}
            </span>
          </div>
        </div>
        <ul className="purchase__facts">
          <li>
            <CircleCheck size={14} /> Voller Funktionsumfang, sofort nach der Zahlungsbestätigung
          </li>
          <li data-testid="checkout-term">
            <CircleCheck size={14} />{' '}
            {interval === 'monthly'
              ? 'Monatliche Abrechnung im Voraus; das Abonnement verlängert sich monatlich und ist jederzeit zum Ende des Abrechnungsmonats kündbar'
              : autoEnd
                ? 'Einmalige Zahlung für 12 Monate; die Lizenz endet danach automatisch – keine Verlängerung, keine weitere Abbuchung'
                : 'Jährliche Abrechnung im Voraus; das Abonnement verlängert sich um jeweils 12 Monate und ist jederzeit zum Laufzeitende kündbar'}
          </li>
          <li>
            <CircleCheck size={14} /> Alle Preise sind Endpreise inkl. 19 % USt.
          </li>
          {isB2B(type) && (
            <li>
              <CircleCheck size={14} /> Rechnungsanschrift und USt-IdNr. gibst du bei Stripe an – sie erscheinen auf deiner Rechnung (derzeit nur mit Sitz in Deutschland)
            </li>
          )}
        </ul>
        {docs === null ? (
          <p className="muted">Rechtstexte werden geladen …</p>
        ) : (
          <LegalConsentList docs={docs} checked={checked} onToggle={toggle} />
        )}
        {error && <p className="ds-field__error">{error}</p>}
        {problem && (
          <p className="ds-field__error" role="alert" data-testid="checkout-error">
            {problem}
          </p>
        )}
        {blocked && (
          <p className="auth-note auth-note--warn" role="alert" data-testid="checkout-country">
            {B2B_COUNTRY_MESSAGE}
          </p>
        )}
        <p className="purchase__order-note" data-testid="checkout-order-note">
          <Lock size={13} />
          <span>
            Mit „Weiter zur sicheren Zahlung“ gelangst du zur Bestellseite von Stripe. Dort gibst du deine Zahlungsdaten ein; <strong>zahlungspflichtig bestellt ist erst mit dem Klick auf „Abonnieren“</strong> auf der Stripe-Seite. Bis dahin kannst du alle Angaben ändern oder abbrechen.
          </span>
        </p>
        <p className="purchase__secure">
          <ShieldCheck size={13} /> Zahlung über Stripe. Freigeschaltet wird erst nach bestätigter Zahlung.
        </p>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function DemoDialog({ docs, onClose, onStarted }: { docs: LegalDocRef[]; onClose: () => void; onStarted: () => void }) {
  const { checked, toggle } = useConsentState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = allConsentsGiven(docs, checked);
  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await useCloud.getState().startDemo([...checked]);
      onStarted();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Die Demo konnte nicht gestartet werden.');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Demo starten"
      subtitle={`${DEMO_PLAN.durationLabel} voller Zugriff – kostenlos, ohne Zahlungsdaten.`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <span className="flex-spacer" />
          <Button variant="primary" icon={Sparkles} loading={busy} disabled={!ready} onClick={() => void start()} data-testid="demo-confirm">
            Demo starten
          </Button>
        </>
      }
    >
      <div className="purchase" data-testid="demo-dialog">
        <DemoFacts />
        <LegalConsentList docs={docs} checked={checked} onToggle={toggle} />
        {problem && (
          <p className="ds-field__error" role="alert">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function DemoFacts() {
  return (
    <ul className="purchase__facts">
      <li>
        <Clock3 size={14} /> Endet automatisch nach {DEMO_PLAN.durationLabel} – es beginnt kein Abonnement
      </li>
      <li>
        <CreditCard size={14} /> 0 € · keine Zahlungsdaten erforderlich
      </li>
      <li>
        <CircleCheck size={14} /> Voller Funktionsumfang · nur einmal pro Kundenkonto
      </li>
    </ul>
  );
}

/**
 * Demo-Start: fehlen keine Zustimmungen (Normalfall – bei der Registrierung erteilt), startet die Demo
 * sofort; sonst zeigt ein Dialog nur die noch offenen Dokumente.
 */
export function useDemoStart() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<LegalDocRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useCallback(() => {
    setPending(null);
    notify(`Deine Demo läuft – ${DEMO_PLAN.durationLabel} voller Zugriff.`, 'success');
    navigate('/dashboard', { replace: true });
  }, [navigate]);
  const begin = useCallback(async () => {
    const type = useCloud.getState().account?.institution?.type;
    if (!type) return;
    setBusy(true);
    try {
      const [docs, done] = await Promise.all([cloudBackend().requiredLegalDocuments('demo', type), cloudBackend().myConsentedDocumentIds()]);
      const open = requiredDocs(docs).filter((d) => !done.includes(d.id));
      if (open.length) {
        setPending(open);
      } else {
        await useCloud.getState().startDemo([]);
        started();
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Die Demo konnte nicht gestartet werden.');
    } finally {
      setBusy(false);
    }
  }, [started]);
  const dialog = pending ? <DemoDialog docs={pending} onClose={() => setPending(null)} onStarted={started} /> : null;
  return { begin, busy, dialog };
}
