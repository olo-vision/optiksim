/**
 * Die eine Plattform-Instanz der Anwendung (LocalStorage).
 * Tests erzeugen eigene Instanzen über createPlatform(new MemoryStorageProvider()).
 */
import { createPlatform } from '@/platform/platform';

export const platform = createPlatform();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__oelPlatform = platform;
}
