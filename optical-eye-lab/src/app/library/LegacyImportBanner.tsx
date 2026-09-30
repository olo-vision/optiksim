/**
 * Hinweis auf Simulationen aus einer früheren Version (vor den Benutzerkonten), die nur in diesem Browser
 * liegen. Sie werden erst nach ausdrücklicher Bestätigung in das Konto übernommen – der Browser kann
 * nicht wissen, welchem Konto sie gehören.
 */
import { useState } from 'react';
import { History } from 'lucide-react';
import { Button, Notice } from '@/ui/ds';
import { useCloud } from '../cloudSession';
import { useAppStore } from '@/state/store';
import { errorMessage } from '../session';

export function LegacyImportBanner() {
  const pending = useCloud((s) => s.localImport?.legacyPending ?? 0);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!pending || hidden) return null;
  const n = pending === 1 ? 'eine Simulation' : `${pending} Simulationen`;
  return (
    <Notice
      icon={History}
      className="page-notice"
      title="Simulationen aus einer früheren Version gefunden"
      actions={
        <>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const count = await useCloud.getState().importLegacy();
                useAppStore.getState().notify(`${count} ${count === 1 ? 'Simulation' : 'Simulationen'} in Ihr Konto übernommen.`, 'success');
              } catch (e) {
                useAppStore.getState().notify(errorMessage(e), 'warning');
              } finally {
                setBusy(false);
              }
            }}
          >
            In mein Konto übernehmen
          </Button>
          <Button size="sm" onClick={() => setHidden(true)}>
            Später
          </Button>
        </>
      }
    >
      In diesem Browser liegt {n} aus einer früheren Version von OLO-LAB3D. Übernehmen Sie sie nur, wenn sie zu Ihrem Konto gehört – danach steht sie auf allen Ihren Geräten zur Verfügung.
    </Notice>
  );
}
