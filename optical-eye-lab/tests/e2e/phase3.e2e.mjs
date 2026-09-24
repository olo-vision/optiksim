/**
 * Phase 3 – Anwendung: Erststart, Konto, Dashboard, neue Simulation, Speichern, Bibliothek,
 * Wiederöffnen, Verlassen-Schutz, Einstellungen, Import, Admin, Benutzerwechsel, Gast, Routing.
 * Aufruf: Dev-Server starten (npm run dev), dann `node tests/e2e/phase3.e2e.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { url } from './helpers.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}p3_${n}.png` });
const waitSim = async () => {
  await page.waitForFunction(() => !!window.__oel?.getState().simId && !!document.querySelector('.viewport canvas'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
};
/** wartet bis zu `ms` auf Sichtbarkeit (statt Momentaufnahme) */
const vis = (sel, ms = 5000) => page.locator(sel).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const safe = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
  }
};

// 1) Erststart: Splash → Login
await safe('Erststart', async () => {
  await page.goto(url(''));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify({ quality: 'performance' })); });
  await page.reload();
  const splash = await vis('.splash').catch(() => false);
  check('Splash-Screen beim Start', splash);
  await page.waitForURL(/\/login/, { timeout: 15000 });
  check('Weiterleitung zur Anmeldung', page.url().includes('/login'));
  check('Hinweis „lokale Demo-Anmeldung“ sichtbar', await vis('.login__notice:has-text("Lokale Demo-Anmeldung")'));
  check('Keine falschen Sicherheitsversprechen', !(await page.content()).match(/verschlüsselt gespeichert|Cloud-gesichert|Enterprise Security/i));
  await shot('01_login');
});

