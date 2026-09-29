import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { History } from 'lucide-react';
import { useAppStore, configureStoreHooks } from '@/state/store';
import type { SceneDocument } from '@/model/types';
import type { SimulationMetadata } from '@/platform/models';
import { captureViewportThumbnail } from '@/scene/thumbnail';
import { choiceDialog, promptDialog } from '@/ui/ds/modals';
import { migrateDocument } from '@/state/persistence';
import { useSession, errorMessage, currentUser } from '../session';
import { platform } from '../platformInstance';

export type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; meta: SimulationMetadata };

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

  /* ------------------------------ Laden ------------------------------ */
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    setRecovery(null);
    skipGuard.current = false;
    void (async () => {
      const user = currentUser();
      const rec = await platform.library.get(user, id);
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
  }, [id]);

  /* ----------------------- Speichern (Hooks) ----------------------- */
  const save = useCallback(
    async (doc: SceneDocument) => {
      try {
        const thumb = captureViewportThumbnail();
        const meta = await platform.library.save(currentUser(), id, doc, thumb);
        metaRef.current = meta;
        void useSession.getState().refreshLibrary();
        return true;
      } catch (e) {
        useAppStore.getState().notify(`Speichern fehlgeschlagen: ${errorMessage(e)}`, 'warning');
        return false;
      }
    },
    [id],
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

  return { state, recovery, setRecovery, metaRef, skipGuard, leaveWithoutGuard };
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
