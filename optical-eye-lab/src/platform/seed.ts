/**
 * Demo-Daten: Organisation „Optical Eye Lab Demo“, Demo-Trainer Max Mustermann und
 * einige Beispiel-Simulationen. Vollständig entfernbar (Einstellungen → Daten).
 */
import type { Organization, SimulationMetadata, User } from './models';
import type { Repositories } from './repositories';
import { makeUser } from './auth';
import { makeCredential } from './demoCredentials';
import { DEFAULT_BRANDING } from './branding';
import { LibraryService } from './library';

export const DEMO_ORG_ID = 'org_demo';
export const DEMO_USER_ID = 'user_demo_trainer';
export const DEMO_EMAIL = 'demo@opticaleyelab.local';
export const DEMO_PASSWORD = 'demo';

const DEMO_SIMS: Array<{ template: string; name: string; description: string; favorite?: boolean; tags: string[] }> = [
  { template: 'tpl-spectacle', name: 'Unterricht: Myopie und Brillenglas', description: 'Vollkorrektion eines myopen Auges im HSA 12 mm.', favorite: true, tags: ['Unterricht'] },
  { template: 'tpl-astigmatism', name: 'Sturmsches Konoid', description: 'Brennlinien eines astigmatischen Auges im Schnitt betrachten.', tags: ['Unterricht'] },
  { template: 'tpl-rgp', name: 'Übung: Tränenlinse bei formstabiler KL', description: 'Wie wirkt eine steilere Basiskurve?', tags: ['Übung'] },
  { template: 'tpl-toric-cl', name: 'Torische KL – Beispiel', description: 'Hornhautastigmatismus mit torischer Weichlinse.', tags: ['Beispiel'] },
];

export async function seedDemoData(repos: Repositories): Promise<void> {
  const now = new Date().toISOString();
  const org: Organization = {
    id: DEMO_ORG_ID,
    name: 'Optical Eye Lab Demo',
    type: 'training-center',
    defaultRole: 'member',
    featuredTemplateIds: ['tpl-emmetropia', 'tpl-astigmatism', 'tpl-spectacle', 'tpl-rgp'],
    branding: { ...DEFAULT_BRANDING, companyName: 'Optical Eye Lab Demo' },
    createdAt: now,
  };
  await repos.saveOrg(org);
  const trainer: User = makeUser({
    id: DEMO_USER_ID,
    firstName: 'Max',
    lastName: 'Mustermann',
    email: DEMO_EMAIL,
    role: 'trainer',
    organizationId: DEMO_ORG_ID,
    jobTitle: 'Augenoptikermeister',
    department: 'Ausbildung',
    avatarColor: '#4cc2ff',
    isDemo: true,
  });
  await repos.saveUser(trainer);
  await repos.saveCredential(await makeCredential(trainer.id, DEMO_EMAIL, DEMO_PASSWORD));

  const lib = new LibraryService(repos);
  for (const s of DEMO_SIMS) {
    const rec = await lib.createFromTemplate(trainer, s.template, s.name, s.description);
    await repos.saveSimMeta({ ...rec.meta, favorite: !!s.favorite, tags: [...rec.meta.tags, ...s.tags, 'Demo'] });
  }
}

/** Entfernt alle Demo-Konten, deren Simulationen, Einstellungen und die Demo-Organisation. */
export async function removeDemoData(repos: Repositories): Promise<{ users: number; simulations: number }> {
  const users = await repos.listUsers();
  const demoIds = new Set(users.filter((u) => u.isDemo).map((u) => u.id));
  const sims: SimulationMetadata[] = (await repos.listSimMeta()).filter((m) => demoIds.has(m.ownerId));
  for (const m of sims) await repos.deleteSim(m.id);
  for (const id of demoIds) {
    await repos.deleteUser(id);
    await repos.removeRecentUser(id);
  }
  const stillInDemoOrg = (await repos.listUsers()).some((u) => u.organizationId === DEMO_ORG_ID);
  if (!stillInDemoOrg) await repos.deleteOrg(DEMO_ORG_ID);
  const tpls = await repos.listCustomTemplates();
  for (const t of tpls) if (t.createdBy && demoIds.has(t.createdBy)) await repos.deleteTemplate(t.id);
  const meta = await repos.getMeta();
  if (meta) await repos.saveMeta({ ...meta, demoSeeded: false, demoRemoved: true });
  return { users: demoIds.size, simulations: sims.length };
}

/** Löscht ALLE Daten dieser App in diesem Browser – inklusive der Altdaten aus Phase 1/2. */
export async function wipeAllData(repos: Repositories): Promise<void> {
  for (const k of await repos.storage.keys()) await repos.storage.remove(k);
  for (const k of await repos.storage.keys('optical-eye-lab.')) await repos.storage.remove(k);
}
