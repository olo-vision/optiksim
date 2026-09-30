/**
 * 0.10.0 – Cloud-Inhalte im Browser: CloudContentStore (Bibliothek über das Konto), Konflikterkennung,
 * Lizenzende/Neukauf, Kontentrennung, Übernahme lokaler Daten und Einstellungs-Aufteilung.
 * Läuft gegen das MockBackend (bildet RLS- und Lizenzregeln der Datenbank nach).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MockBackend } from '@/cloud/mockBackend';
import { CloudError, type RegistrationInput } from '@/cloud/types';
import { Repositories } from '@/platform/repositories';
import { MemoryStorageProvider } from '@/platform/storage';
import { LibraryService, LEGACY_OWNER } from '@/platform/library';
import { ContentConflictError } from '@/platform/content';
import { makeUser } from '@/platform/auth';
import { createBlankDocument } from '@/platform/templates';
import { DEFAULT_USER_PREFS, normalizePrefs } from '@/platform/preferences';
import type { User } from '@/platform/models';
import { CloudContentStore } from '@/app/cloudContent';
import { LocalContentMigration, LOCAL_COPY_RETENTION_DAYS, MIGRATION_KEYS } from '@/app/cloudMigration';
import { DEVICE_PREF_KEYS, mergePrefs, syncedPrefs } from '@/app/cloudPrefs';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const reg = (email: string): RegistrationInput => ({
  firstName: 'Anna',
  lastName: 'Auge',
  email,
  password: 'Geheim123',
  passwordConfirm: 'Geheim123',
  institutionType: 'business',
  institutionName: `Optik ${email}`,
  addressLine1: 'Hauptstr. 1',
  postalCode: '66709',
  city: 'Weiskirchen',
  country: 'DE',
});

/** Server (gemeinsamer Mock-Speicher) + ein „Gerät“ (eigener lokaler Speicher) */
interface Device {
  backend: MockBackend;
  repos: Repositories;
  store: CloudContentStore;
  lib: LibraryService;
  user: User;
  cloudUserId: string;
}

let server: ReturnType<typeof memoryStorage>;

async function signUp(email: string, licensed = true) {
  const b = new MockBackend(server, { isolatedSession: true });
  const r = await b.signUp(reg(email));
  if (licensed) b.hooks().setLicenseStatus(email, 'active');
  await b.signOut();
  return r.user!.id;
}

async function device(email: string, local = new MemoryStorageProvider()): Promise<Device> {
  const backend = new MockBackend(server, { isolatedSession: true });
  const u = await backend.signIn(email, 'Geheim123');
  const repos = new Repositories(local);
  const workspaceUserId = `sb_${u.id}`;
  const store = new CloudContentStore(backend, repos, { cloudUserId: u.id, workspaceUserId, organizationId: 'sb_org_x' });
  const user = makeUser({ id: workspaceUserId, firstName: 'Anna', lastName: 'Auge', email, role: 'trainer', organizationId: 'sb_org_x' });
  return { backend, repos, store, lib: new LibraryService(store), user, cloudUserId: u.id };
}

const doc = (name = 'Szene') => createBlankDocument(name, DEFAULT_USER_PREFS);

beforeEach(() => {
  server = memoryStorage();
});

