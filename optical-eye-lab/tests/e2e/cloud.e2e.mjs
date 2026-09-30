/**
 * 0.10.0 – Cloud-Speicherung und Kontoverwaltung im Browser (Mock-Backend, bildet RLS/Lizenzregeln nach):
 *  1. Simulation anlegen → liegt im Konto, NICHT im LocalStorage
 *  2. „Zweites Gerät“ (lokale Daten des Browsers gelöscht) → Simulation nach Anmeldung vorhanden
 *  3. Übernahme lokaler Altdaten (eigene automatisch, Vorversion nur nach Bestätigung)
 *  4. Anderes Konto sieht nichts
 *  5. Lizenzende → Inhalte bleiben (Konto/Export), Neukauf → alles wieder da
 *  6. Konto schließen → gesperrt, wieder öffnen → nutzbar
 *  7. Konto endgültig löschen (Passwort + „LÖSCHEN“)
 *  8. Abo-Verwaltung ohne Stripe-Kunde: kein Button, verständlicher Hinweis
 *  9. Responsive: wichtige Seiten in 5 Viewports ohne horizontales Überlaufen
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/cloud.e2e.mjs`.
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
const shot = (n) => page.screenshot({ path: `${OUT}cloud_${n}.png`, fullPage: true });
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
const localSimKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oel:v3:sim:')));
/** „Anderes Gerät“: alle lokalen Daten der App löschen – der (nachgebildete) Server bleibt */
const wipeDevice = () =>
  page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('oel:') || k.startsWith('optical-eye-lab.')) localStorage.removeItem(k);
    localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify({ quality: 'performance', onboardingDone: true }));
  });

