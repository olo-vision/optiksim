/**
 * Kurze Einführung beim ersten Start (4 Schritte, jederzeit überspringbar,
 * in den Einstellungen erneut aufrufbar).
 */
import { useState } from 'react';
import { FolderOpen, HardDrive, MousePointer2, Sparkles } from 'lucide-react';
import { Dialog } from '@/ui/common/overlays';
import { Button } from '@/ui/ds';
import { useAppStore } from '@/state/store';
import { useSession } from './session';
import { useProductName } from './Brand';

export function Onboarding() {
  const [step, setStep] = useState(0);
  const name = useProductName();
  const first = useSession((s) => s.user?.firstName);
  const finish = () => useAppStore.getState().setPrefs({ onboardingDone: true });
  const steps = [
    {
      icon: Sparkles,
      title: `Willkommen${first ? `, ${first}` : ''}!`,
      text: `${name} ist eine interaktive 3D-Simulation für die Augenoptik: Modellauge, Brillengläser, Kontaktlinsen, Tränenlinse und Strahlengang – physikalisch berechnet und live veränderbar.`,
    },
    {
      icon: FolderOpen,
      title: 'Simulationen & Vorlagen',
      text: 'Starte eine neue Simulation leer oder aus einer Vorlage (z. B. Myopie, torische KL, Tränenlinse). Alles, was du speicherst, findest du unter „Meine Simulationen“ – mit Suche, Filtern und Favoriten.',
    },
    {
      icon: MousePointer2,
      title: 'Im Simulator',
      text: 'Linksklick wählt aus, rechte Maustaste dreht die Kamera, das Mausrad zoomt. Werte änderst du rechts im Inspector. Änderungen werden automatisch gespeichert – die Statusleiste zeigt, wann zuletzt.',
    },
    {
      icon: HardDrive,
      title: 'Deine Daten bleiben lokal',
      text: 'Konten, Einstellungen und Simulationen werden nur in diesem Browser gespeichert. Die Anmeldung ist eine lokale Demo ohne echte Kontosicherheit. Sichere wichtige Arbeiten über „Exportieren“ als Datei.',
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <Dialog
      title="Kurze Einführung"
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
            {last ? "Los geht's" : 'Weiter'}
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
        <div className="onboarding__dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'is-active' : ''} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