describe('CloudContentStore – Bibliothek im Konto', () => {
  it('Anlegen, Laden, Speichern, Umbenennen, Favorit, Löschen – auf einem zweiten Gerät sichtbar', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'Myopie -3', doc: doc('Myopie -3') }, 'data:image/png;base64,AAAA');
    expect(rec.meta.ownerId).toBe(a.user.id);
    expect(rec.meta.hasThumbnail).toBe(true);
    // Nichts liegt im LocalStorage des Geräts
    expect(await a.repos.listSimMeta()).toEqual([]);

    const b = await device('anna@optik.de');
    const list = await b.lib.list(b.user);
    expect(list.map((m) => m.name)).toEqual(['Myopie -3']);
    const loaded = await b.lib.get(b.user, rec.meta.id);
    expect(loaded?.doc.name).toBe('Myopie -3');
    expect(await b.lib.thumbnail(rec.meta.id)).toBe('data:image/png;base64,AAAA');

    await b.lib.save(b.user, rec.meta.id, { ...loaded!.doc, name: 'Myopie -3,5' });
    await b.lib.updateDetails(b.user, rec.meta.id, { favorite: true });
    await b.lib.rename(b.user, rec.meta.id, 'Myopie korrigiert');
    const again = await a.lib.get(a.user, rec.meta.id);
    expect(again?.meta).toMatchObject({ name: 'Myopie korrigiert', favorite: true });
    expect(again?.doc.name).toBe('Myopie korrigiert');

    await a.lib.remove(a.user, rec.meta.id);
    expect(await b.lib.list(b.user)).toEqual([]);
  });

  it('Favorit/Zuletzt geöffnet ändern die Revision nicht (kein falscher Konflikt)', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'S', doc: doc('S') });
    const opened = await a.lib.get(a.user, rec.meta.id);
    await a.lib.markOpened(rec.meta.id);
    await a.lib.updateDetails(a.user, rec.meta.id, { favorite: true });
    await a.lib.rename(a.user, rec.meta.id, 'S2');
    await expect(a.lib.save(a.user, rec.meta.id, opened!.doc)).resolves.toMatchObject({ name: 'S' });
  });

  it('Konflikt: anderes Gerät hat inzwischen gespeichert → ContentConflictError; Überschreiben nur mit force', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const b = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'Gemeinsam', doc: doc('Gemeinsam') });
    const onA = await a.lib.get(a.user, rec.meta.id);
    const onB = await b.lib.get(b.user, rec.meta.id);
    await b.lib.save(b.user, rec.meta.id, { ...onB!.doc, name: 'Gemeinsam (B)' });
    // Liste neu laden darf die Basis-Revision von A NICHT still aktualisieren
    await a.lib.list(a.user);
    await expect(a.lib.save(a.user, rec.meta.id, { ...onA!.doc, name: 'Gemeinsam (A)' })).rejects.toBeInstanceOf(ContentConflictError);
    await a.lib.save(a.user, rec.meta.id, { ...onA!.doc, name: 'Gemeinsam (A)' }, null, { force: true });
    expect((await b.lib.get(b.user, rec.meta.id))?.meta.name).toBe('Gemeinsam (A)');
  });

  it('auf anderem Gerät gelöscht → Konflikt mit remoteDeleted', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const b = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'X', doc: doc('X') });
    const onA = await a.lib.get(a.user, rec.meta.id);
    await b.lib.remove(b.user, rec.meta.id);
    const err = await a.lib.save(a.user, rec.meta.id, onA!.doc).catch((e) => e);
    expect(err).toBeInstanceOf(ContentConflictError);
    expect((err as ContentConflictError).remoteDeleted).toBe(true);
  });

  it('Konten sind getrennt: kein Lesen, Ändern oder Löschen fremder Inhalte', async () => {
    await signUp('anna@optik.de');
    await signUp('bernd@optik.de');
    const anna = await device('anna@optik.de');
    const rec = await anna.lib.create(anna.user, { name: 'Anna privat', doc: doc() });
    const bernd = await device('bernd@optik.de');
    expect(await bernd.lib.list(bernd.user)).toEqual([]);
    expect(await bernd.lib.get(bernd.user, rec.meta.id)).toBeNull();
    expect(await bernd.backend.updateSimulation(rec.meta.id, { name: 'gehackt' })).toBeNull();
    await bernd.backend.deleteSimulation(rec.meta.id);
    expect((await anna.lib.list(anna.user)).map((m) => m.name)).toEqual(['Anna privat']);
    // gleiche ID in einem anderen Konto → „exists“ (keine Übernahme fremder Zeilen)
    await expect(bernd.backend.insertSimulation({ ...(await anna.backend.getSimulation(rec.meta.id))!, thumbnail: null, lastOpenedAt: null })).rejects.toMatchObject({ code: 'exists' });
  });

  it('Lizenzende: Inhalte bleiben lesbar, Schreiben gesperrt; nach Neukauf wieder vollständig verfügbar', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'Bleibt', doc: doc('Bleibt') });
    a.backend.hooks().setLicenseStatus('anna@optik.de', 'expired');
    const b = await device('anna@optik.de');
    expect((await b.lib.list(b.user)).map((m) => m.name)).toEqual(['Bleibt']);
    const loaded = await b.lib.get(b.user, rec.meta.id);
    expect(loaded).not.toBeNull();
    await expect(b.lib.save(b.user, rec.meta.id, loaded!.doc)).rejects.toMatchObject({ code: 'OLL01' });
    await expect(b.lib.create(b.user, { name: 'Neu', doc: doc() })).rejects.toMatchObject({ code: 'OLL01' });
    // „Zuletzt geöffnet“ darf ohne Lizenz nicht scheitern (rein informativ)
    await expect(b.lib.markOpened(rec.meta.id)).resolves.toBeUndefined();
    // Neukauf
    a.backend.hooks().setLicenseStatus('anna@optik.de', 'active');
    await b.lib.save(b.user, rec.meta.id, { ...loaded!.doc, name: 'Bleibt' });
    expect((await b.lib.list(b.user))).toHaveLength(1);
  });

  it('eigene Vorlagen im Konto', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const t = await a.lib.saveAsTemplate(a.user, doc('V'), { name: 'Meine Vorlage', category: 'training', visibility: 'private' });
    const b = await device('anna@optik.de');
    const custom = (await b.lib.listTemplates(b.user)).filter((x) => x.visibility !== 'builtin');
    expect(custom.map((x) => x.name)).toEqual(['Meine Vorlage']);
    const sim = await b.lib.createFromTemplate(b.user, t.id);
    expect(sim.meta.templateId).toBe(t.id);
    await b.lib.deleteTemplate(b.user, t.id);
    expect((await a.lib.listTemplates(a.user)).some((x) => x.id === t.id)).toBe(false);
  });

  it('zu großes Vorschaubild verhindert das Speichern nicht', async () => {
    await signUp('anna@optik.de');
    const a = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'Groß', doc: doc() }, `data:image/png;base64,${'A'.repeat(700_000)}`);
    expect(rec.meta.hasThumbnail).toBe(false);
  });
});

