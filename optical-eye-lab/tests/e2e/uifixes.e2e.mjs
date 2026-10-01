/**
 * Gezielte UI-/Admin-/Account-Korrekturen (Mock-Backend, Port 5174):
 *  1. Drei-Punkte-Menü bei gespeicherten Simulationen (Dashboard + Bibliothek: Karte und Liste):
 *     öffnet, öffnet NICHT zusätzlich die Simulation, Umbenennen, Duplizieren, Löschen nur nach Bestätigung
 *  2. Account-Menü oben rechts im Simulator bleibt in allen wichtigen Viewports vollständig sichtbar
 *  3. E-Mail-Adresse ändern: Erfolg (beide Bestätigungen), Rücksprung, Fehlerfall SMTP, vergebene Adresse,
 *     „Erneut senden“ mit Wartezeit, abgelaufener Link
 *  (Vertragscenter-Warnung: tests/e2e/legal.e2e.mjs, Abschnitt 8)
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/uifixes.e2e.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.E2E_CLOUD_URL ?? 'http://127.0.0.1:5174/').replace(/\/?$/, '/');
const url = (p) => new URL(p.replace(/^\//, ''), BASE).href;
const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
page.on('dialog', (d) => d.accept().catch(() => undefined));
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}ui_${n}.png` });
const vis = (sel, ms = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const safe = async (name, fn) => {
  try {
    if (process.env.E2E_VERBOSE) console.log('…', name);
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
  }
};
const path = () => new URL(page.url()).pathname;
const mock = (fn, ...args) => page.evaluate(([f, a]) => window.__oloMock[f](...a), [fn, args]);
const text = (sel) => page.textContent(sel).then((t) => (t ?? '').replace(/\s+/g, ' ').trim());
const serverDb = () => page.evaluate(() => JSON.parse(localStorage.getItem('olo-mock-cloud') ?? '{}'));

async function register({ email, first = 'Ulla', last = 'Tester', password = 'Geheim123' }) {
  await page.goto(url('register'));
  await page.click('[data-testid="type-private"]');
  const form = page.locator('[data-testid="register-form"]');
  await form.getByLabel('Vorname', { exact: true }).fill(first);
  await form.getByLabel('Nachname', { exact: true }).fill(last);
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort', { exact: true }).fill(password);
  await form.getByLabel('Passwort bestätigen').fill(password);
  for (const box of await form.locator('input[type=checkbox][required]').all()) await box.check();
  await form.locator('button[type=submit]').click();
  await page.waitForURL(/\/license/);
}
async function login(email, password = 'Geheim123') {
  await page.goto(url('login'));
  const form = page.locator('[data-testid="login-form"]');
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort').fill(password);
  await form.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function logout() {
  await page.goto(url('account'));
  await page.click('[data-testid="account-signout"]');
  await page.waitForURL(/\/login/);
}
async function open(p) {
  await page.goto(url(p));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}
async function dismissOnboarding() {
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1200 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}
async function newSim() {
  await page.goto(url('simulations/new?template=tpl-myopia'));
  await page.waitForURL(/\/simulations\/sim_/, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return path().split('/').pop();
}
/** liegt das Element (Menü) vollständig im Viewport? */
const inViewport = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { ok: false, info: 'nicht gefunden' };
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    // auch der Inhalt muss erreichbar sein: entweder ganz sichtbar oder im Menü scrollbar
    const reachable = el.scrollHeight <= el.clientHeight + 1 || getComputedStyle(el).overflowY === 'auto';
    return { ok: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh && reachable, info: `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)} @ ${vw}x${vh}` };
  }, sel);

const USER = 'ulla@menu-test.de';

await page.goto(url(''));
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify({ quality: 'performance', onboardingDone: true }));
});
await page.reload();

let simA = '';
let simB = '';

