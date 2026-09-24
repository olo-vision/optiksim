/**
 * Benutzereinstellungen (Phase 3) – je Benutzer lokal gespeichert.
 *
 * Obermenge der Simulator-Präferenzen aus Phase 1/2 (`Preferences`), damit der Simulator
 * unverändert weiterarbeitet. Jede Einstellung hier hat eine echte Wirkung; Punkte, die noch
 * keine Wirkung hätten, werden in der Oberfläche als „In Entwicklung“ gekennzeichnet und nicht
 * als Einstellung gespeichert.
 */
import { DEFAULT_PREFS, type Preferences } from '@/state/persistence';

export type ThemeMode = 'dark' | 'light' | 'system';
export type StartView = 'dashboard' | 'library' | 'last-simulation';
export type Workspace = 'standard' | 'refraction' | 'contact-lens' | 'training' | 'presentation';
export type FontScale = 'small' | 'normal' | 'large';

export interface UserPreferences extends Preferences {
  /* Allgemein */
  startView: StartView;
  confirmDestructive: boolean;
  autoSave: boolean;
  /** Verzögerung der automatischen Speicherung nach der letzten Änderung [s] */
  autoSaveDelaySec: number;
  onCloseUnsaved: 'ask' | 'save' | 'discard';

  /* Darstellung */
  theme: ThemeMode;
  fontScale: FontScale;
  /** Deckkraft der schwebenden Panels 0.6 … 1 */
  panelOpacity: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  reducedMotion: boolean;

  /* 3D & Grafik (verfeinern die Qualitätsstufe) */
  shadows: boolean;
  reflections: boolean;
  antialias: boolean;
  maxPixelRatio: 1 | 1.5 | 2;

  /* Simulation – Standardwerte für neue, leere Simulationen */
  simulationLiveDefault: boolean;
  newSceneOpticalAxis: boolean;
  newSceneDimensions: boolean;
  newSceneBench: boolean;
  defaultAmetropiaMode: 'auto' | 'axial' | 'refractive';

  /* Bedienung */
  cameraRotateSpeed: number;
  zoomSpeed: number;
  defaultTool: 'select' | 'translate' | 'rotate';
  defaultProjection: 'perspective' | 'orthographic';

  /* Augenoptik */
  diopterStep: 0.12 | 0.25 | 0.5;

  /* Personalisierung */
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  workspace: Workspace;
  /** Favorisierte Elementtypen im Dialog „Optisches Element“ */
  favoriteElementKinds: string[];

  /* Onboarding */
  onboardingDone: boolean;

  /* Phase 4 */
  /** Expertenmodus: alle geometrischen/optischen Details, Materialdaten, Raytracing-Kennzahlen */
  expertMode: boolean;
  /** Qualität der Patientensicht (Bildauflösung der PSF-Faltung) */
  visionQuality: 'standard' | 'high';
}

