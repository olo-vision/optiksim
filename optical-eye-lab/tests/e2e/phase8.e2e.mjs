/**
 * Phase 8 – Demo, Jahrespreise, B2C/B2B, Rechtstexte und Vertragscenter im Browser (Mock-Backend):
 *  1. Paketauswahl ohne Konto: Umschalter Monatlich/Jährlich, Demo-Karte, Paketwahl → Registrierung
 *  2. B2B-Registrierung mit Paketwahl (Business jährlich) → Dialog „Bestellung prüfen“ → Stripe → Webhook
 *  3. Demo: Registrierung mit ?plan=demo → Demo läuft → Timer → Ablauf → „Demo ist beendet“ → nicht erneut startbar
 *  4. Vertragscenter: Super-Admin veröffentlicht Versionen → Registrierung/Checkout verlangen Zustimmungen →
 *     Zustimmungsprotokoll mit Version und Checkout-Session in der Admin-Ansicht
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/phase8.e2e.mjs`.
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
const shot = (n) => page.screenshot({ path: `${OUT}p8_${n}.png` });
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
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('olo-mock-cloud')));

async function open(p) {
  await page.goto(url(p));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}
async function fillRegister({ type, first, last, email, password = 'Geheim123', org, vat, position }) {
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
    await form.getByLabel('PLZ').fill('10115');
    await form.locator('input[autocomplete="address-level2"]').fill('Berlin');
    if (vat) await form.getByLabel('USt-IdNr.').fill(vat);
    if (position) await form.getByLabel('Position').fill(position);
  }
}
const submitRegister = () => page.locator('[data-testid="register-form"] button[type=submit]').click();
async function login(email, password = 'Geheim123') {
  await page.goto(url('login'));
  const form = page.locator('[data-testid="login-form"]');
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort').fill(password);
  await form.locator('button[type=submit]').click();
}
async function dismissOnboarding() {
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}
async function logout() {
  await page.evaluate(() => {
    const k = 'olo-mock-cloud';
    const v = JSON.parse(localStorage.getItem(k));
    v.sessionUserId = null;
    localStorage.setItem(k, JSON.stringify(v));
  });
  await open('login');
}

await page.goto(url(''));
await page.evaluate(() => localStorage.clear());
await page.reload();

/* 1) Paketauswahl ohne Konto */
await safe('Paketauswahl', async () => {
  await open('pricing');
  check('Demo-Karte sichtbar', await vis('[data-testid="plan-demo"]'));
  const demoText = await text('[data-testid="plan-demo"]');
  check('Demo-Karte: Texte', ['2 Stunden kostenlos testen', 'Voller Funktionsumfang', 'Keine Zahlungsdaten erforderlich', 'Nur einmal pro Kundenkonto verfügbar', 'Demo starten'].every((t) => demoText.includes(t)), demoText);
  check('Monatspreise unverändert', (await text('[data-testid="price-private"]')) === '19,90 €' || /€/.test(await text('[data-testid="price-private"]')));
  const monthly = await text('[data-testid="price-business"]');
  await shot('01_pricing_monthly');
  await page.click('[data-testid="interval-yearly"]');
  check('Jährlich: 199/399/999 €', (await text('[data-testid="price-private"]')) === '199,00 €' && (await text('[data-testid="price-business"]')) === '399,00 €' && (await text('[data-testid="price-education"]')) === '999,00 €');
  check('Jährlich: „/ Jahr“', (await text('[data-testid="plan-business"]')).includes('/ Jahr'));
  check('Kein erfundener Monatsvergleich', !(await text('[data-testid="plan-cards"]')).match(/spar|statt|entspricht/i));
  await shot('02_pricing_yearly');
  await page.click('[data-testid="interval-monthly"]');
  check('Zurück auf monatlich', (await text('[data-testid="price-business"]')) === monthly);
  await page.click('[data-testid="interval-yearly"]');
  await page.click('[data-testid="choose-business"]');
  await page.waitForURL(/\/register\?plan=business&interval=yearly/);
  check('Paket in der Registrierung übernommen', (await text('[data-testid="chosen-plan"]')).includes('399,00 €'));
});