describe('Übernahme lokaler Daten (LocalStorage → Konto)', () => {
  /** Lokaler Bestand wie in 0.8/0.9 (Arbeitsbereich sb_<uuid>) */
  async function seedLocal(repos: Repositories, ownerId: string, names: string[]) {
    const local = new LibraryService(repos);
    const u = makeUser({ id: ownerId, firstName: 'A', lastName: 'B', email: 'x@y.de', role: 'trainer' });
    const out = [];
    for (const n of names) out.push(await local.create(u, { name: n, doc: doc(n) }));
    return out;
  }

  it('übernimmt nur eigene Inhalte, gleiche IDs, einmalig (keine Duplikate)', async () => {
    const annaId = await signUp('anna@optik.de');
    const berndId = await signUp('bernd@optik.de');
    const local = new MemoryStorageProvider();
    const repos = new Repositories(local);
    const own = await seedLocal(repos, `sb_${annaId}`, ['Eigene 1', 'Eigene 2']);
    await seedLocal(repos, `sb_${berndId}`, ['Von Bernd']);
    const localUser = makeUser({ id: `sb_${annaId}`, firstName: 'A', lastName: 'B', email: 'anna@optik.de', role: 'trainer' });
    await new LibraryService(repos).saveAsTemplate(localUser, doc(), { name: 'Lokale Vorlage', category: 'other', visibility: 'private' });

    const a = await device('anna@optik.de', local);
    const r1 = await new LocalContentMigration(a.repos, a.store, a.backend).run();
    expect(r1).toMatchObject({ imported: 2, templates: 1, failed: 0, waitingForLicense: 0 });
    const cloud = await a.lib.list(a.user);
    expect(cloud.map((m) => m.id).sort()).toEqual(own.map((r) => r.meta.id).sort());
    // zweiter Lauf: nichts Neues
    const r2 = await new LocalContentMigration(a.repos, a.store, a.backend).run();
    expect(r2).toMatchObject({ imported: 0, copies: 0, templates: 0 });
    expect(await a.lib.list(a.user)).toHaveLength(2);
    // lokale Kopien bleiben als Rückfallebene
    expect(await repos.listSimMeta()).toHaveLength(3);
    // Bernds Inhalte wurden nicht übernommen
    const b = await device('bernd@optik.de', local);
    expect(await b.lib.list(b.user)).toEqual([]);
  });

  it('neuere Cloud-Daten werden nie überschrieben; lokal neuerer Stand wird zusätzliche Kopie', async () => {
    const annaId = await signUp('anna@optik.de');
    // Gerät 1 hat übernommen und danach in der Cloud weitergearbeitet
    const local1 = new MemoryStorageProvider();
    const [s1, s2] = await seedLocal(new Repositories(local1), `sb_${annaId}`, ['Cloud neuer', 'Lokal neuer']);
    const d1 = await device('anna@optik.de', local1);
    await new LocalContentMigration(d1.repos, d1.store, d1.backend).run();
    const c1 = await d1.lib.get(d1.user, s1.meta.id);
    await new Promise((r) => setTimeout(r, 5));
    await d1.lib.save(d1.user, s1.meta.id, { ...c1!.doc, name: 'Cloud neuer' });

    // Gerät 2 hat dieselben IDs lokal (z. B. aus einer Sicherung) – s2 dort später geändert
    const local2 = new MemoryStorageProvider();
    const repos2 = new Repositories(local2);
    await repos2.saveSim({ ...s1.meta, updatedAt: '2020-01-01T00:00:00.000Z' }, s1.doc);
    const newer = { ...s2.doc, eye: { ...s2.doc.eye } };
    (newer as { notes?: string }).notes = 'lokal geändert';
    await repos2.saveSim({ ...s2.meta, updatedAt: new Date(Date.now() + 1000).toISOString() }, { ...newer, name: 'Lokal neuer' });
    const d2 = await device('anna@optik.de', local2);
    const r = await new LocalContentMigration(d2.repos, d2.store, d2.backend).run();
    expect(r).toMatchObject({ imported: 0, alreadyInCloud: 1, copies: 1 });
    const names = (await d2.lib.list(d2.user)).map((m) => m.name).sort();
    expect(names).toEqual(['Cloud neuer', 'Lokal neuer', 'Lokal neuer (von diesem Gerät)']);
  });

  it('ohne Lizenz: nichts wird geschrieben, lokale Daten bleiben; nach Lizenzkauf übernommen', async () => {
    const annaId = await signUp('anna@optik.de', false);
    const local = new MemoryStorageProvider();
    await seedLocal(new Repositories(local), `sb_${annaId}`, ['Wartet']);
    const a = await device('anna@optik.de', local);
    const r1 = await new LocalContentMigration(a.repos, a.store, a.backend).run();
    expect(r1).toMatchObject({ imported: 0, waitingForLicense: 1 });
    expect(await local.get(MIGRATION_KEYS.account(a.cloudUserId))).toBeNull();
    a.backend.hooks().setLicenseStatus('anna@optik.de', 'active');
    const r2 = await new LocalContentMigration(a.repos, a.store, a.backend).run();
    expect(r2).toMatchObject({ imported: 1, waitingForLicense: 0 });
  });

  it('Altbestand (Vorversion) nur nach Bestätigung und nur für ein Konto dieses Geräts', async () => {
    await signUp('anna@optik.de');
    await signUp('bernd@optik.de');
    const local = new MemoryStorageProvider();
    await seedLocal(new Repositories(local), LEGACY_OWNER, ['Alt 1', 'Alt 2']);
    const a = await device('anna@optik.de', local);
    const m = new LocalContentMigration(a.repos, a.store, a.backend);
    expect((await m.run()).legacyPending).toBe(2);
    expect(await a.lib.list(a.user)).toEqual([]);
    expect(await m.importLegacy()).toEqual({ imported: 2, failed: 0 });
    expect((await a.lib.list(a.user)).map((x) => x.name).sort()).toEqual(['Alt 1', 'Alt 2']);
    const b = await device('bernd@optik.de', local);
    expect((await new LocalContentMigration(b.repos, b.store, b.backend).run()).legacyPending).toBe(0);
  });

  it(`lokale Kopien werden nach ${LOCAL_COPY_RETENTION_DAYS} Tagen entfernt (Entwürfe bleiben)`, async () => {
    const annaId = await signUp('anna@optik.de');
    const local = new MemoryStorageProvider();
    const repos = new Repositories(local);
    const [s] = await seedLocal(repos, `sb_${annaId}`, ['Alt']);
    await repos.saveDraft({ simId: s.meta.id, savedAt: new Date().toISOString(), doc: s.doc });
    const a = await device('anna@optik.de', local);
    await new LocalContentMigration(a.repos, a.store, a.backend).run();
    const later = Date.now() + (LOCAL_COPY_RETENTION_DAYS + 1) * 86_400_000;
    const r = await new LocalContentMigration(a.repos, a.store, a.backend, () => later).run();
    expect(r.purgedLocalCopies).toBe(1);
    expect(await repos.listSimMeta()).toEqual([]);
    expect(await repos.getDraft(s.meta.id)).not.toBeNull();
    expect(await a.lib.list(a.user)).toHaveLength(1);
  });
});