export const DEFAULT_USER_PREFS: UserPreferences = {
  ...DEFAULT_PREFS,
  startView: 'dashboard',
  confirmDestructive: true,
  autoSave: true,
  autoSaveDelaySec: 4,
  onCloseUnsaved: 'ask',

  theme: 'dark',
  fontScale: 'normal',
  panelOpacity: 0.8,
  leftPanelWidth: 268,
  rightPanelWidth: 316,
  reducedMotion: false,

  shadows: true,
  reflections: true,
  antialias: true,
  maxPixelRatio: 2,

  simulationLiveDefault: true,
  newSceneOpticalAxis: true,
  newSceneDimensions: true,
  newSceneBench: true,
  defaultAmetropiaMode: 'auto',

  cameraRotateSpeed: 0.9,
  zoomSpeed: 0.6,
  defaultTool: 'translate',
  defaultProjection: 'perspective',

  diopterStep: 0.25,

  leftPanelOpen: true,
  rightPanelOpen: true,
  workspace: 'standard',
  favoriteElementKinds: [],

  onboardingDone: false,

  expertMode: false,
  visionQuality: 'standard',
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const oneOf = <T,>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Ergänzt fehlende Felder und verwirft ungültige Werte (robust gegen alte/beschädigte Daten). */
export function normalizePrefs(raw: unknown): UserPreferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<UserPreferences>;
  const d = DEFAULT_USER_PREFS;
  const p: UserPreferences = { ...d, ...r };
  p.quality = oneOf(p.quality, ['high', 'balanced', 'performance'] as const, d.quality);
  p.decimals = oneOf(p.decimals, [1, 2, 3] as const, d.decimals);
  p.cylForm = oneOf(p.cylForm, ['minus', 'plus'] as const, d.cylForm);
  p.paramMode = oneOf(p.paramMode, ['optical', 'geometry'] as const, d.paramMode);
  p.theme = oneOf(p.theme, ['dark', 'light', 'system'] as const, d.theme);
  p.startView = oneOf(p.startView, ['dashboard', 'library', 'last-simulation'] as const, d.startView);
  p.onCloseUnsaved = oneOf(p.onCloseUnsaved, ['ask', 'save', 'discard'] as const, d.onCloseUnsaved);
  p.fontScale = oneOf(p.fontScale, ['small', 'normal', 'large'] as const, d.fontScale);
  p.workspace = oneOf(p.workspace, ['standard', 'refraction', 'contact-lens', 'training', 'presentation'] as const, d.workspace);
  p.defaultTool = oneOf(p.defaultTool, ['select', 'translate', 'rotate'] as const, d.defaultTool);
  p.defaultProjection = oneOf(p.defaultProjection, ['perspective', 'orthographic'] as const, d.defaultProjection);
  p.defaultAmetropiaMode = oneOf(p.defaultAmetropiaMode, ['auto', 'axial', 'refractive'] as const, d.defaultAmetropiaMode);
  p.maxPixelRatio = oneOf(p.maxPixelRatio, [1, 1.5, 2] as const, d.maxPixelRatio);
  p.diopterStep = oneOf(p.diopterStep, [0.12, 0.25, 0.5] as const, d.diopterStep);
  p.autoSaveDelaySec = clamp(p.autoSaveDelaySec, 1, 120, d.autoSaveDelaySec);
  p.panelOpacity = clamp(p.panelOpacity, 0.6, 1, d.panelOpacity);
  p.leftPanelWidth = clamp(p.leftPanelWidth, 220, 420, d.leftPanelWidth);
  p.rightPanelWidth = clamp(p.rightPanelWidth, 260, 480, d.rightPanelWidth);
  p.cameraRotateSpeed = clamp(p.cameraRotateSpeed, 0.2, 3, d.cameraRotateSpeed);
  p.zoomSpeed = clamp(p.zoomSpeed, 0.1, 3, d.zoomSpeed);
  p.gizmoSize = clamp(p.gizmoSize, 0.4, 2, d.gizmoSize);
  p.translationSnap = clamp(p.translationSnap, 0.1, 50, d.translationSnap);
  p.rotationSnap = clamp(p.rotationSnap, 1, 90, d.rotationSnap);
  p.visionQuality = oneOf(p.visionQuality, ['standard', 'high'] as const, d.visionQuality);
  p.favoriteElementKinds = Array.isArray(p.favoriteElementKinds) ? p.favoriteElementKinds.filter((k) => typeof k === 'string') : [];
  for (const k of ['confirmDestructive', 'autoSave', 'reducedMotion', 'shadows', 'reflections', 'antialias', 'simulationLiveDefault', 'newSceneOpticalAxis', 'newSceneDimensions', 'newSceneBench', 'leftPanelOpen', 'rightPanelOpen', 'onboardingDone', 'showHoverInfo', 'expertMode'] as const) {
    if (typeof p[k] !== 'boolean') (p as unknown as Record<string, boolean>)[k] = d[k] as boolean;
  }
  return p;
}

/** Arbeitsbereiche: vordefinierte Oberflächen-Konfigurationen (setzen nur UI-Einstellungen). */
export const WORKSPACES: Array<{ id: Workspace; label: string; description: string; patch: Partial<UserPreferences> }> = [
  { id: 'standard', label: 'Standard', description: 'Szenenbaum und Inspector geöffnet, optische Werte.', patch: { leftPanelOpen: true, rightPanelOpen: true, paramMode: 'optical' } },
  { id: 'refraction', label: 'Refraktion', description: 'Fokus auf Rezeptwerte: optische Werte, Minuszylinder, 2 Nachkommastellen.', patch: { leftPanelOpen: false, rightPanelOpen: true, paramMode: 'optical', cylForm: 'minus', decimals: 2 } },
  { id: 'contact-lens', label: 'Kontaktlinse', description: 'Geometrie-Modus mit 3 Nachkommastellen für Radien und Tränenfilm.', patch: { leftPanelOpen: true, rightPanelOpen: true, paramMode: 'geometry', decimals: 3 } },
  { id: 'training', label: 'Unterricht', description: 'Große Schrift, Objektinfos bei Hover, beide Panels.', patch: { leftPanelOpen: true, rightPanelOpen: true, fontScale: 'large', showHoverInfo: true } },
  { id: 'presentation', label: 'Präsentation', description: 'Maximale 3D-Fläche: Panels eingeklappt, hohe Qualität.', patch: { leftPanelOpen: false, rightPanelOpen: false, quality: 'high' } },
];

/** Übernimmt die alten Simulator-Präferenzen (Phase 1/2) als Ausgangswerte. */
export function prefsFromLegacy(legacy: Partial<Preferences> | null): UserPreferences {
  return normalizePrefs({ ...DEFAULT_USER_PREFS, ...(legacy ?? {}) });
}