async function register({ type, first, last, email, password = 'Geheim123', org }) {
  await page.goto(url('register'));
  await page.click(`[data-testid="type-${type}"]`);
  const form = page.locator('[data-testid="register-form"]');
  await form.getByLabel('Vorname', { exact: true }).fill(first);
  await form.getByLabel('Nachname', { exact: true }).fill(last);
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort', { exact: true }).fill(password);
  await form.getByLabel('Passwort bestätigen').fill(password);
  if (org) {
    await form.getByLabel(type === 'business' ? 'Firmenname' : 'Name der Schule / Bildungseinrichtung').fill(org);
    await form.getByLabel('Straße und Hausnummer').fill('Hauptstraße 1');
    await form.getByLabel('PLZ').fill('66709');
    await form.locator('input[autocomplete="address-level2"]').fill('Weiskirchen');
  }
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
async function dismissOnboarding() {
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1200 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}
async function logout() {
  await page.goto(url('account'));
  await page.click('[data-testid="account-signout"]');
  await page.waitForURL(/\/login/);
}
async function open(p) {
  await page.goto(url(p));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(500);
}
async function libraryNames() {
  await open('simulations');
  await dismissOnboarding();
  await page.waitForSelector('.lib-count');
  await page.waitForTimeout(300);
  return page.$$eval('.sim-card__title, .sim-card h3, .sim-table__name strong', (els) => els.map((e) => e.textContent.trim()));
}

const ANNA = 'anna@cloud-optik.de';
const BERND = 'bernd@cloud-optik.de';

await page.goto(url(''));
await page.evaluate(() => localStorage.clear());
await wipeDevice();
await page.reload();

let annaId = '';
let simId = '';

// 1) Anlegen → im Konto, nicht im Browser
await safe('Cloud-Speichern', async () => {
  await register({ type: 'business', first: 'Anna', last: 'Auge', email: ANNA, org: 'Optik Auge' });
  await mock('setLicenseStatus', ANNA, 'active');
  await open('license');
  annaId = (await serverDb()).users.find((u) => u.email === ANNA).id;
  await page.goto(url('simulations/new?template=tpl-myopia'));
  await page.waitForURL(/\/simulations\/sim_/, { timeout: 30000 });
  simId = path().split('/').pop();
  await page.waitForTimeout(1500);
  const db = await serverDb();
  check('Simulation im Konto gespeichert', db.sims.some((s) => s.id === simId && s.ownerUserId === annaId));
  check('Nicht im LocalStorage gespeichert', (await localSimKeys()).length === 0, JSON.stringify(await localSimKeys()));
  await open('dashboard');
});

// 2) Zweites Gerät
await safe('Zweites Gerät', async () => {
  await logout();
  await wipeDevice();
  await login(ANNA);
  const names = await libraryNames();
  check('Auf „anderem Gerät“ nach Anmeldung vorhanden', names.length === 1, names.join(', '));
  await page.goto(url(`simulations/${simId}`));
  check('Simulation lässt sich öffnen', await vis('.viewport canvas', 30000));
  await shot('02_second_device');
  await open('simulations');
});

// 3) Übernahme lokaler Daten
await safe('Übernahme lokaler Daten', async () => {
  const doc = (await serverDb()).sims.find((s) => s.id === simId).doc;
  await page.evaluate(
    ([uid, d]) => {
      const now = new Date().toISOString();
      const meta = (id, owner, name) => ({ id, name, description: '', ownerId: owner, createdAt: now, updatedAt: now, tags: [], category: 'refraction', favorite: false, archived: false, summary: { eyeRx: '–', elementCount: 0, elementKinds: [], highlights: [], modelName: '' }, hasThumbnail: false, schemaVersion: d.schemaVersion ?? 1 });
      const list = [meta('sim_localown1', `sb_${uid}`, 'Lokal gespeichert'), meta('sim_legacyold1', 'legacy', 'Aus Vorversion'), meta('sim_otheracc1', 'sb_00000000-0000-0000-0000-000000000000', 'Fremdes Konto')];
      localStorage.setItem('oel:v3:sims:index', JSON.stringify(list));
      for (const m of list) localStorage.setItem(`oel:v3:sim:${m.id}`, JSON.stringify({ ...d, name: m.name }));
    },
    [annaId, doc],
  );
  await logout();
  await login(ANNA);
  await page.waitForTimeout(1500);
  const names = await libraryNames();
  check('Eigene lokale Simulation übernommen', names.includes('Lokal gespeichert'), names.join(', '));
  check('Fremde lokale Daten nicht übernommen', !names.includes('Fremdes Konto'));
  check('Vorversion erst nach Bestätigung', !names.includes('Aus Vorversion') && (await vis('text=Simulationen aus einer früheren Version gefunden')));
  await shot('03_legacy_banner');
  await page.click('button:has-text("In mein Konto übernehmen")');
  await page.waitForTimeout(1200);
  const after = await libraryNames();
  check('Vorversion übernommen', after.includes('Aus Vorversion') && after.length === 3, after.join(', '));
  // erneute Anmeldung: keine Duplikate
  await logout();
  await login(ANNA);
  await page.waitForTimeout(1200);
  const again = await libraryNames();
  check('Keine Duplikate nach erneuter Anmeldung', again.length === 3, again.join(', '));
});

// 4) Anderes Konto
await safe('Kontentrennung', async () => {
  await logout();
  await register({ type: 'private', first: 'Bernd', last: 'Brille', email: BERND });
  await mock('setLicenseStatus', BERND, 'active');
  await open('license');
  const names = await libraryNames();
  check('Anderes Konto sieht keine fremden Simulationen', names.length === 0, names.join(', '));
  await page.goto(url(`simulations/${simId}`));
  check('Fremde Simulation per Adresse nicht erreichbar', await vis('text=Simulation nicht gefunden'));
  // 8) ohne Stripe-Kunde: kein Portal-Button
  await open('account');
  check('Ohne Abo kein „Abonnement verwalten“', (await page.locator('[data-testid="manage-subscription"]').count()) === 0);
  await logout();
});

// 5) Lizenzende und Neukauf
await safe('Lizenzende', async () => {
  await mock('setLicenseStatus', ANNA, 'expired');
  await login(ANNA);
  await open('simulations');
  check('Ohne Lizenz kein Zugriff auf die Bibliothek', path() === '/license');
  check('Hinweis: Inhalte bleiben erhalten', (await text('main, .page')).includes('gespeicherten Simulationen bleiben erhalten'));
  await open('account');
  await page.waitForSelector('[data-testid="account-content-count"]');
  await page.waitForTimeout(600);
  check('Konto zeigt gespeicherte Inhalte', (await text('[data-testid="account-content-count"]')).startsWith('3 Simulationen'));
  check('Export ohne Lizenz möglich', !(await page.locator('[data-testid="account-export"]').isDisabled()));
  check('Serverseitig nichts gelöscht', (await serverDb()).sims.filter((s) => s.ownerUserId === annaId).length === 3);
  await mock('setLicenseStatus', ANNA, 'active');
  await open('license');
  const names = await libraryNames();
  check('Nach Neukauf alle Inhalte wieder da', names.length === 3, names.join(', '));
});

// 6) Konto schließen / wieder öffnen
await safe('Konto schließen', async () => {
  await open('account');
  await page.click('[data-testid="account-close"]');
  await page.click('.dialog__footer button:has-text("Konto schließen")');
  await page.waitForSelector('[data-testid="account-closed-row"]');
  check('Konto geschlossen', (await serverDb()).profiles.find((p) => p.userId === annaId).accountStatus === 'closed');
  await open('dashboard');
  check('Geschlossenes Konto: kein Zugriff', path() === '/account');
  await shot('06_closed');
  await page.click('[data-testid="account-reopen"]');
  await page.waitForTimeout(800);
  await open('dashboard');
  check('Wieder geöffnet: Zugriff', path() === '/dashboard');
  check('Inhalte nach Wiederöffnen vorhanden', (await libraryNames()).length === 3);
});

// 7) Endgültig löschen
await safe('Konto löschen', async () => {
  await open('account');
  await page.click('[data-testid="account-delete-open"]');
  const form = page.locator('[data-testid="delete-form"]');
  await form.getByLabel('Aktuelles Passwort').fill('falsch');
  await form.getByLabel('Zur Bestätigung „LÖSCHEN“ eingeben').fill('LÖSCHEN');
  await page.click('[data-testid="delete-submit"]');
  check('Falsches Passwort wird abgelehnt', await vis('[data-testid="delete-form"] .ds-field__error'));
  await form.getByLabel('Aktuelles Passwort').fill('Geheim123');
  await page.click('[data-testid="delete-submit"]');
  await page.waitForURL(/\/login\?deleted=1/);
  check('Hinweis nach Löschung', await vis('text=Ihr Konto wurde gelöscht'));
  const db = await serverDb();
  check('Konto und Inhalte gelöscht', !db.users.some((u) => u.email === ANNA) && !db.sims.some((s) => s.ownerUserId === annaId));
  check('Nachweis ohne Klartext-E-Mail', db.deletedAccounts.some((d) => d.formerUserId === annaId) && !JSON.stringify(db.deletedAccounts).includes(ANNA));
  check('Bestätigungs-E-Mail', db.mails.some((m) => m.kind === 'account_deleted' && m.to === ANNA));
  const form2 = page.locator('[data-testid="login-form"]');
  await form2.getByLabel('E-Mail').fill(ANNA);
  await form2.getByLabel('Passwort').fill('Geheim123');
  await form2.locator('button[type=submit]').click();
  check('Anmeldung nach Löschung nicht mehr möglich', await vis('text=nicht korrekt'));
});

// 9) Responsive
const VIEWPORTS = [
  { name: 'desktop-xl', width: 1920, height: 1080 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet-land', width: 1180, height: 820 },
  { name: 'tablet-port', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
const PUBLIC = ['', 'pricing', 'login', 'register', 'kuendigen', 'widerrufen', 'impressum'];
const PRIVATE = ['dashboard', 'simulations', 'templates', 'settings', 'account', 'license', 'modules'];
await safe('Responsive', async () => {
  await login(BERND);
  const overflow = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const p of [...PUBLIC, ...PRIVATE]) {
      if (PUBLIC.includes(p) && p !== '' && ['login', 'register'].includes(p)) continue; // angemeldet: Weiterleitung
      await open(p);
      await dismissOnboarding();
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const off = [...document.querySelectorAll('button, a, input, select, h1, h2')]
          .filter((e) => {
            const b = e.getBoundingClientRect();
            if (!b.width || !b.height) return false;
            const st = getComputedStyle(e);
            if (st.visibility === 'hidden' || st.position === 'fixed' || e.tabIndex === -1 || e.closest('[aria-hidden="true"]')) return false;
            // in horizontal scrollbaren Containern (Tabellen) erlaubt
            for (let x = e.parentElement; x; x = x.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(x).overflowX) && x.scrollWidth > x.clientWidth) return false;
            return b.right > vw + 1 || b.left < -1;
          })
          .map((e) => { const b = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}[${Math.round(b.left)}..${Math.round(b.right)}]`; });
        const wide = off.length ? [...document.querySelectorAll('.page, .page *')].filter((e) => e.getBoundingClientRect().right > vw + 1 && !e.closest('button')).slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}:${Math.round(e.getBoundingClientRect().width)}`) : [];
        return { sw, vw, off: [...off.slice(0, 2), ...wide] };
      });
      if (r.sw > r.vw + 1 || r.off.length) overflow.push(`${vp.name}/${p || 'home'}: ${r.sw}>${r.vw} ${r.off.join(' | ')}`);
      if (['account', 'dashboard', 'pricing', 'simulations', 'settings'].includes(p)) await shot(`resp_${vp.name}_${p}`);
    }
    // Simulator: Steuerung sichtbar und innerhalb des Viewports
    await page.goto(url('simulations/new?template=tpl-myopia'));
    await page.waitForURL(/\/simulations\/sim_/, { timeout: 30000 });
    await page.waitForSelector('.viewport canvas', { timeout: 30000 });
    await page.waitForTimeout(800);
    const simOff = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const inScroller = (e) => { for (let x = e.parentElement; x; x = x.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(x).overflowX) && x.scrollWidth > x.clientWidth) return true; return false; };
      return [...document.querySelectorAll('button')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && (b.right > vw + 1 || b.left < -1) && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]') && !inScroller(e); }).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20));
    });
    if (simOff.length) overflow.push(`${vp.name}/simulator: ${simOff.slice(0, 4).join(' | ')}`);
    await page.screenshot({ path: `${OUT}cloud_resp_${vp.name}_simulator.png` });
    // Modul (Skiaskopie) mit Dock
    await page.goto(url('modules/retinoscopy'));
    await page.waitForURL(/\/modules\/retinoscopy\/sim_/, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const modOff = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (modOff > 1) overflow.push(`${vp.name}/modul: ${modOff}px`);
    await page.screenshot({ path: `${OUT}cloud_resp_${vp.name}_module.png` });
  }
  check('Kein horizontales Überlaufen (5 Viewports)', !overflow.length, overflow.join(' ;; ').slice(0, 1500));
  await page.setViewportSize({ width: 1440, height: 900 });
});

check('Keine Seitenfehler', !logs.length, logs.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