describe('Einstellungen: Konto vs. Gerät', () => {
  it('gerätebezogene Werte werden nicht synchronisiert', () => {
    const p = normalizePrefs({ ...DEFAULT_USER_PREFS, quality: 'performance', leftPanelWidth: 300, decimals: 3, theme: 'light' });
    const synced = syncedPrefs(p);
    for (const k of DEVICE_PREF_KEYS) expect(synced).not.toHaveProperty(k);
    expect(synced).toMatchObject({ decimals: 3, theme: 'light' });
    const tablet = normalizePrefs({ ...DEFAULT_USER_PREFS, quality: 'high', leftPanelWidth: 240 });
    const merged = mergePrefs(tablet, { ...synced, quality: 'performance' });
    expect(merged).toMatchObject({ decimals: 3, theme: 'light', quality: 'high', leftPanelWidth: 240 });
  });

  it('Einstellungen im Konto: nur die eigenen', async () => {
    await signUp('anna@optik.de');
    await signUp('bernd@optik.de');
    const a = await device('anna@optik.de');
    await a.backend.savePreferences({ decimals: 3 });
    const b = await device('bernd@optik.de');
    expect(await b.backend.getPreferences()).toBeNull();
    const a2 = await device('anna@optik.de');
    expect(await a2.backend.getPreferences()).toEqual({ decimals: 3 });
  });
});

