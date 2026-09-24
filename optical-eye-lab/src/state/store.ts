/**
 * Globaler Anwendungszustand (zustand).
 *
 * Aufteilung:
 *   doc        – das serialisierbare Szenendokument (einzige Quelle der Wahrheit für die Szene)
 *   history    – Undo/Redo als Snapshots des Dokuments (structural sharing, daher günstig)
 *   selection  – Auswahl / Hover
 *   tools      – aktives Werkzeug, Raster, Kamera-Projektion
 *   ui         – Panels, Dialoge, Hinweise
 *   prefs      – Programmeinstellungen (separat gespeichert)
 *
 * Änderungen am Dokument laufen ausschließlich über Actions. Kontinuierliche
 * Interaktionen (Gizmo ziehen, Werte scrubben) werden als „Geste“ gebündelt,
 * sodass ein Undo-Schritt die ganze Geste zurücknimmt.
 */
import { create } from 'zustand';
import type { ElementKind, EyePartId, OpticalElement, SceneDocument, SceneEntity, Transform, Vec3 } from '@/model/types';
import { EYE_ID, ROOM_ID } from '@/model/types';
import { cloneElement, createElement, createEmptyScene, createLightSource, createMeasurePoint } from '@/model/sceneFactory';
import { buildPreset, DEFAULT_PRESET_ID } from './presets';
import {
  DEFAULT_PREFS,
  readAutosave,
  readPrefs,
  saveScene as persistScene,
  loadScene as readScene,
  writeAutosave,
  writePrefs,
  type Preferences,
} from './persistence';

export type ToolMode = 'select' | 'translate' | 'rotate';
export type Projection = 'perspective' | 'orthographic';
export type DialogId = 'add-element' | 'settings' | 'load' | 'shortcuts' | null;

export type CameraCommand =
  | { type: 'reset' }
  | { type: 'focus-eye' }
  | { type: 'focus-scene' }
  | { type: 'focus-selection' }
  | { type: 'view'; view: 'front' | 'side' | 'top' };

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning';
}

const HISTORY_LIMIT = 120;

interface AppState {
  doc: SceneDocument;
  past: SceneDocument[];
  future: SceneDocument[];
  /** Referenzzustand für „Zurücksetzen“ (zuletzt geladen/gespeichert) */
  baseline: SceneDocument;
  dirty: boolean;
  gestureActive: boolean;

  selectedId: string | null;
  selectedEyePart: EyePartId | null;

  tool: ToolMode;
  snapping: boolean;
  transformSpace: 'world' | 'local';
  projection: Projection;
  cameraCommand: (CameraCommand & { nonce: number }) | null;
  /** Live-Berechnung des Strahlengangs */
  simulationLive: boolean;

  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  dialog: DialogId;
  toasts: Toast[];
  prefs: Preferences;

  /* --- Dokument --- */
  commit: (mutate: (doc: SceneDocument) => SceneDocument) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  updateEntity: (id: string, updater: (e: SceneEntity) => SceneEntity) => void;
  setTransform: (id: string, t: Partial<Transform>) => void;
  setEntityFlag: (id: string, flag: 'visible' | 'locked', value: boolean) => void;
  renameEntity: (id: string, name: string) => void;
  addElement: (kind: ElementKind) => void;
  addLightSource: () => void;
  addMeasurePoint: () => void;
  duplicateEntity: (id: string) => void;
  deleteEntity: (id: string) => void;
  setDocField: <K extends 'environment' | 'display'>(key: K, patch: Partial<SceneDocument[K]>) => void;
  setSceneName: (name: string) => void;

  /* --- Szenenverwaltung --- */
  newScene: () => void;
  loadPreset: (id: string) => void;
  loadDocument: (doc: SceneDocument, message?: string) => void;
  saveCurrent: () => void;
  loadSaved: (id: string) => void;
  resetScene: () => void;

  /* --- Auswahl & Werkzeuge --- */
  select: (id: string | null, eyePart?: EyePartId | null) => void;
  setTool: (t: ToolMode) => void;
  toggleSnapping: () => void;
  setTransformSpace: (s: 'world' | 'local') => void;
  setProjection: (p: Projection) => void;
  sendCameraCommand: (c: CameraCommand) => void;
  setSimulationLive: (v: boolean) => void;

  /* --- UI --- */
  togglePanel: (side: 'left' | 'right') => void;
  openDialog: (d: DialogId) => void;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  setPrefs: (p: Partial<Preferences>) => void;
}

/* ------------------------------------------------------------------ */

function mapEntity(doc: SceneDocument, id: string, fn: (e: SceneEntity) => SceneEntity): SceneDocument {
  if (id === EYE_ID) return { ...doc, eye: fn(doc.eye) as SceneDocument['eye'] };
  if (doc.elements.some((e) => e.id === id)) return { ...doc, elements: doc.elements.map((e) => (e.id === id ? (fn(e) as OpticalElement) : e)) };
  if (doc.lights.some((e) => e.id === id)) return { ...doc, lights: doc.lights.map((e) => (e.id === id ? (fn(e) as typeof e) : e)) };
  if (doc.measurePoints.some((e) => e.id === id))
    return { ...doc, measurePoints: doc.measurePoints.map((e) => (e.id === id ? (fn(e) as typeof e) : e)) };
  return doc;
}

