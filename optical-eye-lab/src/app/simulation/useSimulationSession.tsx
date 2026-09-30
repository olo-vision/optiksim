import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { History } from 'lucide-react';
import { useAppStore, configureStoreHooks } from '@/state/store';
import type { SceneDocument } from '@/model/types';
import type { SimulationMetadata } from '@/platform/models';
import { captureViewportThumbnail } from '@/scene/thumbnail';
import { choiceDialog, confirmDialog, promptDialog } from '@/ui/ds/modals';
import { ContentConflictError } from '@/platform/content';
import { CloudError } from '@/cloud/types';
import { migrateDocument } from '@/state/persistence';
import { useSession, errorMessage, currentUser } from '../session';
import { platform } from '../platformInstance';

export type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; meta: SimulationMetadata };

/**
 * Sitzung einer Bibliothekssimulation (Phase 5 aus SimulatorPage herausgelöst): Laden in den Simulator-Store,
 * Speichern-Hooks, automatisches Speichern, Absturzsicherung (Entwurf), Schutz vor Verlassen, Aufräumen.
 * Gemeinsam genutzt vom vollständigen Simulator (/simulations/:id) und den Modulen (/modules/:modul/:id).
 */
export interface SessionOptions {
  /**
   * Beim Verlassen ungespeicherte Änderungen ohne Rückfrage speichern (Module: Sitzungen werden
   * fortgeführt, Rückfragen würden den schnellen Wechsel Dashboard ↔ Modul stören).
   */
  saveOnLeave?: boolean;
}

export function useSimulationSession(id: string, opts: SessionOptions = {}) {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [recovery, setRecovery] = useState<{ savedAt: string } | null>(null);
  const metaRef = useRef<SimulationMetadata | null>(null);
  const skipGuard = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const retryLoad = useCallback(() => setAttempt((n) => n + 1), []);

  /* ------------------------------ Laden ------------------------------ */
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    setRecovery(null);
    skipGuard.current = false;
    void (async () => {
      const user = currentUser();
      let rec: Awaited<ReturnType<typeof platform.library.get>>;
      try {
        rec = await platform.library.get(user, id);
      } catch (e) {
        if (alive) setState({ status: 'error', message: errorMessage(e) });
        return;
      }
      if (!alive) return;
      if (!rec) {
        setState({ status: 'missing' });
        return;
      }
      metaRef.current = rec.meta;
      useAppStore.getState().openSimulation(id, rec.doc, Date.parse(rec.meta.updatedAt));
      void platform.library.markOpened(id).then(() => useSession.getState().refreshLibrary());
      // Absturzsicherung: jüngerer, ungespeicherter Stand vorhanden?
      const draft = await platform.repos.getDraft(id);
      if (alive && draft && draft.savedAt > rec.meta.updatedAt && JSON.stringify(draft.doc) !== JSON.stringify(rec.doc)) setRecovery({ savedAt: draft.savedAt });
      setState({ status: 'ready', meta: rec.meta });
    })();
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  /* ----------------------- Speichern (Hooks) ----------------------- */
  const retryTimer = useRef<number | undefined>(undefined);
  const offlineNotified = useRef(false);
  useEffect(() => () => window.clearTimeout(retryTimer.current), [id]);

  /**
   * Neuerer Stand auf einem anderen Gerät/in einem anderen Fenster (nur Cloud):
   * als Kopie speichern (nichts geht verloren) oder bewusst überschreiben.
   */
  const resolveConflict = useCallback(
    async (doc: SceneDocument, conflict: ContentConflictError, thumb: string | null): Promise<boolean> => {
      const user = currentUser();
      if (conflict.remoteDeleted) {
        const ok = await confirmDialog({
          title: 'Simulation wurde gelöscht',
          message: `„${doc.name}“ wurde inzwischen auf einem anderen Gerät gelöscht. Möchten Sie Ihren aktuellen Stand als neue Simulation speichern?`,
          confirmLabel: 'Als neue Simulation speichern',
        });
        if (!ok) return false;
      } else {
        const choice = await choiceDialog({
          title: 'Neuerer Stand vorhanden',
          message: `„${doc.name}“ wurde inzwischen auf einem anderen Gerät oder in einem anderen Fenster gespeichert. Wie möchten Sie Ihren Stand speichern?`,
          confirmLabel: 'Als Kopie speichern',
          altLabel: 'Überschreiben',
        });
        if (choice === 'cancel') return false;
        if (choice === 'alt') {
          metaRef.current = await platform.library.save(user, id, doc, thumb, { force: true });
          void useSession.getState().refreshLibrary();
          return true;
        }
      }
      const names = useSession.getState().sims.map((m) => m.name);
      const name = names.includes(`${doc.name} (Kopie)`) ? `${doc.name} (Kopie ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})` : `${doc.name} (Kopie)`;
      const rec = await platform.library.saveAs(user, { ...doc, name }, name, metaRef.current ?? undefined, thumb);
      await platform.repos.clearDraft(id);
      await useSession.getState().refreshLibrary();
      useAppStore.getState().notify(`Als „${name}“ gespeichert`, 'success');
      // Kopie öffnen (gleiche Ansicht: Simulator oder Modul)
      skipGuard.current = true;
      useAppStore.setState({ dirty: false });
      navigate(window.location.pathname.replace(id, rec.meta.id), { replace: true });
      return true;
    },
    [id, navigate],
  );

  const save = useCallback(
    async (doc: SceneDocument) => {
      const thumb = captureViewportThumbnail();
      try {
        const meta = await platform.library.save(currentUser(), id, doc, thumb);
        metaRef.current = meta;
        offlineNotified.current = false;
        void useSession.getState().refreshLibrary();
        return true;
      } catch (e) {
        try {
          if (e instanceof ContentConflictError) return await resolveConflict(doc, e, thumb);
        } catch (e2) {
          e = e2;
        }
        if (e instanceof CloudError && e.code === 'network') {
          // Stand ist als Entwurf auf diesem Gerät gesichert; in 20 s erneut versuchen
          window.clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(() => {
            const st = useAppStore.getState();
            if (st.dirty && st.simId === id) void st.saveCurrent({ silent: true });
          }, 20_000);
          if (!offlineNotified.current) {
            offlineNotified.current = true;
            useAppStore.getState().notify('Keine Verbindung zum Server. Ihre Änderungen sind auf diesem Gerät gesichert und werden automatisch gespeichert, sobald die Verbindung wieder besteht.', 'warning');
          }
          return false;
        }
        useAppStore.getState().notify(`Speichern fehlgeschlagen: ${errorMessage(e)}`, 'warning');
        return false;
      }
    },
    [id, resolveConflict],
  );

  useEffect(() => {
    if (state.status !== 'ready') return;
    configureStoreHooks({
      save,
      writeDraft: (doc) => {
        platform.repos.saveDraft({ simId: id, savedAt: new Date().toISOString(), doc }).catch(() => undefined);
      },
    });
    return () => configureStoreHooks({ save: undefined, writeDraft: undefined });
  }, [state.status, save, id]);

  /* ---------------------- Automatisches Speichern ---------------------- */
  useEffect(() => {
    if (state.status !== 'ready') return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const s = useAppStore.getState();
      if (!s.prefs.autoSave || !s.dirty || s.simId !== id) return;
      timer = window.setTimeout(() => {
        const st = useAppStore.getState();
        if (st.gestureActive) return schedule();
        if (st.dirty && st.prefs.autoSave && st.simId === id) void st.saveCurrent({ silent: true });
      }, s.prefs.autoSaveDelaySec * 1000);
    };
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc || s.dirty !== prev.dirty || s.prefs.autoSave !== prev.prefs.autoSave || s.gestureActive !== prev.gestureActive) schedule();
    });
    schedule();
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [state.status, id]);

  /* ----------------------- Verlassen absichern ----------------------- */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useAppStore.getState().dirty && !skipGuard.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !skipGuard.current && useAppStore.getState().dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const policy = opts.saveOnLeave ? 'save' : useAppStore.getState().prefs.onCloseUnsaved;
    void (async () => {
      let choice: 'confirm' | 'alt' | 'cancel';
      if (policy === 'save') choice = 'confirm';
      else if (policy === 'discard') choice = 'alt';
      else
        choice = await choiceDialog({
          title: 'Änderungen speichern?',
          message: `„${useAppStore.getState().doc.name}“ enthält ungespeicherte Änderungen.`,
          confirmLabel: 'Speichern',
          altLabel: 'Nicht speichern',
        });
      if (choice === 'cancel') {
        blocker.reset?.();
        return;
      }
      if (choice === 'confirm') {
        const ok = await useAppStore.getState().saveCurrent({ silent: true });
        if (!ok) {
          blocker.reset?.();
          return;
        }
      } else {
        await platform.repos.clearDraft(id);
        useAppStore.setState({ dirty: false });
      }
      blocker.proceed?.();
    })();
  }, [blocker, id, opts.saveOnLeave]);

  /* -------------------- Aufräumen beim Verlassen -------------------- */
  useEffect(
    () => () => {
      useAppStore.setState({ simId: null, shell: null, dialog: null });
    },
    [],
  );

  const leaveWithoutGuard = useCallback(
    (to: string) => {
      skipGuard.current = true;
      navigate(to);
    },
    [navigate],
  );

  return { state, recovery, setRecovery, metaRef, skipGuard, leaveWithoutGuard, retryLoad };
}

