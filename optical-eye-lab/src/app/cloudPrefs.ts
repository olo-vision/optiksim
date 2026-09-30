/**
 * Einstellungen im Kundenkonto (0.10.0).
 *
 * Kontobezogene Einstellungen (Darstellung, Bedienung, Augenoptik, Favoriten …) werden in
 * user_preferences gespeichert und stehen auf jedem Gerät zur Verfügung.
 * Gerätebezogene Werte (Grafikleistung, Panelbreiten) bleiben nur auf dem jeweiligen Gerät –
 * ein Tablet soll nicht die Grafikstufe des Arbeitsplatzrechners übernehmen.
 */
import { normalizePrefs, type UserPreferences } from '@/platform/preferences';

export const DEVICE_PREF_KEYS = [
  'quality',
  'maxPixelRatio',
  'antialias',
  'shadows',
  'reflections',
  'visionQuality',
  'panelOpacity',
  'leftPanelWidth',
  'rightPanelWidth',
  'leftPanelOpen',
  'rightPanelOpen',
] as const satisfies ReadonlyArray<keyof UserPreferences>;

const DEVICE = new Set<string>(DEVICE_PREF_KEYS);

/** Anteil, der im Konto gespeichert wird */
export function syncedPrefs(p: UserPreferences): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !DEVICE.has(k)));
}

/** Kontoeinstellungen über die Geräteeinstellungen legen */
export function mergePrefs(device: UserPreferences, account: Record<string, unknown> | null): UserPreferences {
  if (!account) return device;
  const synced = Object.fromEntries(Object.entries(account).filter(([k]) => !DEVICE.has(k)));
  return normalizePrefs({ ...device, ...synced });
}

export interface PrefsRemote {
  load(): Promise<Record<string, unknown> | null>;
  save(prefs: Record<string, unknown>): Promise<void>;
}
