/**
 * Phase 7 – Stripe-Abos im Browser (Mock-Backend mit Stripe-Nachbau):
 * Tarifregel, Checkout-Abbruch, Checkout → „Zahlung wird bestätigt …“ → Webhook → Freischaltung,
 * Abo-Übersicht und „Abonnement verwalten“, Zahlungsausfall mit Frist, Sperre nach Fristende,
 * Nachzahlung, Kündigung zum Periodenende, Abo-Ende, Admin mit Sonderlizenz.
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/stripe.e2e.mjs`.
 * Echte Stripe-/Datenbank-Logik: `npm test` (tests/stripe.handlers.test.ts, tests/db/stripe.test.ts).
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
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}stripe_${n}.png` });
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
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1200 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}
async function logout() {
  await dismissOnboarding();
  await page.click('[data-testid="user-menu"]');
  await page.click('.menu__item:has-text("Abmelden")');
  await page.waitForURL(/\/login/);
}
/** Seite laden und auf das Ergebnis der Lizenzprüfung warten */
async function open(p) {
  await page.goto(url(p));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}
const EMAIL = 'greta@optik.de';

await page.goto(url(''));
await page.evaluate(() => localStorage.clear());
await page.reload();

// 1) Registrierung und Tarifregel
await safe('Tarifregel', async () => {
  await register({ type: 'business', first: 'Greta', last: 'Glas', email: EMAIL, org: 'Glas & Co' });
  await page.waitForURL(/\/license/);
  await page.waitForSelector('[data-testid="plan-cards"]');
  check('Passender Tarif (Business) hervorgehoben', (await page.getAttribute('[data-testid="plan-business"]', 'data-fits')) === 'true' && (await text('[data-testid="plan-business"]')).includes('Passend zu deinem Konto'));
  check('Private für Betrieb gesperrt', await page.locator('[data-testid="choose-private"]').isDisabled() && (await text('[data-testid="choose-private"]')).includes('Nur für Privatkonten'));
  check('Education für Betrieb gesperrt', await page.locator('[data-testid="choose-education"]').isDisabled() && (await text('[data-testid="choose-education"]')).includes('Nur für Bildungseinrichtungen'));
  check('Buchbar: „Jetzt buchen“', (await text('[data-testid="choose-business"]')).includes('Jetzt buchen') && !(await page.locator('[data-testid="choose-business"]').isDisabled()));
  await shot('01_plans');
});

// 2) Abbruch im Checkout
await safe('Checkout abgebrochen', async () => {
  await mock('setCheckoutOutcome', 'cancel');
  await page.click('[data-testid="choose-business"]');
  await page.click('[data-testid="checkout-continue"]'); // Phase 8: Dialog „Bestellung prüfen“
  await page.waitForURL(/\/pricing\?checkout=cancelled/);
  check('Rücksprung auf /pricing mit Hinweis', await vis('[data-testid="checkout-cancelled"]'));
  check('Kein Abo nach Abbruch', await page.evaluate(() => JSON.parse(localStorage.getItem('olo-mock-cloud')).subscriptions.length === 0));
  await open('dashboard');
  check('Nach Abbruch weiterhin gesperrt', path() === '/license');
});

// 3) Erfolgreicher Checkout: Freischaltung erst durch den Webhook
await safe('Checkout erfolgreich', async () => {
  await mock('setCheckoutOutcome', 'success');
  await mock('setWebhookDelay', 4000);
  await open('license');
  await page.click('[data-testid="choose-business"]');
  await page.click('[data-testid="checkout-continue"]'); // Phase 8: Dialog „Bestellung prüfen“
  await page.waitForURL(/\/license\?checkout=success/);
  check('„Zahlung wird bestätigt …“ solange der Webhook fehlt', await vis('[data-testid="checkout-confirm"][data-phase="waiting"]', 5000) && (await text('[data-testid="checkout-confirm"]')).includes('Zahlung wird bestätigt'));
  check('Success-URL allein schaltet nicht frei', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'pending');
  await shot('03_confirming');
  check('Nach dem Webhook: bestätigt', await vis('[data-testid="checkout-confirm"][data-phase="done"]', 20000));
  check('Lizenz aktiv', await vis('[data-testid="license-status"][data-status="active"]'));
  await shot('03_confirmed');
  await open('dashboard');
  check('Dashboard freigeschaltet', await vis('[data-testid="simulator-tile"]', 15000));
  await dismissOnboarding();
});

// 4) Konto: Abo-Übersicht und Customer Portal
await safe('Abo-Übersicht', async () => {
  await open('account');
  check('Abo-Block sichtbar', await vis('[data-testid="billing-summary"]'));
  check('Tarif Business', (await text('[data-testid="billing-plan"]')) === 'Business-Lizenz – 1 Betriebsstandort');
  check('Lizenzstatus aktiv', (await page.getAttribute('[data-testid="billing-license-status"]', 'data-status')) === 'active');
  check('Abostatus aktiv', (await text('[data-testid="billing-subscription-status"]')) === 'Aktiv');
  check('Nächstes Abrechnungsdatum', /\d{2}\.\d{2}\.\d{4}/.test(await text('[data-testid="billing-next"]')));
  check('Keine Stripe-IDs auf der Kontoseite', !/cus_|sub_|price_/.test(await text('main')));
  await shot('04_account');
  await page.click('[data-testid="manage-subscription"]');
  await page.waitForURL(/mock_portal=cus_mock_/);
  check('„Abonnement verwalten“ öffnet das Portal des eigenen Kunden', true);
  const other = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('olo-mock-cloud')).customers));
  check('Genau ein Stripe-Kunde', other.length === 1, other.join(','));
  await open('pricing');
  check('Pricing: „Dein Tarif“ bei laufendem Abo', (await text('[data-testid="plan-business"]')).includes('Dein Tarif') && (await vis('[data-testid="plan-business"] [data-testid="manage-subscription"]')));
});