describe('Fehlerabbildung', () => {
  it('OLL01 → verständliche Meldung', async () => {
    const { translateError } = await import('@/cloud/errors');
    expect(translateError({ code: 'OLL01', message: 'x' }).message).toMatch(/aktive Lizenz/);
    expect(translateError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'network' });
    expect(translateError({ code: '23514', message: 'check' }).message).toMatch(/zu groß/);
    expect(new CloudError('x', undefined, 'OLL01').code).toBe('OLL01');
  });
});

describe('Produktions-Härtung (Browser)', () => {
  it('Kontowechsel: der alte Inhaltsspeicher schreibt nie in das neue Konto', async () => {
    await signUp('anna@optik.de');
    await signUp('bernd@optik.de');
    const a = await device('anna@optik.de');
    const rec = await a.lib.create(a.user, { name: 'Anna', doc: doc('Anna') });
    // im selben Browser meldet sich (z. B. in einem zweiten Tab) Bernd an → dieselbe Sitzung gehört jetzt Bernd
    await a.backend.signIn('bernd@optik.de', 'Geheim123');
    const err = await a.lib.save(a.user, rec.meta.id, doc('Anna geändert')).catch((e) => e);
    expect(err).toMatchObject({ code: 'session' });
    await expect(a.lib.create(a.user, { name: 'Falsches Konto', doc: doc() })).rejects.toMatchObject({ code: 'session' });
    const b = await device('bernd@optik.de');
    expect(await b.lib.list(b.user)).toEqual([]);
    // entsorgter Speicher bleibt gesperrt
    a.store.dispose();
    await a.backend.signIn('anna@optik.de', 'Geheim123');
    await expect(a.lib.create(a.user, { name: 'x', doc: doc() })).rejects.toMatchObject({ code: 'session' });
  });

  it('Übernahme lokaler Daten bricht beim Kontowechsel ab (nichts landet im falschen Konto)', async () => {
    const annaId = await signUp('anna@optik.de');
    await signUp('bernd@optik.de');
    const local = new MemoryStorageProvider();
    const repos = new Repositories(local);
    const lu = makeUser({ id: `sb_${annaId}`, firstName: 'A', lastName: 'B', email: 'anna@optik.de', role: 'trainer' });
    await new LibraryService(repos).create(lu, { name: 'Lokal A', doc: doc('Lokal A') });
    const a = await device('anna@optik.de', local);
    await a.backend.signIn('bernd@optik.de', 'Geheim123');
    await expect(new LocalContentMigration(a.repos, a.store, a.backend).run()).rejects.toMatchObject({ code: 'session' });
    const b = await device('bernd@optik.de');
    expect(await b.lib.list(b.user)).toEqual([]);
  });

  it('technische Fehlermeldungen werden nie roh angezeigt', async () => {
    const { translateError } = await import('@/cloud/errors');
    expect(translateError({ code: 'PGRST301', message: 'JWT expired' })).toMatchObject({ code: 'session' });
    expect(translateError({ message: 'missing email or phone' }).message).toBe('Bitte geben Sie E-Mail-Adresse und Passwort ein.');
    expect(translateError({ code: '57014', message: 'canceling statement due to statement timeout' }).message).toMatch(/zu lange/);
    expect(translateError({ code: 'XX000', message: 'internal error at foo.c:12' }).message).toMatch(/^Es ist ein unerwarteter Fehler aufgetreten.*Code XX000/);
    // eigene deutsche Datenbankmeldungen bleiben lesbar
    expect(translateError({ code: 'P0002', message: 'Zu dieser E-Mail-Adresse gibt es kein Konto.' }).message).toBe('Zu dieser E-Mail-Adresse gibt es kein Konto.');
    // Link-Ablauf nur bei Auth-Links, nicht bei jeder Meldung mit „expired“
    expect(translateError({ code: 'otp_expired', message: 'Email link is invalid or has expired' }).message).toMatch(/Link ist abgelaufen/);
  });
});

describe('Paketwahl und Rücksprung', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  it('Demo-Wahl ohne Kontobezug startet nie für ein anderes Konto; Registrierungs-Wahl nur für dieses Konto', async () => {
    const { saveIntent, loadIntent, clearIntent } = await import('@/cloud/intent');
    saveIntent({ plan: 'demo', interval: 'monthly' });
    expect(loadIntent('fremd@web.de')).toBeNull();
    expect(loadIntent()).toMatchObject({ plan: 'demo' });
    saveIntent({ plan: 'business', interval: 'yearly' }, 'Anna@Optik.de');
    expect(loadIntent('anna@optik.de')).toMatchObject({ plan: 'business', interval: 'yearly' });
    expect(loadIntent('bernd@optik.de')).toBeNull();
    clearIntent();
    expect(loadIntent()).toBeNull();
  });
  it('Rücksprungziel nur innerhalb der Anwendung', async () => {
    const { safeNext } = await import('@/app/pages/cloud/AuthPages');
    expect(safeNext('/simulations/sim_1')).toBe('/simulations/sim_1');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', null]) expect(safeNext(bad)).toBeNull();
  });
});