/* 1) Drei-Punkte-Menü */
await safe('Drei-Punkte-Menü', async () => {
  await register({ email: USER });
  await mock('setLicenseStatus', USER, 'active');
  simA = await newSim();
  simB = await newSim();
  await open('dashboard');
  await dismissOnboarding();
  const card = page.locator(`[data-sim-id="${simA}"]`).first();
  await card.waitFor();
  await card.locator('[data-testid="sim-actions"]').click();
  check('Dashboard: Menü öffnet', await vis('[role="menu"] .menu__item:has-text("Umbenennen")', 3000));
  check('Klick auf „…“ öffnet nicht zusätzlich die Simulation', path() === '/dashboard', path());
  for (const label of ['Öffnen', 'Umbenennen', 'Duplizieren', 'Exportieren', 'Löschen']) check(`Eintrag „${label}“ vorhanden`, await vis(`[role="menu"] .menu__item:has-text("${label}")`, 1500));
  check('Menü vollständig sichtbar (Karte schneidet nicht ab)', (await inViewport('[role="menu"]')).ok, (await inViewport('[role="menu"]')).info);
  await shot('01_card_menu');
  await page.keyboard.press('Escape');
  check('Escape schließt das Menü', !(await vis('[role="menu"]', 800)));

  // Umbenennen
  await card.locator('[data-testid="sim-actions"]').click();
  await page.click('[role="menu"] .menu__item:has-text("Umbenennen")');
  check('Klick auf Menüeintrag öffnet nicht die Simulation', path() === '/dashboard', path());
  const input = page.locator('.dialog input').first();
  await input.fill('   ');
  await page.click('.dialog__footer button:has-text("Umbenennen")');
  check('Leerer Name wird abgelehnt (Dialog bleibt offen, Hinweis)', (await vis('.dialog >> text=Bitte einen Wert eingeben.', 2000)) && (await serverDb()).sims.find((s) => s.id === simA)?.name !== '');
  await input.fill('  Refraktion Kunde Meier  ');
  await page.click('.dialog__footer button:has-text("Umbenennen")');
  await page.waitForFunction((id) => document.querySelector(`[data-sim-id="${id}"] .sim-card__title`)?.textContent?.trim() === 'Refraktion Kunde Meier', simA);
  check('Umbenannt: Karte aktualisiert', true);
  check('Umbenannt: im Konto gespeichert (getrimmt)', (await serverDb()).sims.find((s) => s.id === simA)?.name === 'Refraktion Kunde Meier');

  // Duplizieren
  const before = (await serverDb()).sims.length;
  await page.locator(`[data-sim-id="${simA}"] [data-testid="sim-actions"]`).first().click();
  await page.click('[role="menu"] .menu__item:has-text("Duplizieren")');
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem('olo-mock-cloud')).sims.length === n + 1, before);
  check('Dupliziert: Kopie im Konto', true);
  await open('simulations');
  const names = await page.$$eval('.sim-card__title', (els) => els.map((e) => e.textContent.trim()));
  check('Dupliziert: Kopie in der Bibliothek', names.filter((n) => n.startsWith('Refraktion Kunde Meier')).length === 2, names.join(' | '));

  // Löschen: Abbrechen → bleibt; Bestätigen → weg (Cloud + Oberfläche)
  const card2 = page.locator(`[data-sim-id="${simB}"]`).first();
  const nameB = (await card2.locator('.sim-card__title').textContent()).trim();
  await card2.locator('[data-testid="sim-actions"]').click();
  await page.click('[role="menu"] .menu__item:has-text("Löschen")');
  check('Löschen: Bestätigungsdialog mit Namen', (await vis('[data-testid="delete-sim-message"]', 3000)) && (await text('[data-testid="delete-sim-message"]')).includes(`„${nameB}“`), await text('[data-testid="delete-sim-message"]').catch(() => ''));
  await shot('02_delete_confirm');
  await page.click('.dialog__footer button:has-text("Abbrechen")');
  await page.waitForTimeout(400);
  check('Abbrechen: nichts gelöscht', (await serverDb()).sims.some((s) => s.id === simB) && (await vis(`[data-sim-id="${simB}"]`, 1500)));
  await card2.locator('[data-testid="sim-actions"]').click();
  await page.click('[role="menu"] .menu__item:has-text("Löschen")');
  await page.click('.dialog__footer button:has-text("Endgültig löschen")');
  await page.waitForFunction((id) => !document.querySelector(`[data-sim-id="${id}"]`), simB);
  check('Gelöscht: Karte verschwindet', true);
  check('Gelöscht: nicht mehr im Konto', !(await serverDb()).sims.some((s) => s.id === simB));
  check('Gelöscht: kein lokaler Rest', await page.evaluate((id) => !Object.keys(localStorage).some((k) => k.includes(id)), simB));

  // Listenansicht
  const listToggle = page.locator('[role="radio"][aria-label="Listenansicht"]').first();
  if (await listToggle.isVisible().catch(() => false)) {
    await listToggle.click();
    const row = page.locator('.sim-table [data-testid="sim-actions"]').first();
    await row.click();
    check('Listenansicht: Menü öffnet', await vis('[role="menu"] .menu__item:has-text("Umbenennen")', 3000));
    check('Listenansicht: Simulation nicht geöffnet', path() === '/simulations', path());
    await page.keyboard.press('Escape');
  } else check('Listenansicht: Umschalter gefunden', false);
});