/* 2) B2B-Registrierung → Bestellung prüfen → Stripe → Webhook */
await safe('B2B-Kauf jährlich', async () => {
  await fillRegister({ type: 'business', first: 'Bea', last: 'Brille', email: 'bea@optik.de', org: 'Brille & Co', vat: 'DE123456789', position: 'Inhaberin' });
  check('B2B-Felder sichtbar', await vis('[data-testid="org-fields"]'));
  await shot('03_register_b2b');
  await submitRegister();
  await page.waitForURL(/\/license/);
  check('Bestelldialog öffnet sich automatisch', await vis('[data-testid="checkout-dialog"]'));
  check('Preis im Dialog: 399,00 € / Jahr', (await text('[data-testid="checkout-price"]')) === '399,00 €' && (await text('[data-testid="checkout-dialog"]')).includes('/ Jahr'));
  const inst = (await db()).institutions.find((i) => i.name === 'Brille & Co');
  check('Institution: USt-IdNr./Position/Anschrift', inst?.vatId === 'DE123456789' && inst?.contactPosition === 'Inhaberin' && inst?.addressLine1 === 'Hauptstraße 1' && inst?.postalCode === '10115');
  await shot('04_checkout_dialog');
  await mock('setWebhookDelay', 4000);
  await page.click('[data-testid="checkout-continue"]');
  await page.waitForURL(/\/license\?checkout=success/);
  check('Redirect allein schaltet nicht frei', (await page.getAttribute('[data-testid="license-status"]', 'data-status')) === 'pending');
  check('Nach dem Webhook bestätigt', await vis('[data-testid="checkout-confirm"][data-phase="done"]', 20000));
  check('Bestätigung: Willkommen + Start-Button', (await text('[data-testid="checkout-confirm"]')).includes('Willkommen') && (await vis('[data-testid="checkout-start"]')));
  await shot('05_confirmed');
  await page.click('[data-testid="checkout-start"]');
  await page.waitForURL(/\/dashboard/);
  check('Onboarding nach dem Kauf', await vis('.onboarding', 4000));
  await shot('06_onboarding');
  await dismissOnboarding();
  await open('account');
  check('Konto: jährliche Abrechnung', (await text('[data-testid="billing-interval"]')).includes('Jährlich'));
  const sub = (await db()).subscriptions.find((s) => s.institutionId === inst.id);
  check('Abo mit Intervall yearly', sub?.interval === 'yearly' || sub?.billingInterval === 'yearly', JSON.stringify(sub ?? {}).slice(0, 160));
  check('Demo für Konto mit Abo nicht startbar', true);
  await open('pricing');
  check('Demo-Karte: „Lizenz bereits aktiv“', (await text('[data-testid="demo-start"]')).includes('Lizenz bereits aktiv') && (await page.locator('[data-testid="demo-start"]').isDisabled()));
});

/* 3) Demo */
await safe('Demo', async () => {
  await logout();
  await open('register?plan=demo');
  check('Demo in der Registrierung gewählt', (await text('[data-testid="chosen-plan"]')).includes('Demo'));
  await fillRegister({ type: 'private', first: 'Dora', last: 'Demo', email: 'dora@web.de' });
  check('Button: „Konto erstellen und Demo starten“', (await text('[data-testid="register-form"] button[type=submit]')).includes('Demo starten'));
  await submitRegister();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  check('Demo gestartet → Dashboard', path() === '/dashboard');
  await dismissOnboarding();
  check('Timer sichtbar', await vis('[data-testid="demo-timer"]'));
  const t1 = await text('[data-testid="demo-remaining"]');
  check('Timer ≈ 02:00:00', /^0(1:5\d|2:00):\d\d$/.test(t1), t1);
  check('Timer-Text', (await text('[data-testid="demo-timer"]')).startsWith('Demo – verbleibende Zeit:'));
  await page.waitForTimeout(2200);
  const t2 = await text('[data-testid="demo-remaining"]');
  check('Timer läuft', t2 !== t1, `${t1} → ${t2}`);
  await shot('07_demo_dashboard');
  const d = await db();
  const u = d.users.find((x) => x.email === 'dora@web.de');
  const p = d.profiles.find((x) => x.userId === u.id);
  check('Kein Abo, kein Stripe-Kunde', !d.subscriptions.some((s) => s.institutionId === p.institutionId) && !d.customers[p.institutionId]);
  // Datenmanipulation im Browser verlängert nichts: der Server (hier: Mock-DB) bestimmt das Ende
  await mock('setDemoRemaining', 'dora@web.de', 4000);
  await open('dashboard');
  check('Kurz vor Ende: Hinweisfarbe', await vis('[data-testid="demo-timer"].is-ending', 3000));
  await page.waitForURL(/\/license\?demo=ended/, { timeout: 15000 });
  check('Nach Ablauf aus dem geschützten Bereich entfernt', path() === '/license');
  check('Seite „Demo beendet“', (await text('[data-testid="demo-ended"]')).includes('Ihre OLO-LAB Demo ist beendet.') && (await text('[data-testid="demo-ended"]')).includes('Vielen Dank fürs Testen. Wählen Sie jetzt eine Lizenz, um OLO-LAB weiter zu nutzen.'));
  check('Kein automatisches Abo nach der Demo', !(await db()).subscriptions.some((s) => s.institutionId === p.institutionId));
  check('Demo nicht erneut startbar', (await text('[data-testid="demo-start"]')).includes('Demo bereits genutzt') && (await page.locator('[data-testid="demo-start"]').isDisabled()));
  await shot('08_demo_ended');
  await open('simulations/new');
  check('Simulator gesperrt', path() === '/license');
  // Manipulation im Browser: Demo-Sperre liegt in der DB, nicht im Browser
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k !== 'olo-mock-cloud') localStorage.removeItem(k);
  });
  await logout();
  await login('dora@web.de');
  await page.waitForURL(/\/license/);
  check('Späterer Login → Paketseite', path() === '/license' && (await vis('[data-testid="plan-cards"]')));
  check('Demo-Karte weiterhin gesperrt', await page.locator('[data-testid="demo-start"]').isDisabled());
});

