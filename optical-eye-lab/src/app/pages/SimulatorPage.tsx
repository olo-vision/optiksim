/**
 * Simulator in der Anwendung (/simulations/:id).
 *
 * Lädt einen Bibliothekseintrag in den Simulator-Store und verbindet ihn mit der Plattform:
 * Speichern / Speichern unter / Duplizieren / Als Vorlage / Export, automatisches Speichern,
 * Absturzsicherung (Entwurf), Vorschaubild, Schutz vor Verlassen mit ungespeicherten Änderungen.
 * Die Physik und die Simulator-Oberfläche selbst bleiben unverändert.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronDown, ChevronRight, Copy, Download, FolderOpen, LayoutTemplate, Pencil, RefreshCcw, Save, SaveAll, Upload, X, FileQuestion, History } from 'lucide-react';
import { SimulatorWorkspace } from '@/App';
import { useAppStore } from '@/state/store';
import { configureStoreHooks } from '@/state/store';
import { useSession, errorMessage, currentUser } from '../session';
import { platform } from '../platformInstance';
import { Splash } from '../Splash';
import { Brand, useProductName } from '../Brand';
import { UserMenu } from '../AppLayout';
import { Menu } from '@/ui/common/overlays';
import { Button, EmptyState } from '@/ui/ds';
import { choiceDialog, promptDialog } from '@/ui/ds/modals';
import { captureViewportThumbnail } from '@/scene/thumbnail';
import { openAppDialog, importFiles } from '../library/actions';
import { downloadText, FILE_EXTENSION, safeFileName, serializeSimulation } from '@/platform/fileFormat';
import type { SimulationMetadata } from '@/platform/models';
import { uniqueName } from '@/platform/library';
import { usePageTitle } from '../usePageTitle';
import { migrateDocument } from '@/state/persistence';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';

/** /simulations/new?template=<id>&name=<name> – legt an und öffnet (z. B. für Links aus Vorlagen). */
export function NewSimulationRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const template = params.get('template');
    const name = params.get('name') ?? undefined;
    if (!template) {
      navigate('/simulations', { replace: true });
      openAppDialog({ kind: 'new-simulation' });
      return;
    }
    platform.library
      .createFromTemplate(currentUser(), template, name)
      .then(async (rec) => {
        await useSession.getState().refreshLibrary();
        navigate(`/simulations/${rec.meta.id}`, { replace: true });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [params, navigate]);
  if (error)
    return (
      <div className="page-center">
        <EmptyState icon={FileQuestion} title="Simulation konnte nicht angelegt werden" text={error} action={<Button onClick={() => navigate('/simulations')}>Zur Bibliothek</Button>} />
      </div>
    );
  return <Splash message="Simulation wird angelegt …" />;
}

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; meta: SimulationMetadata };