/** Hinweis „ungespeicherte Änderungen wiederherstellen?“ (Absturzsicherung) */
export function RecoveryBanner({ id, recovery, onDone }: { id: string; recovery: { savedAt: string } | null; onDone: () => void }) {
  if (!recovery) return null;
  return (
    <div className="sim-banner" role="alert">
      <History size={15} />
      <span>Es gibt ungespeicherte Änderungen vom {new Date(recovery.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.</span>
      <button
        type="button"
        className="sim-banner__btn sim-banner__btn--primary"
        onClick={async () => {
          const d = await platform.repos.getDraft(id);
          const doc = d ? migrateDocument(d.doc) : null;
          if (doc) {
            useAppStore.getState().commit(() => doc);
            useAppStore.getState().notify('Ungespeicherte Änderungen wiederhergestellt', 'success');
          }
          onDone();
        }}
      >
        Wiederherstellen
      </button>
      <button
        type="button"
        className="sim-banner__btn"
        onClick={() => {
          void platform.repos.clearDraft(id);
          onDone();
        }}
      >
        Verwerfen
      </button>
    </div>
  );
}

/** Geöffnete Simulation umbenennen (Dokument + Bibliothek) – Simulator und Module */
export async function renameCurrentSimulation(id: string) {
  const st = useAppStore.getState();
  const name = await promptDialog({ title: 'Simulation umbenennen', label: 'Name', initial: st.doc.name, confirmLabel: 'Umbenennen' });
  if (!name || name === st.doc.name) return;
  st.setSceneName(name);
  try {
    await platform.library.rename(currentUser(), id, name);
    await useSession.getState().refreshLibrary();
  } catch (e) {
    st.notify(errorMessage(e), 'warning');
  }
}