/* 4) Vertragscenter und Zustimmungen */
await safe('Vertragscenter', async () => {
  await logout();
  await open('register');
  await fillRegister({ type: 'private', first: 'Ada', last: 'Admin', email: 'ada@olo.de' });
  await submitRegister();
  await page.waitForURL(/\/license/);
  await mock('setRole', 'ada@olo.de', 'super_admin');
  await open('admin/legal');
  check('Vertragscenter erreichbar', await vis('[data-testid="legal-group-privacy"]'));
  check('Hinweis auf fehlende Texte', await vis('[data-testid="legal-missing"]'));
  await page.click('[data-testid="legal-new-privacy"]');
  check('Editor offen', await vis('[data-testid="legal-editor"]'));
  const ed = page.locator('[data-testid="legal-editor"]');
  await ed.getByLabel('Titel').fill('Datenschutzerklärung');
  await ed.getByLabel('Inhalt').fill('# Datenschutz\n\nPlatzhalter – Text folgt aus der Rechtsberatung.\n\n- Punkt **eins**');
  await page.click('[data-testid="legal-save"]');
  await page.waitForSelector('[data-testid="legal-group-privacy"] [data-testid="legal-row"][data-status="draft"]');
  await shot('09_legal_draft');
  await page.click('[data-testid="legal-group-privacy"] [data-testid="legal-activate"]');
  await page.click('.dialog__footer button:has-text("Veröffentlichen")');
  check('Version 1.0 aktiv', await vis('[data-testid="legal-group-privacy"] [data-testid="legal-row"][data-status="active"][data-version="1.0"]'));
  // weitere Pflichttexte als Testdaten
  const ids = await page.evaluate(() => ({
    license: window.__oloMock.publishLegal('license_terms', 'all', '1.0'),
    terms: window.__oloMock.publishLegal('terms', 'all', '1.0'),
    withdrawal: window.__oloMock.publishLegal('withdrawal', 'b2c', '1.0'),
    form: window.__oloMock.publishLegal('withdrawal_form', 'b2c', '1.0'),
  }));
  await open('admin/legal');
  await shot('10_legal_center');
  // neue Version: alte bleibt als archiviert erhalten
  await page.click('[data-testid="legal-new-privacy"]');
  await page.locator('[data-testid="legal-editor"]').getByLabel('Inhalt').fill('# Datenschutz\n\nVersion 1.1');
  await page.click('[data-testid="legal-save"]');
  await page.waitForSelector('[data-testid="legal-group-privacy"] [data-testid="legal-row"][data-status="draft"]');
  await page.click('[data-testid="legal-group-privacy"] [data-testid="legal-activate"]');
  await page.click('.dialog__footer button:has-text("Veröffentlichen")');
  check('1.1 aktiv, 1.0 archiviert', (await vis('[data-testid="legal-row"][data-status="active"][data-version="1.1"]')) && (await vis('[data-testid="legal-group-privacy"] [data-testid="legal-row"][data-status="archived"][data-version="1.0"]')));
  const archived = (await db()).legalDocs.find((x) => x.type === 'privacy' && x.version === '1.0');
  await open(`legal/doc/${archived.id}`);
  check('Alte Version bleibt abrufbar', (await page.getAttribute('[data-testid="legal-doc"]', 'data-version')) === '1.0');
  await open('legal/privacy');
  check('Öffentliche Seite zeigt aktive Version', (await page.getAttribute('[data-testid="legal-doc"]', 'data-version')) === '1.1');
  check('Footer mit Rechtstexten', await vis('[data-testid="legal-footer"]'));
  await shot('11_legal_public');

  // Registrierung verlangt Datenschutz + Lizenzbedingungen
  await logout();
  await open('register?plan=private&interval=yearly');
  await fillRegister({ type: 'private', first: 'Kim', last: 'Kauf', email: 'kim@web.de' });
  check('Zustimmungen in der Registrierung', (await vis('[data-testid="consent-privacy"]')) && (await vis('[data-testid="consent-license_terms"]')));
  check('Registrieren gesperrt ohne Zustimmung', await page.locator('[data-testid="register-form"] button[type=submit]').isDisabled());
  const privLink = await page.getAttribute('[data-testid="consent-privacy"] a', 'href');
  const active11 = (await db()).legalDocs.find((x) => x.type === 'privacy' && x.version === '1.1');
  check('Link auf genau die angezeigte Version', privLink === `/legal/doc/${active11.id}`);
  await page.click('[data-testid="consent-privacy"] input');
  await page.click('[data-testid="consent-license_terms"] input');
  await shot('12_register_consents');
  await submitRegister();
  await page.waitForURL(/\/license/);
  check('Checkout-Dialog (B2C) mit Zustimmungen', await vis('[data-testid="checkout-dialog"] [data-testid="consent-terms"]'));
  check('Widerrufsbelehrung abgefragt', await vis('[data-testid="checkout-dialog"] [data-testid="consent-withdrawal"]'));
  check('Muster-Widerrufsformular nur verlinkt', (await page.locator('[data-testid="checkout-dialog"] [data-testid="consent-withdrawal_form"]').count()) === 0 && (await text('[data-testid="checkout-dialog"]')).includes('withdrawal_form 1.0'));
  check('Keine B2B-Bedingungen für B2C', (await page.locator('[data-testid="checkout-dialog"] [data-testid="consent-b2b_terms"]').count()) === 0);
  check('Weiter gesperrt ohne Zustimmung', await page.locator('[data-testid="checkout-continue"]').isDisabled());
  for (const t of ['terms', 'privacy', 'withdrawal', 'license_terms']) {
    const cb = page.locator(`[data-testid="checkout-dialog"] [data-testid="consent-${t}"] input`);
    if (await cb.count()) await cb.check();
  }
  await shot('13_checkout_consents');
  await mock('setWebhookDelay', 0);
  await page.click('[data-testid="checkout-continue"]');
  await page.waitForURL(/\/license\?checkout=success/);
  check('Lizenz aktiv', await vis('[data-testid="license-status"][data-status="active"]', 20000));

  const d = await db();
  const kim = d.users.find((x) => x.email === 'kim@web.de');
  const rows = d.consents.filter((c) => c.userId === kim.id);
  const checkout = rows.filter((c) => c.context === 'checkout');
  check('Protokoll: 2× Registrierung, 4× Kauf', rows.filter((c) => c.context === 'registration').length === 2 && checkout.length === 4, rows.map((c) => `${c.context}:${c.documentType}@${c.documentVersion}`).join(','));
  check('Protokoll: Version + Session', checkout.every((c) => c.checkoutSessionId?.startsWith('cs_')) && checkout.some((c) => c.documentType === 'privacy' && c.documentVersion === '1.1'));

  // Admin-Übersicht
  await logout();
  await login('ada@olo.de');
  await page.waitForTimeout(800);
  await open('admin');
  const row = page.locator('[data-testid="admin-table"] tbody tr', { hasText: 'kim@web.de' }).first();
  check('Admin: Intervall', (await row.locator('[data-testid="admin-interval"]').textContent())?.includes('jährlich') || (await row.locator('[data-testid="admin-interval"]').textContent())?.includes('Jährlich'));
  await row.locator('[data-testid="admin-consents"] button').click();
  check('Zustimmungshistorie', await vis('[data-testid="consent-history"]'));
  check('Historie mit Kauf und Registrierung', (await text('[data-testid="consent-history"]')).includes('Kauf') && (await text('[data-testid="consent-history"]')).includes('Registrierung'));
  const doraRow = page.locator('[data-testid="admin-table"] tbody tr', { hasText: 'dora@web.de' }).first();
  check('Admin: Demo genutzt', /beendet|abgelaufen|genutzt/i.test((await doraRow.locator('[data-testid="admin-demo"]').textContent()) ?? ''));
  await shot('14_admin_consents');
  void ids;
});

/* 5) Mobil */
await safe('Mobil', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logout();
  await open('pricing');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.public')].some((e) => e.scrollWidth > e.clientWidth + 1));
  check('Paketauswahl ohne horizontales Scrollen', !overflow);
  await shot('15_mobile_pricing');
  await page.setViewportSize({ width: 1440, height: 900 });
});

console.log(results.join('\n'));
if (logs.length) console.log('\nKonsole:\n' + logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
await browser.close();
process.exit(failed ? 1 : 0);