export function SimulatorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [recovery, setRecovery] = useState<{ savedAt: string } | null>(null);
  const metaRef = useRef<SimulationMetadata | null>(null);
  const skipGuard = useRef(false);
  const docName = useAppStore((s) => (s.simId === id ? s.doc.name : ''));
  usePageTitle(docName || 'Simulation');

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
    async (doc: import('@/model/types').SceneDocument) => {
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
    const policy = useAppStore.getState().prefs.onCloseUnsaved;
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
  }, [blocker, id]);

  /* -------------------- Aufräumen beim Verlassen -------------------- */
  useEffect(
    () => () => {
      useAppStore.setState({ simId: null, shell: null, dialog: null });
    },
    [],
  );

  /* -------------------------- Menüaktionen -------------------------- */
  const leaveWithoutGuard = (to: string) => {
    skipGuard.current = true;
    navigate(to);
  };

  const saveAs = useCallback(async () => {
    const st = useAppStore.getState();
    const names = useSession.getState().sims.map((m) => m.name);
    const name = await promptDialog({ title: 'Speichern unter', label: 'Name der neuen Simulation', initial: uniqueName(st.doc.name, names), confirmLabel: 'Speichern' });
    if (!name) return;
    try {
      const rec = await platform.library.saveAs(currentUser(), { ...st.doc, name }, name, metaRef.current ?? undefined, captureViewportThumbnail());
      await useSession.getState().refreshLibrary();
      st.notify(`Als „${rec.meta.name}“ gespeichert`, 'success');
      // Die ursprüngliche Simulation behält ihren gespeicherten Stand
      await platform.repos.clearDraft(id);
      useAppStore.setState({ dirty: false });
      leaveWithoutGuard(`/simulations/${rec.meta.id}`);
    } catch (e) {
      st.notify(errorMessage(e), 'warning');
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicate = useCallback(async () => {
    const st = useAppStore.getState();
    try {
      const names = useSession.getState().sims.map((m) => m.name);
      const name = uniqueName(st.doc.name, names);
      const rec = await platform.library.saveAs(currentUser(), { ...st.doc, name }, name, metaRef.current ?? undefined, captureViewportThumbnail());
      await useSession.getState().refreshLibrary();
      st.notify(`Kopie „${rec.meta.name}“ angelegt – aktuelle Simulation bleibt geöffnet`, 'success');
    } catch (e) {
      st.notify(errorMessage(e), 'warning');
    }
  }, []);

  const rename = useCallback(async () => {
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
  }, [id]);

  const exportFile = useCallback(() => {
    const st = useAppStore.getState();
    const meta = metaRef.current;
    if (!meta) return;
    downloadText(serializeSimulation({ meta: { ...meta, name: st.doc.name }, doc: st.doc }), `${safeFileName(st.doc.name)}${FILE_EXTENSION}`);
    st.notify('Als .opticsim-Datei exportiert (aktueller Stand)', 'success');
  }, []);

  const importFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},.json,application/json`;
    input.onchange = async () => {
      if (!input.files?.length) return;
      const ids = await importFiles(input.files);
      if (ids[0]) navigate(`/simulations/${ids[0]}`);
    };
    input.click();
  }, [navigate]);

  const shell = {
    saveAs: () => void saveAs(),
    duplicate: () => void duplicate(),
    saveAsTemplate: () => openAppDialog({ kind: 'save-template', doc: useAppStore.getState().doc, meta: metaRef.current ?? undefined }),
    exportFile,
    importFile,
    close: () => navigate('/simulations'),
    openLibrary: () => navigate('/simulations'),
    rename: () => void rename(),
  };
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(() => {
    if (state.status !== 'ready') return;
    useAppStore.setState({
      shell: {
        saveAs: () => shellRef.current.saveAs(),
        duplicate: () => shellRef.current.duplicate(),
        saveAsTemplate: () => shellRef.current.saveAsTemplate(),
        exportFile: () => shellRef.current.exportFile(),
        importFile: () => shellRef.current.importFile(),
        close: () => shellRef.current.close(),
        openLibrary: () => shellRef.current.openLibrary(),
        rename: () => shellRef.current.rename(),
      },
    });
  }, [state.status]);

  /* ------------------------------ Anzeige ------------------------------ */
  if (state.status === 'loading') return <Splash message="Simulation wird geöffnet …" />;
  if (state.status === 'missing')
    return (
      <div className="page-center">
        <EmptyState
          icon={FileQuestion}
          title="Simulation nicht gefunden"
          text="Sie wurde gelöscht, gehört zu einem anderen Konto oder die Adresse ist falsch."
          action={
            <Button variant="primary" icon={FolderOpen} onClick={() => navigate('/simulations')}>
              Zu meinen Simulationen
            </Button>
          }
        />
      </div>
    );

  const restoreBanner = recovery && (
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
          setRecovery(null);
        }}
      >
        Wiederherstellen
      </button>
      <button
        type="button"
        className="sim-banner__btn"
        onClick={() => {
          void platform.repos.clearDraft(id);
          setRecovery(null);
        }}
      >
        Verwerfen
      </button>
    </div>
  );

  return <SimulatorWorkspace leading={<SimulatorNav />} trailing={<UserMenu compact direction="down" />} banner={restoreBanner} />;
}

/** Breadcrumb „Optical Eye Lab › Meine Simulationen › Name ▾“ mit Simulationsmenü und Speicherstatus. */
function SimulatorNav() {
  const productName = useProductName();
  const name = useAppStore((s) => s.doc.name);
  const dirty = useAppStore((s) => s.dirty);
  const saving = useAppStore((s) => s.saving);
  const shell = useAppStore((s) => s.shell);
  const saveCurrent = useAppStore((s) => s.saveCurrent);
  const resetScene = useAppStore((s) => s.resetScene);
  return (
    <nav className="sim-nav" aria-label="Brotkrümelnavigation">
      <Link to="/dashboard" className="sim-nav__home" aria-label="Zum Dashboard" data-tip={`${productName} · Dashboard`}>
        <Brand compact />
      </Link>
      <ChevronRight size={13} className="sim-nav__sep" aria-hidden />
      <Link to="/simulations" className="sim-nav__link">
        Meine Simulationen
      </Link>
      <ChevronRight size={13} className="sim-nav__sep" aria-hidden />
      <Menu
        width={290}
        label="Simulationsmenü"
        trigger={(open) => (
          <button type="button" className={`toolbar__menu-btn${open ? ' is-open' : ''}`} aria-label={`Simulationsmenü ${name}`}>
            <span className="toolbar__scene-name">{name}</span>
            {dirty && <span className="dirty-dot" data-tip="Ungespeicherte Änderungen" />}
            <ChevronDown size={13} />
          </button>
        )}
        items={[
          { heading: true, label: 'Simulation' },
          { label: 'Speichern', icon: Save, shortcut: `${MOD}S`, onSelect: () => void saveCurrent(), disabled: saving, description: 'Lokal in der Bibliothek' },
          { label: 'Speichern unter …', icon: SaveAll, shortcut: `${MOD}⇧S`, onSelect: () => shell?.saveAs() },
          { label: 'Umbenennen …', icon: Pencil, onSelect: () => shell?.rename() },
          { label: 'Duplizieren', icon: Copy, onSelect: () => shell?.duplicate(), description: 'Kopie des aktuellen Stands anlegen' },
          { label: 'Als Vorlage speichern …', icon: LayoutTemplate, onSelect: () => shell?.saveAsTemplate() },
          { label: 'Zurücksetzen', icon: RefreshCcw, onSelect: resetScene, disabled: !dirty, description: 'Auf den zuletzt gespeicherten Stand' },
          { separator: true, label: '' },
          { label: 'Exportieren', icon: Download, onSelect: () => shell?.exportFile(), description: '.opticsim-Datei' },
          { label: 'Importieren …', icon: Upload, onSelect: () => shell?.importFile(), description: 'Als neue Simulation öffnen' },
          { separator: true, label: '' },
          { label: 'Meine Simulationen', icon: FolderOpen, shortcut: `${MOD}O`, onSelect: () => shell?.openLibrary() },
          { label: 'Schließen', icon: X, onSelect: () => shell?.close() },
        ]}
      />
    </nav>
  );
}
