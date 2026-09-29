/**
 * Modul-Sitzungen (Phase 5): Eine Sitzung ist eine normale Bibliothekssimulation mit `moduleId`.
 * Dadurch gelten Speichern, Export, Vorschaubild, Absturzsicherung und Rechte unverändert – und jede
 * Sitzung lässt sich jederzeit im vollständigen Simulator öffnen (gleiche Datei, gleiche Physik).
 */
import type { SimulationCategory, SimulationMetadata } from '@/platform/models';
import { findModule, type ModuleDefinition } from '@/modules/registry';
import { uniqueName } from '@/platform/library';
import { platform } from '../platformInstance';
import { currentUser, useSession } from '../session';

const CATEGORY: Record<string, SimulationCategory> = {
  retinoscopy: 'refraction',
  refraction: 'refraction',
  'patient-view': 'demonstration',
  'contact-lens': 'contact-lens',
  'spectacle-lens': 'spectacles',
};

/** Sitzungen eines Moduls, zuletzt verwendete zuerst */
export function moduleSessions(sims: SimulationMetadata[], moduleId: string): SimulationMetadata[] {
  const t = (m: SimulationMetadata) => Date.parse(m.lastOpenedAt ?? m.updatedAt) || 0;
  return sims.filter((m) => m.moduleId === moduleId && !m.archived).sort((a, b) => t(b) - t(a));
}

/** Neue Sitzung aus der Startszene des Moduls anlegen. */
export async function createModuleSession(mod: ModuleDefinition): Promise<string> {
  if (!mod.createScene) throw new Error('Dieses Modul ist noch in Entwicklung.');
  const names = useSession.getState().sims.map((m) => m.name);
  const name = uniqueName(`${mod.title} – Sitzung`, names);
  const doc = mod.createScene();
  const rec = await platform.library.create(currentUser(), {
    name,
    description: mod.tagline,
    category: CATEGORY[mod.id] ?? 'other',
    tags: [`Modul ${mod.short}`],
    moduleId: mod.id,
    doc: { ...doc, name },
  });
  await useSession.getState().refreshLibrary();
  return rec.meta.id;
}

/** Zuletzt verwendete Sitzung öffnen oder eine neue anlegen → Simulations-ID */
export async function resolveModuleSession(moduleId: string): Promise<string> {
  const mod = findModule(moduleId);
  if (!mod) throw new Error('Unbekanntes Modul.');
  const existing = moduleSessions(useSession.getState().sims, moduleId)[0];
  if (existing) return existing.id;
  return createModuleSession(mod);
}