export function findEntity(doc: SceneDocument, id: string | null): SceneEntity | null {
  if (!id) return null;
  if (id === EYE_ID) return doc.eye;
  return doc.elements.find((e) => e.id === id) ?? doc.lights.find((e) => e.id === id) ?? doc.measurePoints.find((e) => e.id === id) ?? null;
}

function initialState(): { doc: SceneDocument; baseline: SceneDocument } {
  const auto = typeof window !== 'undefined' ? readAutosave() : null;
  if (auto) return { doc: auto.doc, baseline: auto.baseline ?? auto.doc };
  const doc = buildPreset(DEFAULT_PRESET_ID);
  return { doc, baseline: doc };
}

let toastCounter = 0;
let cameraNonce = 0;

const init = initialState();

export const useAppStore = create<AppState>()((set, get) => ({
  doc: init.doc,
  past: [],
  future: [],
  baseline: init.baseline,
  dirty: false,
  gestureActive: false,

  selectedId: null,
  selectedEyePart: null,

  tool: 'translate',
  snapping: false,
  transformSpace: 'world',
  projection: 'perspective',
  cameraCommand: null,
  simulationLive: true,

  leftPanelOpen: true,
  rightPanelOpen: true,
  dialog: null,
  toasts: [],
  prefs: typeof window !== 'undefined' ? readPrefs() : DEFAULT_PREFS,

  /* ----------------------------- Dokument ----------------------------- */

  commit: (mutate) => {
    const { doc, past, gestureActive } = get();
    const next = mutate(doc);
    if (next === doc) return;
    if (gestureActive) {
      set({ doc: next, dirty: true });
    } else {
      set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], dirty: true });
    }
  },

  beginGesture: () => {
    const { doc, past, gestureActive } = get();
    if (gestureActive) return;
    set({ gestureActive: true, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },

  endGesture: () => {
    const { past, doc, gestureActive } = get();
    if (!gestureActive) return;
    // Geste ohne Änderung → Snapshot wieder entfernen
    if (past.length && past[past.length - 1] === doc) set({ gestureActive: false, past: past.slice(0, -1) });
    else set({ gestureActive: false });
  },

  undo: () => {
    const { past, future, doc, selectedId } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      selectedId: findEntity(prev, selectedId) || selectedId === ROOM_ID ? selectedId : null,
    });
  },

  redo: () => {
    const { past, future, doc, selectedId } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
      selectedId: findEntity(next, selectedId) || selectedId === ROOM_ID ? selectedId : null,
    });
  },

  updateEntity: (id, updater) => get().commit((doc) => mapEntity(doc, id, updater)),

  setTransform: (id, t) =>
    get().commit((doc) =>
      mapEntity(doc, id, (e) => ({ ...e, transform: { ...e.transform, ...t } }) as SceneEntity),
    ),

  setEntityFlag: (id, flag, value) => get().commit((doc) => mapEntity(doc, id, (e) => ({ ...e, [flag]: value }) as SceneEntity)),

  renameEntity: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    get().commit((doc) => mapEntity(doc, id, (e) => ({ ...e, name: trimmed }) as SceneEntity));
  },

  addElement: (kind) => {
    const el = createElement(kind, get().doc);
    get().commit((doc) => ({ ...doc, elements: [...doc.elements, el] }));
    set({ selectedId: el.id, selectedEyePart: null, dialog: null });
    get().notify(`${el.name} hinzugefügt`, 'success');
  },

  addLightSource: () => {
    const l = createLightSource(get().doc);
    get().commit((doc) => ({ ...doc, lights: [...doc.lights, l], display: { ...doc.display, showRays: true } }));
    set({ selectedId: l.id, selectedEyePart: null });
  },

  addMeasurePoint: () => {
    const m = createMeasurePoint(get().doc);
    get().commit((doc) => ({ ...doc, measurePoints: [...doc.measurePoints, m] }));
    set({ selectedId: m.id, selectedEyePart: null });
  },

  duplicateEntity: (id) => {
    const { doc } = get();
    const el = doc.elements.find((e) => e.id === id);
    if (el) {
      const copy = cloneElement(el, doc.elements.map((e) => e.name));
      get().commit((d) => ({ ...d, elements: [...d.elements, copy] }));
      set({ selectedId: copy.id });
      return;
    }
    const light = doc.lights.find((e) => e.id === id);
    if (light) {
      const copy = { ...structuredClone(light), id: `${light.id}_c${Date.now().toString(36)}`, name: `${light.name} (Kopie)` };
      copy.transform.position = [light.transform.position[0], light.transform.position[1] + 5, light.transform.position[2]];
      get().commit((d) => ({ ...d, lights: [...d.lights, copy] }));
      set({ selectedId: copy.id });
      return;
    }
    const mp = doc.measurePoints.find((e) => e.id === id);
    if (mp) {
      const copy = { ...structuredClone(mp), id: `${mp.id}_c${Date.now().toString(36)}`, name: `${mp.name} (Kopie)` };
      copy.transform.position = [mp.transform.position[0], mp.transform.position[1] + 5, mp.transform.position[2]];
      get().commit((d) => ({ ...d, measurePoints: [...d.measurePoints, copy] }));
      set({ selectedId: copy.id });
    }
  },

  deleteEntity: (id) => {
    if (id === EYE_ID || id === ROOM_ID) {
      get().notify('Das Auge ist fester Bestandteil der Szene und kann nur ausgeblendet werden.', 'warning');
      return;
    }
    const e = findEntity(get().doc, id);
    if (!e) return;
    if (e.locked) {
      get().notify(`„${e.name}“ ist gesperrt.`, 'warning');
      return;
    }
    get().commit((doc) => ({
      ...doc,
      elements: doc.elements.filter((x) => x.id !== id),
      lights: doc.lights.filter((x) => x.id !== id),
      measurePoints: doc.measurePoints.filter((x) => x.id !== id),
    }));
    if (get().selectedId === id) set({ selectedId: null, selectedEyePart: null });
    get().notify(`„${e.name}“ gelöscht – Rückgängig mit ⌘/Strg + Z`, 'info');
  },

  setDocField: (key, patch) => get().commit((doc) => ({ ...doc, [key]: { ...doc[key], ...patch } })),

  setSceneName: (name) => {
    const n = name.trim();
    if (n) get().commit((doc) => ({ ...doc, name: n }));
  },

  /* -------------------------- Szenenverwaltung ------------------------- */

  newScene: () => {
    const doc = createEmptyScene('Neue Szene');
    get().loadDocument(doc, 'Neue Szene erstellt');
  },

  loadPreset: (id) => {
    const doc = buildPreset(id);
    get().loadDocument(doc, `Demo-Szene „${doc.name}“ geladen`);
  },

  loadDocument: (doc, message) => {
    set({ doc, baseline: doc, past: [], future: [], dirty: false, selectedId: null, selectedEyePart: null, dialog: null });
    get().sendCameraCommand({ type: 'focus-scene' });
    if (message) get().notify(message, 'success');
  },

  saveCurrent: () => {
    const { doc } = get();
    const stamped = { ...doc, updatedAt: new Date().toISOString() };
    if (persistScene(stamped)) {
      set({ doc: stamped, baseline: stamped, dirty: false });
      get().notify(`Szene „${doc.name}“ lokal gespeichert`, 'success');
    } else {
      get().notify('Speichern fehlgeschlagen (LocalStorage nicht verfügbar oder voll).', 'warning');
    }
  },

  loadSaved: (id) => {
    const doc = readScene(id);
    if (!doc) {
      get().notify('Szene konnte nicht geladen werden.', 'warning');
      return;
    }
    get().loadDocument(doc, `Szene „${doc.name}“ geladen`);
  },

  resetScene: () => {
    const { baseline, doc, past } = get();
    if (baseline === doc) return;
    set({ doc: baseline, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], dirty: false, selectedId: null, selectedEyePart: null });
    get().notify('Szene auf den zuletzt gespeicherten/geladenen Stand zurückgesetzt', 'info');
  },

  /* ------------------------- Auswahl & Werkzeuge ------------------------ */

  select: (id, eyePart = null) => set({ selectedId: id, selectedEyePart: id === EYE_ID ? eyePart : null }),
  setTool: (tool) => set({ tool }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setTransformSpace: (transformSpace) => set({ transformSpace }),
  setProjection: (projection) => set({ projection }),
  sendCameraCommand: (c) => set({ cameraCommand: { ...c, nonce: ++cameraNonce } }),
  setSimulationLive: (simulationLive) => set({ simulationLive }),

  /* --------------------------------- UI --------------------------------- */

  togglePanel: (side) => set((s) => (side === 'left' ? { leftPanelOpen: !s.leftPanelOpen } : { rightPanelOpen: !s.rightPanelOpen })),
  openDialog: (dialog) => set({ dialog }),
  notify: (message, tone = 'info') => {
    const id = ++toastCounter;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    writePrefs(prefs);
    set({ prefs });
  },
}));

/* --------------------------- Autosave ------------------------------ */

if (typeof window !== 'undefined') {
  let timer: number | undefined;
  useAppStore.subscribe((s, prev) => {
    if (s.doc === prev.doc && s.baseline === prev.baseline) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const st = useAppStore.getState();
      writeAutosave(st.doc, st.baseline);
    }, 600);
  });
}

/* --------------------------- Selektoren ---------------------------- */

export const useSelectedEntity = () => useAppStore((s) => findEntity(s.doc, s.selectedId));

export const selectCanUndo = (s: AppState) => s.past.length > 0;
export const selectCanRedo = (s: AppState) => s.future.length > 0;

export type { Vec3 };
