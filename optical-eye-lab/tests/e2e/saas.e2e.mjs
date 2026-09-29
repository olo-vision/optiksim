/**
 * Phase 6 – SaaS-Grundstruktur (Browser, Mock-Backend): Startseite, Tarife, Registrierung (Privat/Business/
 * Education), Lizenzsperre, Login/Logout, Sitzung wiederherstellen, Freischaltung, Simulator mit Lizenz,
 * Admin nur für Super-Admins, Passwort vergessen/zurücksetzen, E-Mail-Bestätigung.
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174, VITE_AUTH_MODE=mock), dann `node tests/e2e/saas.e2e.mjs`.
 * Die Datenbank-Sicherheit (RLS) prüft `npm run test:db` gegen PostgreSQL.
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
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}saas_${n}.png` });
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
    // Phase 8: B2B-Rechnungsanschrift ist Pflicht
    await form.getByLabel('Straße und Hausnummer').fill('Hauptstraße 1');
    await form.getByLabel('PLZ').fill('10115');
    await form.locator('input[autocomplete="address-level2"]').fill('Berlin');
  }
  await form.locator('button[type=submit]').click();
}

async function login(email, password = 'Geheim123') {
  await page.goto(url('login'));
  const form = page.locator('[data-testid="login-form"]');
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort').fill(password);
  await form.locator('button[type=submit]').click();
}

async function dismissOnboarding() {
  // Onboarding erscheint für neue, lizenzierte Nutzer (wie im lokalen Modus)
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1200 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}

async function logout() {
  await dismissOnboarding();
  await page.click('[data-testid="user-menu"]');
  await page.click('.menu__item:has-text("Abmelden")');
  await page.waitForURL(/\/login/);
}

// Frischer Zustand
await page.goto(url(''));
await page.evaluate(() => localStorage.clear());
await page.reload();

// 1) Öffentliche Seiten
await safe('Öffentlich', async () => {
  check('Startseite öffentlich erreichbar', await vis('.public-hero'));
  await page.goto(url('pricing'));
  check('Tarifseite öffentlich erreichbar', await vis('[data-testid="plan-cards"]'));
  const prices = await page.$$eval('[data-testid^="price-"]', (els) => els.map((e) => e.textContent.trim()));
  check('Genau drei Tarife mit korrekten Preisen', JSON.stringify(prices) === JSON.stringify(['19,90 €', '39,90 €', '99,90 €']), prices.join(' | '));
  const names = await page.$$eval('.plan-card__name', (els) => els.map((e) => e.textContent.trim()));
  check('Tarifnamen Private/Business/Education', names.join('|') === 'OLO-LAB3D Private|OLO-LAB3D Business|OLO-LAB3D Education', names.join('|'));
  check('Standortbindung Business', (await page.textContent('[data-testid="plan-business"]')).includes('einen Betriebsstandort'));
  check('Standortbindung Education', (await page.textContent('[data-testid="plan-education"]')).includes('einen Bildungsstandort'));
  check('Hinweis zur Zahlung über Stripe', await vis('[data-testid="stripe-note"]'));
  await shot('01_pricing');
  await page.goto(url('dashboard'));
  await page.waitForURL(/\/login\?next=/);
  check('Geschützte Seite ohne Anmeldung → Login', path() === '/login');
});

// 2) Registrierung Business → Lizenz pending
await safe('Registrierung Business', async () => {
  await register({ type: 'business', first: 'Anna', last: 'Auge', email: 'anna@optik.de', org: 'Optik Auge GmbH' });
  await page.waitForURL(/\/license/);
  check('Nach Registrierung auf der Lizenzseite', true);
  check('Lizenzstatus pending', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'pending');
  check('Hinweis „noch nicht aktiv“', (await page.textContent('h1')).includes('noch nicht aktiv'));
  await shot('02_license_pending');
  await page.goto(url('account'));
  const details = await page.textContent('[data-testid="account-details"]');
  check('Konto: Name, E-Mail, Typ, Firma', details.includes('Anna Auge') && details.includes('anna@optik.de') && details.includes('Betrieb / Business') && details.includes('Optik Auge GmbH'), details.slice(0, 160));
  check('Konto: „Business-Lizenz – 1 Betriebsstandort“', (await page.textContent('[data-testid="account-license"]')) === 'Business-Lizenz – 1 Betriebsstandort');
  check('Konto: „Deine Lizenz ist noch nicht aktiviert.“', await vis('[data-testid="pending-note"]'));
  await shot('03_account');
});

// 3) Ohne aktive Lizenz kein Simulator
await safe('Lizenzsperre', async () => {
  for (const p of ['dashboard', 'modules/retinoscopy', 'simulations', 'simulations/new?template=tpl-myopia', 'settings']) {
    await page.goto(url(p));
    await page.waitForURL(/\/license/);
    check(`Ohne Lizenz gesperrt: /${p}`, path() === '/license');
  }
  check('Navigation ohne Simulator-Einträge', (await page.locator('.side-nav__item:has-text("Dashboard")').count()) === 0);
  await page.goto(url('admin'));
  check('Admin für normale Nutzer gesperrt', await vis('text=Super-Admins vorbehalten'));
});

// 4) Logout / Login / Sitzung
await safe('Logout/Login', async () => {
  await page.goto(url('account'));
  await logout();
  check('Logout → Anmeldeseite', path() === '/login');
  await page.goto(url('license'));
  await page.waitForURL(/\/login/);
  check('Nach Logout keine geschützten Seiten', path() === '/login');
  await login('anna@optik.de', 'falsch123');
  check('Falsches Passwort: verständliche Meldung', await vis('text=E-Mail oder Passwort ist nicht korrekt.'));
  await login('anna@optik.de');
  await page.waitForURL(/\/license/);
  check('Login → Lizenzseite (pending)', path() === '/license');
  await page.reload();
  await page.waitForSelector('[data-testid="license-status"]');
  check('Sitzung nach Neuladen wiederhergestellt', path() === '/license');
});

// 5) Freischaltung (wie „in Supabase auf active setzen“) → Simulator
await safe('Freischaltung', async () => {
  await mock('setLicenseStatus', 'anna@optik.de', 'active');
  await page.click('[data-testid="license-refresh"]');
  check('Lizenz aktiv nach erneuter Prüfung', await vis('[data-testid="license-status"][data-status="active"]'));
  await page.goto(url('dashboard'));
  check('Dashboard mit aktiver Lizenz', await vis('[data-testid="simulator-tile"]', 15000));
  check('Onboarding für neue lizenzierte Nutzer', await vis('.onboarding'));
  await dismissOnboarding();
  await page.goto(url('simulations/new?template=tpl-myopia'));
  await page.waitForURL(/\/simulations\/sim_/);
  await page.waitForFunction(() => !!document.querySelector('.viewport canvas'));
  check('Vollständiger Simulator mit aktiver Lizenz', true);
  const sim = path();
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.viewport canvas'));
  check('Simulator nach Neuladen (Sitzung + Lizenz)', path() === sim);
  await page.goto(url('modules/retinoscopy'));
  await page.waitForURL(/\/modules\/retinoscopy\/sim_/);
  check('Modul Skiaskopie mit aktiver Lizenz', await vis('[data-testid="module-panel"]', 20000));
  await shot('05_module');
  await page.goto(url('account'));
  await logout();
});

// 6) Lizenz wieder entzogen → sofort gesperrt
await safe('Lizenz entzogen', async () => {
  await mock('setLicenseStatus', 'anna@optik.de', 'suspended');
  await login('anna@optik.de');
  await page.waitForURL(/\/license/);
  check('Gesperrte Lizenz → kein Simulator', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'suspended');
  await logout();
});

// 7) Education und Private
await safe('Weitere Kundengruppen', async () => {
  await register({ type: 'education', first: 'Ben', last: 'Brille', email: 'ben@schule.de', org: 'Berufsschule Optik' });
  await page.waitForURL(/\/license/);
  await page.goto(url('account'));
  check('Education-Lizenz – 1 Bildungsstandort', (await page.textContent('[data-testid="account-license"]')) === 'Education-Lizenz – 1 Bildungsstandort');
  await logout();
  await register({ type: 'private', first: 'Clara', last: 'Cornea', email: 'clara@privat.de' });
  await page.waitForURL(/\/license/);
  await page.goto(url('account'));
  check('Private-Lizenz', (await page.textContent('[data-testid="account-license"]')) === 'Private-Lizenz');
  check('Privat: keine Firmenpflicht', (await page.textContent('[data-testid="account-details"]')).includes('Privat'));
});

// 8) Validierung der Registrierung
await safe('Validierung', async () => {
  await logout();
  await register({ type: 'business', first: 'Dora', last: 'Dioptrie', email: 'dora@optik.de' });
  check('Business ohne Firmenname abgelehnt', await vis('text=Bitte den Firmennamen eingeben.'));
  await register({ type: 'private', first: 'Dora', last: 'Dioptrie', email: 'anna@optik.de' });
  check('Doppelte E-Mail abgelehnt', await vis('text=existiert bereits ein Konto'));
});

// 9) Super-Admin
await safe('Admin', async () => {
  await mock('setRole', 'clara@privat.de', 'super_admin');
  await login('clara@privat.de');
  await page.waitForURL(/\/license/);
  await page.goto(url('admin'));
  check('Admin-Tabelle für Super-Admin', await vis('[data-testid="admin-table"]'));
  const rows = await page.locator('[data-testid="admin-table"] tbody tr').count();
  check('Alle Konten sichtbar', rows === 3, `${rows}`);
  await page.selectOption('select[aria-label="Lizenzstatus ben@schule.de"]', 'active');
  await page.waitForFunction(() => {
    const db = JSON.parse(localStorage.getItem('olo-mock-cloud') || '{}');
    const p = (db.profiles || []).find((x) => x.email === 'ben@schule.de');
    return p && db.licenses.find((l) => l.institutionId === p.institutionId)?.status === 'active';
  }, null, { timeout: 5000 }).catch(() => undefined);
  check('Admin: Statusänderung gespeichert', await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('olo-mock-cloud') || '{}');
    const p = db.profiles.find((x) => x.email === 'ben@schule.de');
    return db.licenses.find((l) => l.institutionId === p.institutionId).status;
  }) === 'active');
  await shot('09_admin');
  await logout();
  await login('ben@schule.de');
  await page.waitForURL(/\/(dashboard|simulations|license)/);
  check('Vom Admin aktivierte Lizenz schaltet frei', path() !== '/license', path());
  await logout();
});

// 10) Passwort vergessen / zurücksetzen
await safe('Passwort-Reset', async () => {
  await page.goto(url('forgot-password'));
  await page.getByLabel('E-Mail').fill('anna@optik.de');
  await page.click('button[type=submit]');
  check('Reset-Link angefordert', await vis('[data-testid="reset-sent"]'));
  await mock('openRecoveryLink', 'anna@optik.de');
  await page.goto(url('reset-password'));
  // Mock-Sitzung aus dem Link: nach dem Neuladen aktiv
  await page.waitForSelector('[data-testid="reset-form"]');
  await page.getByLabel('Neues Passwort').fill('Neu98765');
  await page.getByLabel('Passwort bestätigen').fill('Neu98765');
  await page.click('[data-testid="reset-form"] button[type=submit]');
  await page.waitForURL(/\/login\?reset=1/);
  check('Neues Passwort gespeichert', true);
  await login('anna@optik.de', 'Neu98765');
  await page.waitForURL(/\/license/);
  check('Anmeldung mit neuem Passwort', true);
  await logout();
});

// 11) E-Mail-Bestätigung (wenn in Supabase aktiviert)
await safe('E-Mail-Bestätigung', async () => {
  await mock('setRequireConfirmation', true);
  await register({ type: 'private', first: 'Emil', last: 'Einstein', email: 'emil@privat.de' });
  check('Hinweis „E-Mail bestätigen“', await vis('[data-testid="confirm-notice"]'));
  await login('emil@privat.de');
  check('Unbestätigt: Anmeldung verweigert', await vis('text=bestätige zuerst deine E-Mail-Adresse'));
  await mock('confirmEmail', 'emil@privat.de');
  await login('emil@privat.de');
  await page.waitForURL(/\/license/);
  check('Nach Bestätigung: Anmeldung möglich', true);
});

// 12) Responsiv
await safe('Responsiv', async () => {
  for (const p of ['pricing', 'register', 'license']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url(p));
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('.public, .login, .shell')?.scrollWidth > window.innerWidth + 1);
    check(`/${p} bei 390 px ohne horizontalen Überlauf`, !overflow);
  }
  await shot('12_mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
});

check('Keine Laufzeitfehler in der Konsole', !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')), logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')).slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} bestanden`);
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
