/**
 * Phase 3 – Plattform: Konten, Rollen, Bibliothek, Einstellungen, Import/Export, Migration.
 * Läuft vollständig gegen den MemoryStorageProvider (kein Browser nötig).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createPlatform, type Platform } from '@/platform/platform';
import { MemoryStorageProvider, StorageQuotaError, KEYS } from '@/platform/storage';
import { AuthError, GUEST_USER_ID } from '@/platform/auth';
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USER_ID, removeDemoData, wipeAllData } from '@/platform/seed';
import { querySimulations, LibraryError } from '@/platform/library';
import { parseImport, serializeLibrary, serializeSimulation, ImportError } from '@/platform/fileFormat';
import { LEGACY_KEYS } from '@/platform/migration';
import { can, roleLabel, GUEST_SIMULATION_LIMIT } from '@/platform/permissions';
import { normalizePrefs, DEFAULT_USER_PREFS } from '@/platform/preferences';
import { buildPreset } from '@/state/presets';
import { createBlankDocument } from '@/platform/templates';
import type { User } from '@/platform/models';

let mem: MemoryStorageProvider;
let p: Platform;

async function freshPlatform(seedDemo = true) {
  mem = new MemoryStorageProvider();
  p = createPlatform(mem);
  await p.init({ seedDemo });
}

async function signUpAdmin(): Promise<User> {
  return p.auth.signUp({ firstName: 'Anna', lastName: 'Admin', email: 'anna@schule.de', password: 'geheim1', organizationName: 'Berufsschule Nord', organizationType: 'school' });
}

describe('Konten & Anmeldung (lokale Demo-Authentifizierung)', () => {
  beforeEach(() => freshPlatform());

  it('legt beim ersten Start Demo-Daten an und erlaubt den Demo-Login', async () => {
    const u = await p.auth.signIn(DEMO_EMAIL, DEMO_PASSWORD);
    expect(u.id).toBe(DEMO_USER_ID);
    expect(u.role).toBe('trainer');
    expect(u.lastLoginAt).toBeTruthy();
    expect((await p.library.list(u)).length).toBeGreaterThanOrEqual(4);
    expect(await p.auth.restore()).toMatchObject({ id: DEMO_USER_ID });
  });

  it('lehnt falsches Passwort und unbekannte E-Mail ab', async () => {
    await expect(p.auth.signIn(DEMO_EMAIL, 'falsch')).rejects.toBeInstanceOf(AuthError);
    await expect(p.auth.signIn('niemand@x.de', 'demo')).rejects.toBeInstanceOf(AuthError);
  });

  it('speichert Passwörter nicht im Klartext', async () => {
    await signUpAdmin();
    const raw = mem.readRaw(KEYS.credentials)!;
    expect(raw).not.toContain('geheim1');
  });

  it('erstes echtes Konto wird Administrator/in, weitere werden Mitglied derselben Organisation', async () => {
    const a = await signUpAdmin();
    expect(a.role).toBe('admin');
    const org = await p.repos.getOrg(a.organizationId);
    expect(org?.name).toBe('Berufsschule Nord');
    expect(org?.type).toBe('school');
    await p.auth.signOut();
    const b = await p.auth.signUp({ firstName: 'Ben', lastName: 'Schüler', email: 'ben@schule.de', password: 'abcd' });
    expect(b.role).toBe('member');
    expect(b.organizationId).toBe(a.organizationId);
    expect(roleLabel(b.role, 'school')).toBe('Schüler/in');
  });

  it('verhindert doppelte E-Mail und prüft Eingaben', async () => {
    await signUpAdmin();
    await expect(p.auth.signUp({ firstName: 'X', lastName: '', email: 'ANNA@schule.de', password: 'abcd' })).rejects.toThrow(/bereits/);
    await expect(p.auth.signUp({ firstName: 'X', lastName: '', email: 'kein-mail', password: 'abcd' })).rejects.toThrow(/E-Mail/);
    await expect(p.auth.signUp({ firstName: 'X', lastName: '', email: 'x@y.de', password: '1' })).rejects.toThrow(/Passwort/);
  });

  it('Benutzer wechseln: bekannte Konten und getrennte Sitzung', async () => {
    const a = await signUpAdmin();
    await p.auth.signOut();
    expect(await p.auth.restore()).toBeNull();
    await p.auth.signIn(DEMO_EMAIL, DEMO_PASSWORD);
    const known = await p.auth.knownAccounts();
    expect(known.map((u) => u.id)).toEqual([DEMO_USER_ID, a.id]);
  });

  it('Gastzugang mit Simulationslimit', async () => {
    const g = await p.auth.signInAsGuest();
    expect(g.id).toBe(GUEST_USER_ID);
    expect(can(g, 'simulations.create')).toBe(true);
    expect(can(g, 'templates.create')).toBe(false);
    for (let i = 0; i < GUEST_SIMULATION_LIMIT; i++) await p.library.createFromTemplate(g, 'tpl-myopia');
    await expect(p.library.createFromTemplate(g, 'tpl-myopia')).rejects.toBeInstanceOf(LibraryError);
  });

  it('Passwort ändern', async () => {
    const a = await signUpAdmin();
    await expect(p.auth.changePassword(a.id, 'falsch', 'neu123')).rejects.toBeInstanceOf(AuthError);
    await p.auth.changePassword(a.id, 'geheim1', 'neu123');
    await p.auth.signOut();
    await expect(p.auth.signIn('anna@schule.de', 'geheim1')).rejects.toBeInstanceOf(AuthError);
    expect((await p.auth.signIn('anna@schule.de', 'neu123')).id).toBe(a.id);
  });
});

describe('Rollen & Administration', () => {
  beforeEach(() => freshPlatform());

  it('Rechte-Matrix', () => {
    const mk = (role: User['role']) => ({ role, active: true });
    expect(can(mk('admin'), 'users.manage')).toBe(true);
    expect(can(mk('trainer'), 'users.manage')).toBe(false);
    expect(can(mk('trainer'), 'templates.publishOrganization')).toBe(true);
    expect(can(mk('member'), 'templates.create')).toBe(false);
    expect(can({ role: 'admin', active: false }, 'users.manage')).toBe(false);
  });

  it('Admin legt Benutzer an, ändert Rolle, deaktiviert – deaktivierte Konten können sich nicht anmelden', async () => {
    const a = await signUpAdmin();
    const u = await p.accounts.createUser(a, { firstName: 'Lea', lastName: 'Lernt', email: 'lea@schule.de', role: 'member', password: 'start1' });
    expect(u.organizationId).toBe(a.organizationId);
    const t = await p.accounts.updateUser(a, u.id, { role: 'trainer' });
    expect(t.role).toBe('trainer');
    await p.accounts.setActive(a, u.id, false);
    await expect(p.auth.signIn('lea@schule.de', 'start1')).rejects.toThrow(/deaktiviert/);
    await p.accounts.setActive(a, u.id, true);
    expect((await p.auth.signIn('lea@schule.de', 'start1')).id).toBe(u.id);
  });

  it('Nicht-Admins dürfen keine Benutzer verwalten; letzter Admin bleibt erhalten', async () => {
    const a = await signUpAdmin();
    const demo = (await p.repos.getUser(DEMO_USER_ID))!;
    await expect(p.accounts.createUser(demo, { firstName: 'X', lastName: '', email: 'x@y.de', role: 'member', password: 'abcd' })).rejects.toBeInstanceOf(AuthError);
    await expect(p.accounts.setActive(a, a.id, false)).rejects.toThrow(/eigenes/);
    await expect(p.accounts.updateUser(a, a.id, { role: 'member' })).rejects.toThrow(/mindestens/);
  });

  it('Organisation & Branding bearbeiten (mit Validierung)', async () => {
    const a = await signUpAdmin();
    const o = await p.accounts.updateOrganization(a, a.organizationId!, { branding: { productName: 'Optik-Labor Nord', accentColor: '#45d6a0' } });
    expect(o.branding.productName).toBe('Optik-Labor Nord');
    await expect(p.accounts.updateOrganization(a, a.organizationId!, { branding: { productName: 'x', accentColor: 'grün' } })).rejects.toThrow(/Hex/);
  });

  it('eigenes Profil bearbeiten', async () => {
    const a = await signUpAdmin();
    const u = await p.accounts.updateProfile(a, { firstName: 'Anne', jobTitle: 'Lehrkraft' });
    expect(u.displayName).toBe('Anne Admin');
    expect(u.jobTitle).toBe('Lehrkraft');
  });
});

describe('Simulationsbibliothek', () => {
  let user: User;
  beforeEach(async () => {
    await freshPlatform(false);
    user = await signUpAdmin();
  });

  it('neue Simulation aus Vorlage und leer anlegen', async () => {
    const r = await p.library.createFromTemplate(user, 'tpl-toric-cl', 'Meine torische KL');
    expect(r.meta.name).toBe('Meine torische KL');
    expect(r.meta.category).toBe('contact-lens');
    expect(r.meta.templateId).toBe('tpl-toric-cl');
    expect(r.meta.summary.eyeRx).toMatch(/cyl/);
    expect(r.meta.summary.highlights).toContain('Vollkorrektion');
    const blank = await p.library.create(user, { name: 'Leer', doc: createBlankDocument('Leer', DEFAULT_USER_PREFS) });
    expect(blank.doc.elements).toHaveLength(0);
    const loaded = await p.library.get(user, r.meta.id);
    expect(loaded?.doc.elements).toHaveLength(1);
  });

  it('umbenennen, duplizieren (eindeutiger Name), löschen', async () => {
    const r = await p.library.createFromTemplate(user, 'tpl-myopia');
    await p.library.rename(user, r.meta.id, 'Myopie Klasse 10');
    expect((await p.library.get(user, r.meta.id))!.doc.name).toBe('Myopie Klasse 10');
    const c1 = await p.library.duplicate(user, r.meta.id);
    const c2 = await p.library.duplicate(user, r.meta.id);
    expect(c1.meta.name).toBe('Myopie Klasse 10 (Kopie)');
    expect(c2.meta.name).toBe('Myopie Klasse 10 (Kopie 2)');
    expect(c1.doc.id).not.toBe(r.doc.id);
    await expect(p.library.rename(user, r.meta.id, '  ')).rejects.toBeInstanceOf(LibraryError);
    await p.library.remove(user, r.meta.id);
    expect(await p.library.get(user, r.meta.id)).toBeNull();
    expect(mem.readRaw(KEYS.sim(r.meta.id))).toBeNull();
  });

  it('speichern aktualisiert Dokument, Kurzinfo, Zeitstempel und Vorschaubild', async () => {
    const r = await p.library.createFromTemplate(user, 'tpl-emmetropia');
    const doc = buildPreset('eye-spectacle');
    await new Promise((res) => setTimeout(res, 5));
    const m = await p.library.save(user, r.meta.id, { ...doc, name: r.meta.name }, 'data:image/jpeg;base64,AAAA');
    expect(m.updatedAt > r.meta.updatedAt).toBe(true);
    expect(m.summary.elementCount).toBe(1);
    expect(m.hasThumbnail).toBe(true);
    expect(await p.library.thumbnail(r.meta.id)).toContain('data:image/jpeg');
  });

  it('Favoriten, Archiv, Suche, Filter und Sortierung', async () => {
    const a = await p.library.createFromTemplate(user, 'tpl-myopia', 'Alpha Myopie');
    const b = await p.library.createFromTemplate(user, 'tpl-soft-cl', 'Beta Kontaktlinse');
    const c = await p.library.createFromTemplate(user, 'tpl-hyperopia', 'Gamma Hyperopie');
    await p.library.updateDetails(user, b.meta.id, { favorite: true });
    await p.library.updateDetails(user, c.meta.id, { archived: true });
    const all = await p.library.list(user);
    expect(querySimulations(all, {}).map((m) => m.id)).not.toContain(c.meta.id);
    expect(querySimulations(all, { scope: 'archived' }).map((m) => m.id)).toEqual([c.meta.id]);
    expect(querySimulations(all, { scope: 'favorites' }).map((m) => m.id)).toEqual([b.meta.id]);
    expect(querySimulations(all, { category: 'contact-lens' }).map((m) => m.id)).toEqual([b.meta.id]);
    expect(querySimulations(all, { text: 'myopie alpha' }).map((m) => m.id)).toEqual([a.meta.id]);
    expect(querySimulations(all, { sort: 'name' }).map((m) => m.name)).toEqual(['Alpha Myopie', 'Beta Kontaktlinse']);
    await p.library.markOpened(a.meta.id);
    expect(querySimulations(await p.library.list(user), { scope: 'recent' }).map((m) => m.id)).toEqual([a.meta.id]);
  });

  it('parallele Änderungen gehen nicht verloren (serialisierte Schreibzugriffe)', async () => {
    const a = await p.library.createFromTemplate(user, 'tpl-myopia');
    const b = await p.library.createFromTemplate(user, 'tpl-hyperopia');
    await Promise.all([
      p.library.updateDetails(user, a.meta.id, { favorite: true }),
      p.library.save(user, b.meta.id, b.doc),
      p.library.updateDetails(user, b.meta.id, { tags: ['X'] }),
      p.library.markOpened(a.meta.id),
    ]);
    const list = await p.library.list(user);
    expect(list.find((m) => m.id === a.meta.id)?.favorite).toBe(true);
    expect(list.find((m) => m.id === a.meta.id)?.lastOpenedAt).toBeTruthy();
    expect(list.find((m) => m.id === b.meta.id)?.tags).toEqual(['X']);
  });

  it('Simulationen sind je Benutzer getrennt; Admin sieht alle', async () => {
    const own = await p.library.createFromTemplate(user, 'tpl-myopia');
    await p.auth.signOut();
    const m = await p.auth.signUp({ firstName: 'Mia', lastName: '', email: 'mia@schule.de', password: 'abcd' });
    const mine = await p.library.createFromTemplate(m, 'tpl-hyperopia');
    expect((await p.library.list(m)).map((x) => x.id)).toEqual([mine.meta.id]);
    expect(await p.library.get(m, own.meta.id)).toBeNull();
    await expect(p.library.remove(m, own.meta.id)).rejects.toBeInstanceOf(LibraryError);
    expect((await p.library.list(user)).length).toBe(2);
  });

  it('eigene Vorlagen: privat und für die Organisation', async () => {
    const r = await p.library.createFromTemplate(user, 'tpl-rgp');
    const t = await p.library.saveAsTemplate(user, r.doc, { name: 'RGP Übung', category: 'training', visibility: 'organization' });
    await p.auth.signOut();
    const m = await p.auth.signUp({ firstName: 'Mia', lastName: '', email: 'mia@schule.de', password: 'abcd' });
    expect((await p.library.listTemplates(m)).some((x) => x.id === t.id)).toBe(true);
    await expect(p.library.saveAsTemplate(m, r.doc, { name: 'X', category: 'custom', visibility: 'private' })).rejects.toBeInstanceOf(LibraryError);
    const fromT = await p.library.createFromTemplate(m, t.id);
    expect(fromT.doc.elements).toHaveLength(1);
    expect(fromT.doc.id).not.toBe(r.doc.id);
  });

  it('meldet vollen Speicher als StorageQuotaError', async () => {
    const small = new MemoryStorageProvider(60_000);
    const q = createPlatform(small);
    await q.init({ seedDemo: false });
    const u = await q.auth.signUp({ firstName: 'A', lastName: '', email: 'a@b.de', password: 'abcd' });
    let err: unknown;
    try {
      for (let i = 0; i < 40; i++) await q.library.createFromTemplate(u, 'tpl-toric-spectacle');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StorageQuotaError);
  });
});

describe('Import / Export', () => {
  let user: User;
  beforeEach(async () => {
    await freshPlatform(false);
    user = await signUpAdmin();
  });

  it('Simulation exportieren und wieder importieren (.opticsim)', async () => {
    const r = await p.library.createFromTemplate(user, 'tpl-toric-spectacle', 'Export-Test');
    await p.library.updateDetails(user, r.meta.id, { description: 'Beschreibung', tags: ['A'] });
    const rec = (await p.library.records(user, [r.meta.id]))[0];
    const parsed = parseImport(serializeSimulation(rec));
    expect(parsed.kind).toBe('simulation');
    const [imp] = await p.library.importItems(user, parsed.items);
    expect(imp.meta.name).toBe('Export-Test (Kopie)');
    expect(imp.meta.description).toBe('Beschreibung');
    expect(imp.meta.tags).toContain('Importiert');
    expect(JSON.stringify(imp.doc.elements)).toBe(JSON.stringify(rec.doc.elements));
  });

  it('ganze Bibliothek exportieren/importieren; beschädigte Einträge werden übersprungen', async () => {
    await p.library.createFromTemplate(user, 'tpl-myopia');
    await p.library.createFromTemplate(user, 'tpl-hyperopia');
    const text = serializeLibrary(await p.library.records(user));
    const obj = JSON.parse(text);
    obj.simulations.push({ meta: { name: 'kaputt' }, doc: { foo: 1 } });
    const parsed = parseImport(JSON.stringify(obj));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.skipped).toBe(1);
  });

  it('liest alte Szenendateien (.oel.json) und lehnt ungültige Dateien verständlich ab', () => {
    const legacy = parseImport(JSON.stringify(buildPreset('myopia')));
    expect(legacy.kind).toBe('legacy-scene');
    expect(() => parseImport('kein json')).toThrow(ImportError);
    expect(() => parseImport('{"hallo":1}')).toThrow(/Unbekanntes Dateiformat/);
    expect(() => parseImport(JSON.stringify({ format: 'optical-eye-lab/simulation', version: 9, doc: {} }))).toThrow(/neueren/);
  });
});

describe('Einstellungen je Benutzer', () => {
  beforeEach(() => freshPlatform());

  it('speichert Einstellungen getrennt je Benutzer', async () => {
    const a = await signUpAdmin();
    await p.savePrefs(a.id, normalizePrefs({ ...DEFAULT_USER_PREFS, theme: 'light', decimals: 3 }));
    expect((await p.loadPrefs(a.id)).theme).toBe('light');
    expect((await p.loadPrefs(DEMO_USER_ID)).theme).toBe('dark');
  });

  it('verwirft ungültige Werte', () => {
    const n = normalizePrefs({ theme: 'pink', decimals: 7, autoSaveDelaySec: -3, leftPanelWidth: 5000, shadows: 'ja' });
    expect(n.theme).toBe('dark');
    expect(n.decimals).toBe(2);
    expect(n.autoSaveDelaySec).toBe(1);
    expect(n.leftPanelWidth).toBe(420);
    expect(n.shadows).toBe(true);
  });
});

describe('Migration Phase 1/2 → Phase 3', () => {
  it('übernimmt gespeicherte Szenen, Auto-Sicherung und Einstellungen (einmalig, Altdaten bleiben)', async () => {
    mem = new MemoryStorageProvider();
    const d1 = buildPreset('myopia');
    const d2 = buildPreset('eye-contact');
    const legacyV1 = { ...buildPreset('normal-eye'), schemaVersion: 1 };
    mem.setRaw(
      LEGACY_KEYS.scenes,
      JSON.stringify([
        { id: d1.id, name: 'Meine Myopie', savedAt: '2026-05-01T10:00:00.000Z', elementCount: 0, doc: d1 },
        { id: 'x', name: 'Alt v1', savedAt: '2026-04-01T10:00:00.000Z', elementCount: 0, doc: legacyV1 },
        { id: 'bad', name: 'Kaputt', savedAt: '2026-04-01T10:00:00.000Z', elementCount: 0, doc: { nope: true } },
      ]),
    );
    mem.setRaw(LEGACY_KEYS.autosave, JSON.stringify({ doc: d2, baseline: d2 }));
    mem.setRaw(LEGACY_KEYS.prefs, JSON.stringify({ decimals: 3, cylForm: 'plus' }));
    p = createPlatform(mem);
    const res = await p.init();
    expect(res.migration?.migratedScenes).toBe(2);
    expect(res.migration?.errors).toBe(1);
    expect(res.migration?.recoveredAutosave).toBe(true);
    const a = await signUpAdmin();
    const list = await p.library.list(a);
    const legacy = list.filter((m) => m.ownerId === 'legacy');
    expect(legacy.map((m) => m.name).sort()).toEqual(['Alt v1', 'Meine Myopie', 'Wiederhergestellter Arbeitsstand – Myopie + Kontaktlinse']);
    expect(legacy.every((m) => m.tags.includes('Übernommen'))).toBe(true);
    expect(list.find((m) => m.name === 'Meine Myopie')!.updatedAt).toBe('2026-05-01T10:00:00.000Z');
    const prefs = await p.loadPrefs(a.id);
    expect(prefs.decimals).toBe(3);
    expect(prefs.cylForm).toBe('plus');
    expect(mem.readRaw(LEGACY_KEYS.scenes)).not.toBeNull();
    // zweiter Start: keine erneute Migration
    const again = await createPlatform(mem).init();
    expect(again.firstRun).toBe(false);
    expect((await p.library.list(a)).filter((m) => m.ownerId === 'legacy')).toHaveLength(3);
  });

  it('übernimmt eine Auto-Sicherung nicht doppelt, wenn sie einer gespeicherten Szene entspricht', async () => {
    mem = new MemoryStorageProvider();
    const d1 = buildPreset('myopia');
    mem.setRaw(LEGACY_KEYS.scenes, JSON.stringify([{ id: d1.id, name: d1.name, savedAt: d1.updatedAt, elementCount: 0, doc: d1 }]));
    mem.setRaw(LEGACY_KEYS.autosave, JSON.stringify({ doc: { ...d1, updatedAt: 'später' }, baseline: d1 }));
    p = createPlatform(mem);
    const res = await p.init({ seedDemo: false });
    expect(res.migration?.recoveredAutosave).toBe(false);
  });
});

describe('Demo-Daten', () => {
  beforeEach(() => freshPlatform());

  it('lassen sich vollständig entfernen und werden nicht erneut angelegt', async () => {
    const a = await signUpAdmin();
    const own = await p.library.createFromTemplate(a, 'tpl-myopia');
    const res = await removeDemoData(p.repos);
    expect(res.users).toBe(1);
    expect(res.simulations).toBe(4);
    expect(await p.repos.getUser(DEMO_USER_ID)).toBeNull();
    expect((await p.library.list(a)).map((m) => m.id)).toEqual([own.meta.id]);
    await expect(p.auth.signIn(DEMO_EMAIL, DEMO_PASSWORD)).rejects.toBeInstanceOf(AuthError);
    expect((await createPlatform(mem).init()).firstRun).toBe(false);
    expect(await p.repos.getUser(DEMO_USER_ID)).toBeNull();
  });

  it('„Alle Daten löschen“ entfernt alles; der nächste Start beginnt neu', async () => {
    await signUpAdmin();
    await wipeAllData(p.repos);
    expect(await mem.keys()).toEqual([]);
    const r = await createPlatform(mem).init();
    expect(r.firstRun).toBe(true);
  });
});