/* 2) Account-Menü oben rechts im Simulator */
const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet-land', width: 1024, height: 768 },
  { name: 'tablet-port', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-small', width: 320, height: 568 },
];
await safe('Account-Menü im Simulator', async () => {
  await page.goto(url(`simulations/${simA}`));
  await page.waitForSelector('.viewport canvas', { timeout: 30000 });
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);
    const btn = page.locator('[data-testid="user-menu"]').first();
    if (!(await btn.isVisible().catch(() => false))) {
      check(`${vp.name}: Account-Button sichtbar`, false);
      continue;
    }
    await btn.click();
    await page.waitForSelector('[role="menu"][aria-label="Benutzermenü"]');
    await page.waitForTimeout(250);
    const r = await inViewport('[role="menu"][aria-label="Benutzermenü"]');
    check(`${vp.name}: Account-Menü vollständig im Viewport`, r.ok, r.info);
    // letzter Eintrag erreichbar (ggf. im Menü gescrollt) und klickbar
    const last = page.locator('[role="menu"][aria-label="Benutzermenü"] .menu__item:has-text("Abmelden")');
    await last.scrollIntoViewIfNeeded();
    const lb = await last.boundingBox();
    check(`${vp.name}: „Abmelden“ erreichbar`, !!lb && lb.x >= 0 && lb.x + lb.width <= vp.width && lb.y + lb.height <= vp.height);
    // rechtsbündig: Menü klappt nach links auf (rechte Kante nahe am Button)
    const bb = await btn.boundingBox();
    const mb = await page.locator('[role="menu"][aria-label="Benutzermenü"]').boundingBox();
    check(`${vp.name}: klappt nach links auf`, !!bb && !!mb && mb.x + mb.width <= bb.x + bb.width + 1 && mb.x < bb.x);
    // liegt über der Simulator-Steuerung (oberstes Element an der Menü-Mitte ist das Menü selbst)
    const onTop = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"][aria-label="Benutzermenü"]');
      const r = m.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height, 60) / 2);
      return !!el && m.contains(el);
    });
    check(`${vp.name}: Menü liegt über der Steuerung`, onTop);
    if (vp.name === 'laptop' || vp.name === 'phone') await shot(`03_account_menu_${vp.name}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Seitenleisten-Menü (nach oben) ebenfalls vollständig sichtbar
  await open('dashboard');
  await page.locator('[data-testid="user-menu"]').first().click();
  const r = await inViewport('[role="menu"][aria-label="Benutzermenü"]');
  check('Seitenleiste: Benutzermenü vollständig sichtbar', r.ok, r.info);
  await page.keyboard.press('Escape');
});

/* 3) E-Mail-Adresse ändern */
async function requestEmailChange(next, password = 'Geheim123') {
  await open('account');
  await page.click('[data-testid="email-change-open"]');
  const row = page.locator('[data-testid="account-email"]');
  await row.getByLabel('Neue E-Mail-Adresse').fill(next);
  await row.getByLabel('Aktuelles Passwort').fill(password);
  await row.locator('button[type=submit]').click();
}
await safe('E-Mail ändern – Fehlerfälle', async () => {
  await mock('setEmailChangeMode', 'smtp_error', true);
  await requestEmailChange('ulla.neu@menu-test.de');
  check('SMTP-Fehler: freundliche Meldung', (await vis('[data-testid="email-change-error"]', 5000)) && (await text('[data-testid="email-change-error"]')).includes('konnte gerade nicht versendet werden'), await text('[data-testid="email-change-error"]').catch(() => ''));
  check('SMTP-Fehler: kein Erfolgshinweis', !(await vis('[data-testid="email-change-pending"]', 800)));
  check('SMTP-Fehler: keine Technik sichtbar', !/error sending|500|smtp/i.test(await text('[data-testid="account-email"]')));
  await shot('04_email_error');
  await mock('setEmailChangeMode', 'send', true);
  const row = page.locator('[data-testid="account-email"]');
  await row.getByLabel('Neue E-Mail-Adresse').fill(USER);
  await row.locator('button[type=submit]').click();
  check('Gleiche Adresse: Feldfehler', await vis('[data-testid="account-email"] >> text=entspricht der bisherigen', 4000));
  await row.getByLabel('Neue E-Mail-Adresse').fill('ulla.neu@menu-test.de');
  await row.getByLabel('Aktuelles Passwort').fill('Falsch999');
  await row.locator('button[type=submit]').click();
  check('Falsches Passwort: Feldfehler', await vis('[data-testid="account-email"] >> text=Das aktuelle Passwort ist nicht korrekt.', 4000));
});

await safe('E-Mail ändern – Erfolgsfall und Rücksprung', async () => {
  await mock('setEmailChangeMode', 'send', true);
  await requestEmailChange('ulla.neu@menu-test.de');
  await page.waitForSelector('[data-testid="email-change-pending"]');
  const t = await text('[data-testid="email-change-sent"]');
  check('Erfolg: nennt neue und bisherige Adresse', t.includes('ulla.neu@menu-test.de') && t.includes(USER), t);
  check('Mails an beide Adressen versendet', JSON.stringify(await mock('emailChangeMails')) === JSON.stringify(['new:ulla.neu@menu-test.de', `current:${USER}`]), JSON.stringify(await mock('emailChangeMails')));
  check('„Erneut senden“ zunächst gesperrt (Wartezeit)', await page.locator('[data-testid="email-change-resend"]').isDisabled());
  check('Bisherige Adresse gilt weiter', (await text('[data-testid="account-email-current"]')) === USER);
  await shot('05_email_pending');
  // Neuladen: offener Stand bleibt sichtbar (aus Supabase new_email)
  await open('account');
  check('Offene Änderung nach Neuladen sichtbar', await vis('[data-testid="email-change-pending"]'));
  // Erneut senden nach Ablauf der Wartezeit
  await mock('ageEmailChange', 61);
  await open('account');
  await page.click('[data-testid="email-change-resend"]');
  check('Erneut senden: bestätigt', await vis('[data-testid="email-change-resent"]', 5000));
  check('Erneut senden: zwei weitere Mails', (await mock('emailChangeMails')).length === 4);
  // erster Link (bisherige Adresse) → Rücksprung meldet „noch zweiter Link nötig“
  const h1 = await mock('confirmEmailChange', 'current');
  await page.goto(url(`account?email_changed=1${h1}`));
  check('Erster Link: Hinweis auf zweite E-Mail', await vis('text=Bitte öffnen Sie jetzt auch den Link in der zweiten E-Mail', 6000));
  check('Erster Link: Adresse noch unverändert', (await text('[data-testid="account-email-current"]')) === USER);
  check('Rücksprung: Parameter aus der Adresse entfernt', path() === '/account' && !page.url().includes('email_changed'));
  // zweiter Link → bestätigt
  const h2 = await mock('confirmEmailChange', 'new');
  await page.goto(url(`account?email_changed=1${h2}`));
  check('Zweiter Link: bestätigt', await vis('text=Ihre neue E-Mail-Adresse ulla.neu@menu-test.de ist bestätigt', 6000));
  await page.waitForFunction(() => document.querySelector('[data-testid="account-email-current"]')?.textContent?.trim() === 'ulla.neu@menu-test.de');
  check('Neue Adresse angezeigt, kein offener Hinweis mehr', !(await vis('[data-testid="email-change-pending"]', 800)));
  check('Profil-E-Mail aktualisiert', (await serverDb()).profiles.some((p) => p.email === 'ulla.neu@menu-test.de'));
  await logout();
  await login('ulla.neu@menu-test.de');
  check('Anmeldung mit neuer Adresse', !path().startsWith('/login'), path());
  // abgelaufener/benutzter Link
  const h3 = await mock('confirmEmailChange', 'new');
  await page.goto(url(`account?email_changed=1${h3}`));
  check('Abgelaufener Link: freundliche Meldung', await vis('text=Der Bestätigungslink ist abgelaufen oder wurde bereits verwendet', 6000));
});

await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
if (logs.length) console.log('\n--- Konsole ---\n' + logs.join('\n'));
process.exit(failed.length ? 1 : 0);