// 5) Zahlung fehlgeschlagen → Frist (Zugriff bleibt, klarer Hinweis)
await safe('Zahlungsausfall', async () => {
  await mock('stripeEvent', EMAIL, 'payment_failed');
  await open('dashboard');
  check('In der Frist: Dashboard weiterhin nutzbar', await vis('[data-testid="simulator-tile"]', 15000));
  check('Banner „Zahlung fehlgeschlagen“', await vis('[data-testid="billing-banner"]') && (await text('[data-testid="billing-banner"]')).includes('Zahlungsmittel'));
  await shot('05_grace');
  await open('account');
  check('Konto: Frist mit Datum', await vis('[data-testid="grace-note"]') && /\d{2}\.\d{2}\.\d{4}/.test(await text('[data-testid="billing-grace"]')));
  check('Abostatus „Zahlung fehlgeschlagen“', (await text('[data-testid="billing-subscription-status"]')) === 'Zahlung fehlgeschlagen');
});

// 6) Frist abgelaufen → gesperrt
await safe('Frist abgelaufen', async () => {
  await mock('stripeEvent', EMAIL, 'grace_expired');
  await open('dashboard');
  check('Nach Fristende: kein Simulator', path() === '/license');
  check('Lizenz gesperrt', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'suspended');
  check('Hinweis: Zahlungsmittel aktualisieren', await vis('[data-testid="suspended-note"]') && (await vis('[data-testid="manage-subscription"]')));
  await shot('06_suspended');
});

// 7) Nachzahlung → wieder aktiv
await safe('Nachzahlung', async () => {
  await mock('stripeEvent', EMAIL, 'paid');
  await page.click('[data-testid="license-refresh"]').catch(() => undefined);
  check('Wieder aktiv', await vis('[data-testid="license-status"][data-status="active"]'));
  await open('dashboard');
  check('Dashboard wieder erreichbar, kein Warnbanner', (await vis('[data-testid="simulator-tile"]', 15000)) && (await page.locator('[data-testid="billing-banner"]').count()) === 0);
});

// 8) Kündigung zum Periodenende
await safe('Kündigung', async () => {
  await mock('stripeEvent', EMAIL, 'cancel_at_period_end');
  await open('account');
  check('„Gekündigt – Zugriff bis [Datum]“', /^Gekündigt – Zugriff bis \d{2}\.\d{2}\.\d{4}$/.test(await text('[data-testid="billing-cancel"]')), await text('[data-testid="billing-cancel"]'));
  await open('dashboard');
  check('Bis Periodenende weiterhin Zugriff', await vis('[data-testid="simulator-tile"]', 15000));
  await shot('08_cancelled');
});

// 9) Abo endet tatsächlich
await safe('Abo-Ende', async () => {
  await mock('stripeEvent', EMAIL, 'ended');
  await open('dashboard');
  check('Nach Abo-Ende gesperrt', path() === '/license');
  check('Lizenzstatus cancelled', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'cancelled');
  check('Erneut buchbar', await vis('[data-testid="choose-business"]:not([disabled])'));
  await logout();
});

// 10) Admin: Abo-Spalten, Sonderlizenz, Rückgabe an Stripe
await safe('Admin', async () => {
  await register({ type: 'private', first: 'Hans', last: 'Hornhaut', email: 'hans@privat.de' });
  await page.waitForURL(/\/license/);
  await mock('setRole', 'hans@privat.de', 'super_admin');
  await open('admin');
  check('Admin-Tabelle', await vis('[data-testid="admin-table"]'));
  const head = await text('[data-testid="admin-table"] thead');
  check('Spalten Paket/Lizenzstatus/Abostatus/Customer/Subscription/Periodenende/Kündigung', ['Paket', 'Kundentyp', 'Demo', 'Verträge', 'Lizenzstatus', 'Quelle', 'Abostatus', 'Stripe Customer', 'Subscription', 'Periodenende', 'Kündigung'].every((h) => head.includes(h)), head);
  const row = `[data-testid="admin-row"][data-email="${EMAIL}"]`;
  const r = await text(row);
  check('Zeile Greta: Stripe-Daten', r.includes('cus_mock_') && r.includes('sub_mock_') && r.includes('Beendet') && r.includes('Stripe'), r.slice(0, 200));
  await page.selectOption(`select[aria-label="Lizenzstatus ${EMAIL}"]`, 'active');
  check('Manuelle Freischaltung → Quelle „Manuell“', await vis(`${row} [data-testid="admin-source"]:has-text("Manuell")`));
  await shot('10_admin');
  await page.click(`button[aria-label="An Stripe zurückgeben ${EMAIL}"]`);
  check('Rückgabe an Stripe übernimmt den Abo-Status', await vis(`${row} [data-testid="admin-source"]:has-text("Stripe")`) && (await page.locator(`select[aria-label="Lizenzstatus ${EMAIL}"]`).inputValue()) === 'cancelled');
});

// 11) Responsiv
await safe('Responsiv', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ['license', 'account']) {
    await open(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`/${p} bei 390 px ohne horizontalen Überlauf`, !overflow);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

check('Keine Laufzeitfehler in der Konsole', !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')), logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')).slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} bestanden`);
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