// 2) Konto erstellen → Dashboard mit Onboarding
await safe('Konto erstellen', async () => {
  await page.click('.ds-tab:has-text("Konto erstellen")');
  await page.fill('input[autocomplete=given-name]', 'Jon');
  await page.fill('input[autocomplete=family-name]', 'Tester');
  await page.fill('.login__form input[type=email]', 'jon@test.de');
  await page.fill('.login__form input[type=password]', 'test1234');
  await page.fill('input[autocomplete=organization]', 'Augenoptik Tester');
  await page.click('.login__form button[type=submit]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  check('Nach Registrierung auf dem Dashboard', true);
  check('Onboarding erscheint', await vis('.onboarding'));
  await page.click('.dialog__footer button:has-text("Weiter")');
  check('Onboarding Schritt 2', (await page.textContent('.dialog__subtitle'))?.includes('2 von 4'));
  await page.click('.dialog__footer button:has-text("Überspringen")');
  check('Onboarding überspringbar', !(await vis('.onboarding')));
  check('Begrüßung mit Namen', /Jon/.test((await page.textContent('.page-header__title')) ?? ''));
  check('Erstes Konto ist Administrator/in', (await page.textContent('.page-header__eyebrow'))?.includes('Administrator'));
  await shot('02_dashboard');
});

// 3) Neue Simulation aus Vorlage
let simId = '';
await safe('Neue Simulation', async () => {
  await page.click('.page-header__actions button:has-text("Neue Simulation")');
  await page.click('.tpl-option:has-text("Myopie")');
  await page.fill('.new-sim__form input', 'E2E Myopie');
  await page.click('button:has-text("Erstellen und öffnen")');
  await page.waitForURL(/\/simulations\/sim_/, { timeout: 20000 });
  await waitSim();
  simId = page.url().split('/').pop();
  check('Simulator öffnet neue Simulation', (await page.evaluate(() => window.__oel.getState().doc.name)) === 'E2E Myopie');
  check('Breadcrumb „Meine Simulationen“', await vis('.sim-nav a:has-text("Meine Simulationen")'));
  await shot('03_simulator');
});

// 4) Ändern + Speichern (inkl. Vorschaubild)
await safe('Speichern', async () => {
  await page.evaluate(() => { const s = window.__oel.getState(); s.addElement('prism'); });
  await page.waitForTimeout(400);
  check('Änderung macht Simulation „dirty“', await page.evaluate(() => window.__oel.getState().dirty));
  await page.keyboard.press('Control+S');
  await page.waitForFunction(() => !window.__oel.getState().dirty, null, { timeout: 10000 });
  const meta = await page.evaluate((id) => JSON.parse(localStorage.getItem('oel:v3:sims:index')).find((m) => m.id === id), simId);
  check('Gespeichert mit Kurzinfo', meta?.summary.elementCount === 1, JSON.stringify(meta?.summary));
  check('Vorschaubild erzeugt', meta?.hasThumbnail === true && (await page.evaluate((id) => (localStorage.getItem('oel:v3:thumb:' + id) || '').includes('data:image/jpeg'), simId)));
  check('Statusleiste: gespeichert', /Gespeichert/.test((await page.textContent('.statusbar .save-status')) ?? ''));
});

// 5) Zurück zur Bibliothek, Karte, Wiederöffnen
await safe('Bibliothek', async () => {
  await page.click('.sim-nav a:has-text("Meine Simulationen")');
  await page.waitForURL(/\/simulations$/, { timeout: 10000 });
  await page.waitForSelector(`[data-sim-id="${simId}"]`);
  check('Karte in „Meine Simulationen“', await vis(`[data-sim-id="${simId}"] .sim-card__title:has-text("E2E Myopie")`));
  check('Vorschaubild auf der Karte', await vis(`[data-sim-id="${simId}"] img.sim-thumb`));
  await page.fill('.ds-search input', 'myopie e2e');
  await page.waitForTimeout(200);
  check('Suche findet Simulation', (await page.locator('.sim-card').count()) === 1);
  await page.fill('.ds-search input', 'gibtesnicht');
  check('Leerer Zustand bei keiner Übereinstimmung', await vis('.ds-empty:has-text("Keine Treffer")'));
  await page.fill('.ds-search input', '');
  await page.click(`[data-sim-id="${simId}"] .sim-card__fav`);
  await page.waitForTimeout(300);
  await page.click('.ds-tab:has-text("Favoriten")');
  check('Favoriten-Filter', (await page.locator(`[data-sim-id="${simId}"]`).count()) === 1);
  await page.click('.ds-tab:has-text("Alle")');
  await shot('05_library');
  await page.click(`[data-sim-id="${simId}"]`);
  await waitSim();
  const d = await page.evaluate(() => window.__oel.getState().doc);
  check('Wiederöffnen: gespeicherter Stand', d.name === 'E2E Myopie' && d.elements.length === 1);
});

// 6) Verlassen-Schutz (automatisches Speichern aus)
await safe('Verlassen-Schutz', async () => {
  await page.evaluate(() => window.__oel.getState().setPrefs({ autoSave: false }));
  await page.evaluate(() => window.__oel.getState().setSceneName('E2E Myopie geändert'));
  await page.click('.sim-nav a:has-text("Meine Simulationen")');
  await page.waitForSelector('.dialog:has-text("Änderungen speichern?")', { timeout: 5000 });
  check('Rückfrage „Änderungen speichern?“', true);
  await shot('06_guard');
  await page.click('.dialog__footer button:has-text("Abbrechen")');
  check('Abbrechen bleibt im Simulator', page.url().includes(simId));
  await page.click('.sim-nav a:has-text("Meine Simulationen")');
  await page.click('.dialog__footer button:has-text("Nicht speichern")');
  await page.waitForURL(/\/simulations$/);
  const titleNow = await page.evaluate((id) => JSON.parse(localStorage.getItem('oel:v3:sims:index')).find((m) => m.id === id)?.name, simId);
  check('„Nicht speichern“ verwirft', titleNow === 'E2E Myopie', titleNow);
  await page.evaluate(() => window.__oel.getState().setPrefs({ autoSave: true }));
});

// 7) Automatisches Speichern
await safe('Auto-Save', async () => {
  await page.goto(url(`simulations/${simId}`));
  await waitSim();
  await page.evaluate(() => window.__oel.getState().setSceneName('E2E Auto'));
  await page.waitForFunction(() => !window.__oel.getState().dirty, null, { timeout: 20000 });
  await page.reload();
  await waitSim();
  check('Automatisch gespeichert und nach Neuladen erhalten', (await page.evaluate(() => window.__oel.getState().doc.name)) === 'E2E Auto');
});

// 8) Einstellungen: helles Design, bleibt nach Neuladen
await safe('Einstellungen', async () => {
  await page.goto(url('settings/appearance'));
  await page.click('.segmented__item:has-text("Hell")');
  await page.waitForTimeout(500);
  check('Helles Design aktiv', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await shot('08_settings_light');
  await page.reload();
  await page.waitForSelector('.settings');
  await page.waitForTimeout(400);
  check('Einstellung bleibt nach Neuladen', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.click('.segmented__item:has-text("Dunkel")');
  await page.click('.settings__nav-item:has-text("Daten")');
  check('Datenbereich zeigt Speicherort', await vis('.ds-notice:has-text("Nur in diesem Browser")'));
});

// 9) Import: gültige und ungültige Datei
await safe('Import', async () => {
  await page.goto(url('simulations'));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.page-header__actions button:has-text("Importieren")')]);
  await fc.setFiles({ name: 'kaputt.opticsim', mimeType: 'application/json', buffer: Buffer.from('{ kein json') });
  await page.waitForSelector('.toast:has-text("keine gültige JSON")', { timeout: 5000 });
  check('Ungültige Datei → verständliche Meldung, kein Absturz', true);
  const doc = await page.evaluate((id) => localStorage.getItem('oel:v3:sim:' + id), simId);
  const file = JSON.stringify({ format: 'optical-eye-lab/simulation', version: 1, meta: { name: 'Importiert E2E', tags: [] }, doc: JSON.parse(doc) });
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.page-header__actions button:has-text("Importieren")')]);
  await fc2.setFiles({ name: 'ok.opticsim', mimeType: 'application/json', buffer: Buffer.from(file) });
  await page.waitForSelector('.sim-card__title:has-text("Importiert E2E")', { timeout: 5000 });
  check('Gültige .opticsim-Datei importiert', true);
});

// 10) Admin: Benutzer anlegen
await safe('Admin', async () => {
  await page.goto(url('admin/users'));
  await page.click('button:has-text("Benutzer hinzufügen")');
  const dlg = page.locator('.dialog');
  await dlg.locator('input').nth(0).fill('Lea');
  await dlg.locator('input').nth(1).fill('Lernt');
  await dlg.locator('input[type=email]').fill('lea@test.de');
  await dlg.locator('input[autocomplete=off]').fill('lea123');
  await page.click('.dialog__footer button:has-text("Anlegen")');
  await page.waitForSelector('[data-user-email="lea@test.de"]');
  check('Admin legt Benutzer an', true);
  await shot('10_admin');
});

// 11) Benutzer wechseln
await safe('Benutzer wechseln', async () => {
  await page.goto(url('dashboard'));
  await page.click('.side-nav .user-chip');
  await page.click('.menu__item:has-text("Benutzer wechseln")');
  await page.waitForURL(/\/login/);
  check('Bekanntes Konto wird angeboten', await vis('.login__known-item:has-text("Jon")'));
  await page.fill('.login__form input[type=email]', 'lea@test.de');
  await page.fill('.login__form input[type=password]', 'lea123');
  await page.click('.login__form button[type=submit]');
  await page.waitForURL(/\/dashboard/);
  if (await vis('.dialog__footer button:has-text("Überspringen")', 3000)) await page.click('.dialog__footer button:has-text("Überspringen")');
  check('Als Lea angemeldet', /Lea/.test((await page.textContent('.page-header__title')) ?? ''));
  await page.goto(url('simulations'));
  check('Lea sieht Jons Simulationen nicht', (await page.locator(`[data-sim-id="${simId}"]`).count()) === 0);
  await page.goto(url('admin/users'));
  check('Kein Admin-Zugriff für Nutzer/in', await vis('.ds-empty:has-text("Kein Zugriff")'));
  await page.reload();
  await page.waitForTimeout(1200);
  check('Sitzung bleibt nach Neuladen', !page.url().includes('/login'));
});

// 12) Abmelden, Gastzugang, Routing
await safe('Gast & Routing', async () => {
  await page.goto(url('dashboard'));
  await page.click('.side-nav .user-chip');
  await page.click('.menu__item:has-text("Abmelden")');
  await page.waitForURL(/\/login/);
  await page.goto(url('templates'));
  await page.waitForURL(/\/login\?next=/);
  check('Geschützte Route leitet zur Anmeldung (mit Rücksprung)', page.url().includes('next=%2Ftemplates'));
  await page.click('button:has-text("Demo starten")');
  await page.waitForURL(/\/templates/);
  check('Gastzugang über „Demo starten“', await vis('.banner:has-text("Gastzugang")'));
  await page.goto(url('gibt/es/nicht'));
  check('404-Seite', await vis('.ds-empty:has-text("Seite nicht gefunden")'));
  await page.goto(url('simulations/sim_unbekannt'));
  await page.waitForSelector('.ds-empty', { timeout: 15000 });
  check('Unbekannte Simulation → Hinweis statt Absturz', await vis('.ds-empty:has-text("nicht gefunden")'));
});

// 13) Responsiv
await safe('Responsiv', async () => {
  await page.goto(url('dashboard'));
  for (const [w, h] of [[1366, 768], [1180, 820], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`Dashboard ${w}×${h} ohne horizontalen Überlauf`, !overflow);
  }
  await shot('13_tablet');
});

check('Keine Laufzeitfehler in der Konsole', !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')), logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')).slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} bestanden`);
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
