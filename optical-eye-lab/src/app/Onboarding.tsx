/**
 * Kurze Einführung beim ersten Start (jederzeit überspringbar, in den Einstellungen erneut aufrufbar).
 *
 * SaaS-Modus (Phase 8): 3 Schritte – Willkommen, Navigation, Anwendung starten.
 * Lokaler Demo-Modus: bisherige 4 Schritte inkl. Hinweis auf die lokale Datenspeicherung.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Compass, FolderOpen, HardDrive, LayoutTemplate, MousePointer2, Rocket, Sparkles } from 'lucide-react';
import { Dialog } from '@/ui/common/overlays';
import { Button } from '@/ui/ds';
import { useAppStore } from '@/state/store';
import { CLOUD_ENABLED } from '@/cloud/config';
import { DEMO_PLAN } from '@/cloud/plans';
import { useSession } from './session';
import { useCloud } from './cloudSession';
import { useProductName } from './Brand';

type Step = { icon: typeof Sparkles; title: string; text: string; actions?: boolean };

export function Onboarding() {
  const [step, setStep] = useState(0);
  const name = useProductName();
  const navigate = useNavigate();
  const first = useSession((s) => s.user?.firstName);
  const demo = useCloud((s) => s.access === 'demo');
  const finish = () => useAppStore.getState().setPrefs({ onboardingDone: true });
  const go = (to: string) => {
    finish();
    navigate(to);
  };

  const steps: Step[] = CLOUD_ENABLED
    ? [
        {
          icon: Sparkles,
          title: `Willkommen bei ${name}${first ? `, ${first}` : ''}!`,
          text: `${name} ist eine interaktive 3D-Simulation für die Augenoptik: Modellauge, Brillengläser, Kontaktlinsen und Strahlengang – physikalisch berechnet und live veränderbar.${demo ? ` Ihre Demo läuft ${DEMO_PLAN.durationLabel} mit vollem Funktionsumfang; die verbleibende Zeit sehen Sie oben.` : ''}`,
        },
        {
          icon: Compass,
          title: 'Das Wichtigste auf einen Blick',
          text: 'Links finden Sie Dashboard, Module (Skiaskopie, Refraktion, Patientensicht, Kontaktlinse, Brillenglas), „Meine Simulationen“ und Vorlagen. Konto, Lizenz und Abonnement erreichen Sie unten links über Ihren Namen. Alles, was Sie speichern, liegt sicher in Ihrem Konto – auf jedem Gerät verfügbar.',
        },
        {
          icon: Rocket,
          title: 'Los geht’s',
          text: 'Starten Sie direkt im vollständigen Simulator oder mit einer fertigen Vorlage. Im Simulator: Linksklick wählt aus, rechte Maustaste dreht, Mausrad zoomt – Werte ändern Sie rechts im Inspector.',
          actions: true,
        },
      ]
    : [
        {
          icon: Sparkles,
          title: `Willkommen${first ? `, ${first}` : ''}!`,
          text: `${name} ist eine interaktive 3D-Simulation für die Augenoptik: Modellauge, Brillengläser, Kontaktlinsen, Tränenlinse und Strahlengang – physikalisch berechnet und live veränderbar.`,
        },
        {
          icon: FolderOpen,
          title: 'Simulationen & Vorlagen',
          text: 'Starten Sie eine neue Simulation leer oder aus einer Vorlage (z. B. Myopie, torische KL, Tränenlinse). Alles, was Sie speichern, finden Sie unter „Meine Simulationen“ – mit Suche, Filtern und Favoriten.',
        },
        {
          icon: MousePointer2,
          title: 'Im Simulator',
          text: 'Linksklick wählt aus, rechte Maustaste dreht die Kamera, das Mausrad zoomt. Werte ändern Sie rechts im Inspector. Änderungen werden automatisch gespeichert – die Statusleiste zeigt, wann zuletzt.',
        },
        {
          icon: HardDrive,
          title: 'Ihre Daten bleiben lokal',
          text: 'Konten, Einstellungen und Simulationen werden nur in diesem Browser gespeichert. Die Anmeldung ist eine lokale Demo ohne echte Kontosicherheit. Sichern Sie wichtige Arbeiten über „Exportieren“ als Datei.',
        },
      ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <Dialog
      title={CLOUD_ENABLED ? 'Willkommen' : 'Kurze Einführung'}
      subtitle={`Schritt ${step + 1} von ${steps.length}`}
      onClose={finish}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={finish}>
            Überspringen
          </Button>
          <span className="flex-spacer" />
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Zurück</Button>}
          <Button variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? (CLOUD_ENABLED ? 'Zum Dashboard' : "Los geht's") : 'Weiter'}
          </Button>
        </>
      }
    >
      <div className="onboarding">
        <div className="onboarding__icon">
          <s.icon size={30} strokeWidth={1.5} />
        </div>
        <h3 className="onboarding__title">{s.title}</h3>
        <p className="onboarding__text">{s.text}</p>
        {s.actions && (
          <div className="onboarding__actions">
            <Button variant="primary" icon={Rocket} onClick={() => go('/simulations/new')} data-testid="onboarding-simulator">
              Simulator öffnen
            </Button>
            <Button icon={LayoutTemplate} onClick={() => go('/templates')}>
              Vorlage wählen
            </Button>
          </div>
        )}
        <div className="onboarding__dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'is-active' : ''} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
