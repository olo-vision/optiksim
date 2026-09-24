/**
 * Bibliotheksaktionen der Oberfläche (mit Bestätigungen, Hinweisen und Fehlerbehandlung).
 */
import { create } from 'zustand';
import type { SceneDocument } from '@/model/types';
import type { SimulationMetadata } from '@/platform/models';
import { platform } from '../platformInstance';
import { currentUser, errorMessage, runAction, useSession } from '../session';
import { confirmDialog, promptDialog } from '@/ui/ds/modals';
import { useAppStore } from '@/state/store';
import { downloadText, FILE_EXTENSION, readImportFile, safeFileName, serializeLibrary, serializeSimulation } from '@/platform/fileFormat';

/* --------------------------- App-Dialoge --------------------------- */

export type AppDialog =
  | { kind: 'new-simulation'; templateId?: string }
  | { kind: 'save-template'; doc: SceneDocument; meta?: SimulationMetadata }
  | null;

export const useAppDialogs = create<{ dialog: AppDialog }>()(() => ({ dialog: null }));
export const openAppDialog = (dialog: AppDialog) => useAppDialogs.setState({ dialog });
export const closeAppDialog = () => useAppDialogs.setState({ dialog: null });

/* ----------------------------- Aktionen ----------------------------- */

const notify = (m: string, tone: 'info' | 'success' | 'warning' = 'info') => useAppStore.getState().notify(m, tone);

export async function renameSimulation(meta: SimulationMetadata): Promise<string | null> {
  const name = await promptDialog({ title: 'Simulation umbenennen', label: 'Name', initial: meta.name, confirmLabel: 'Umbenennen' });
  if (!name || name === meta.name) return null;
  const r = await runAction((u) => platform.library.rename(u, meta.id, name), 'Umbenannt');
  return r ? name : null;
}

export function duplicateSimulation(meta: SimulationMetadata) {
  return runAction((u) => platform.library.duplicate(u, meta.id), (r) => `„${r.meta.name}“ angelegt`);
}

export async function deleteSimulation(meta: SimulationMetadata): Promise<boolean> {
  if (useAppStore.getState().prefs.confirmDestructive) {
    const ok = await confirmDialog({
      title: 'Simulation löschen?',
      message: (
        <>
          „<strong>{meta.name}</strong>“ wird dauerhaft aus diesem Browser gelöscht. Das kann nicht rückgängig gemacht werden.
        </>
      ),
      confirmLabel: 'Löschen',
      tone: 'danger',
    });
    if (!ok) return false;
  }
  return (await runAction((u) => platform.library.remove(u, meta.id), `„${meta.name}“ gelöscht`)) !== undefined;
}

export function setFavorite(meta: SimulationMetadata, favorite: boolean) {
  return runAction((u) => platform.library.updateDetails(u, meta.id, { favorite }));
}

export function setArchived(meta: SimulationMetadata, archived: boolean) {
  return runAction((u) => platform.library.updateDetails(u, meta.id, { archived }), archived ? `„${meta.name}“ archiviert` : `„${meta.name}“ wiederhergestellt`);
}

export async function exportSimulation(meta: SimulationMetadata) {
  try {
    const [rec] = await platform.library.records(currentUser(), [meta.id]);
    if (!rec) throw new Error('Die Simulation wurde nicht gefunden.');
    downloadText(serializeSimulation(rec), `${safeFileName(meta.name)}${FILE_EXTENSION}`);
    notify(`„${meta.name}“ als Datei exportiert`, 'success');
  } catch (e) {
    notify(errorMessage(e), 'warning');
  }
}

export async function exportLibrary() {
  try {
    const recs = await platform.library.records(currentUser());
    if (!recs.length) {
      notify('Keine Simulationen zum Exportieren vorhanden.', 'info');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    downloadText(serializeLibrary(recs), `optical-eye-lab_bibliothek_${date}.json`);
    notify(`${recs.length} Simulation${recs.length === 1 ? '' : 'en'} exportiert`, 'success');
  } catch (e) {
    notify(errorMessage(e), 'warning');
  }
}

/** Import von .opticsim / Bibliotheksdatei / alter .oel.json. Gibt die neuen IDs zurück. */
export async function importFiles(files: FileList | File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of Array.from(files)) {
    try {
      const parsed = await readImportFile(f);
      const recs = await platform.library.importItems(currentUser(), parsed.items);
      ids.push(...recs.map((r) => r.meta.id));
      const skipped = parsed.skipped ? ` (${parsed.skipped} beschädigte Einträge übersprungen)` : '';
      notify(recs.length === 1 ? `„${recs[0].meta.name}“ importiert${skipped}` : `${recs.length} Simulationen importiert${skipped}`, 'success');
    } catch (e) {
      notify(`${f.name}: ${errorMessage(e)}`, 'warning');
    }
  }
  await useSession.getState().refreshLibrary();
  return ids;
}

/** Öffnet den Dateiauswahldialog für den Import. */
export function pickImportFiles(onDone?: (ids: string[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = `${FILE_EXTENSION},.json,application/json`;
  input.multiple = true;
  input.onchange = async () => {
    if (!input.files?.length) return;
    const ids = await importFiles(input.files);
    onDone?.(ids);
  };
  input.click();
}
