/**
 * Rechtsbetrieb im Browser (Mock-Backend):
 *  1. Fußzeile: Impressum, Rechtstexte, „Verträge hier kündigen“, „Vertrag widerrufen“ – ohne Anmeldung
 *  2. Impressum (/impressum) mit Zeilenumbrüchen
 *  3. Preise inkl. 19 % USt.; private Jahreslizenz „endet automatisch“; Hinweis zum Stripe-Button
 *  4. B2B mit Sitz außerhalb Deutschlands: Hinweis, Kauf gesperrt
 *  5. Kauf Private jährlich → Vertragsbestätigung, Konto zeigt „keine automatische Verlängerung“
 *  6. Kündigungsbutton (zweistufig, ohne Login) → automatisch zum Periodenende, Eingangsbestätigung
 *  7. Widerrufsbutton → Eingangsbestätigung; Admin: Kündigungen & Widerrufe, „erledigt“
 *  8. Vertragscenter: Entwurf mit [Prüfhinweis] ist markiert; Veröffentlichen nur nach Warn-Dialog (Super-Admin)
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/legal.e2e.mjs`.
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
const shot = (n) => page.screenshot({ path: `${OUT}legal_${n}.png` });
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
async function register({ type, first, last, email, org, country }) {
  await page.click(`[data-testid="type-${type}"]`);
  const form = page.locator('[data-testid="register-form"]');
  await form.getByLabel('Vorname', { exact: true }).fill(first);
  await form.getByLabel('Nachname', { exact: true }).fill(last);
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort', { exact: true }).fill('Geheim123');
  await form.getByLabel('Passwort bestätigen').fill('Geheim123');
  if (org) {
    await form.getByLabel(type === 'business' ? 'Firmenname' : 'Name der Schule / Bildungseinrichtung').fill(org);
    await form.getByLabel('Straße und Hausnummer').fill('Ring 1');
    await form.getByLabel('PLZ').fill('1010');
    await form.locator('input[autocomplete="address-level2"]').fill('Wien');
    if (country) await form.getByLabel('Land').selectOption(country);
  }
  for (const cb of await page.locator('[data-testid="legal-consents"] input[type=checkbox]').all()) await cb.check();
}
const submitRegister = () => page.locator('[data-testid="register-form"] button[type=submit]').click();
async function logout() {
  await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('olo-mock-cloud'));
    v.sessionUserId = null;
    localStorage.setItem('olo-mock-cloud', JSON.stringify(v));
  });
  await open('login');
}
async function login(email) {
  await page.goto(url('login'));
  const form = page.locator('[data-testid="login-form"]');
  await form.getByLabel('E-Mail').fill(email);
  await form.getByLabel('Passwort').fill('Geheim123');
  await form.locator('button[type=submit]').click();
}
async function dismissOnboarding() {
  const shown = await page.locator('.onboarding').first().waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
  if (shown) await page.click('.dialog__footer button:has-text("Überspringen")');
}

await page.goto(url(''));
await page.evaluate(() => localStorage.clear());
await page.reload();

/* 1 + 2) Fußzeile und Impressum */
await safe('Fußzeile & Impressum', async () => {
  await open('pricing');
  check('Kündigen/Widerrufen in der Fußzeile (ohne veröffentlichte Texte)', (await vis('[data-testid="footer-cancel"]')) && (await vis('[data-testid="footer-withdraw"]')));
  await open('impressum');
  check('Impressum: noch nicht veröffentlicht', (await text('.public__main')).includes('Noch nicht veröffentlicht'));
  await mock('publishLegal', 'imprint', 'all', '1.0', null, '## Anbieter\n\n**OLO Vision**\nInhaber: Jonas Karol Lingener\nForsthausstraße 14\n66709 Weiskirchen');
  await open('pricing');
  await page.click('[data-testid="legal-footer"] a:has-text("Impressum")');
  await page.waitForURL(/\/impressum/);
  check('Impressum über die Fußzeile', await vis('[data-testid="legal-doc"]'));
  check('Anschrift mit Zeilenumbrüchen', (await page.locator('.legal-md p br').count()) >= 3);
  await shot('01_impressum');
});

/* 3) Preise */
await safe('Preisanzeige', async () => {
  await open('pricing');
  check('„inkl. 19 % USt.“ an jedem Paket', (await page.locator('.plan-card__billing:has-text("inkl. 19 % USt.")').count()) >= 3);
  await page.click('[data-testid="interval-yearly"]');
  check('Private jährlich: „/ 12 Monate“, endet automatisch', (await text('[data-testid="plan-private"]')).includes('/ 12 Monate') && (await text('[data-testid="term-private"]')).includes('endet automatisch'));
  check('Business jährlich verlängert sich', (await text('[data-testid="term-business"]')).includes('verlängert sich jährlich'));
  await shot('02_pricing_yearly');
});

/* 4) B2B außerhalb Deutschlands */
await safe('B2B nur Deutschland', async () => {
  await open('register');
  await register({ type: 'business', first: 'Franz', last: 'Ferne', email: 'franz@optik.at', org: 'Optik Wien', country: 'AT' });
  check('Hinweis bei Land ≠ DE', await vis('[data-testid="register-country-note"]'));
  await submitRegister();
  await page.waitForURL(/\/license/);
  await page.click('[data-testid="choose-business"]');
  check('Kaufdialog: Hinweis + gesperrt', (await vis('[data-testid="checkout-country"]')) && (await page.locator('[data-testid="checkout-continue"]').isDisabled()));
  await shot('03_b2b_country');
  await page.keyboard.press('Escape');
});

/* 5) Kauf Private jährlich */
await safe('Kauf Private jährlich', async () => {
  await logout();
  await open('register?plan=private&interval=yearly');
  await register({ type: 'private', first: 'Karla', last: 'Kunde', email: 'karla@web.de' });
  await submitRegister();
  await page.waitForURL(/\/license/);
  check('Dialog: Laufzeit „endet automatisch“', (await vis('[data-testid="checkout-dialog"]')) && (await text('[data-testid="checkout-term"]')).includes('endet danach automatisch'));
  check('Dialog: Hinweis auf „Abonnieren“ bei Stripe', (await text('[data-testid="checkout-order-note"]')).includes('zahlungspflichtig bestellt ist erst mit dem Klick auf „Abonnieren“'));
  check('Dialog: Endpreis inkl. 19 % USt.', (await text('[data-testid="checkout-dialog"]')).includes('inkl. 19 % USt.'));
  await shot('04_checkout_private_yearly');
  await mock('setWebhookDelay', 0);
  await page.click('[data-testid="checkout-continue"]');
  await page.waitForURL(/\/license\?checkout=success/);
  check('Lizenz aktiv', await vis('[data-testid="license-status"][data-status="active"]', 20000));
  const d = await db();
  const sub = d.subscriptions.at(-1);
  check('Abo endet automatisch (keine Verlängerung)', sub.plan === 'private' && sub.interval === 'yearly' && sub.cancelAtPeriodEnd === true);
  check('Vertragsbestätigung versendet', d.mails.some((m) => m.kind === 'contract_confirmation' && m.to === 'karla@web.de'));
  await open('account');
  await dismissOnboarding();
  check('Konto: „keine automatische Verlängerung“ statt „Gekündigt“', (await text('[data-testid="billing-term-end"]')).includes('keine automatische Verlängerung') && !(await vis('[data-testid="billing-cancel"]', 500)));
  check('Konto: Link „Verträge hier kündigen“', await vis('[data-testid="account-legal"] [data-testid="footer-cancel"]'));
  await shot('05_account_private_yearly');
});

/* 6) Kündigungsbutton */
await safe('Kündigungsbutton', async () => {
  // Monatsabo anlegen (zweites Konto)
  await logout();
  await open('register?plan=private&interval=monthly');
  await register({ type: 'private', first: 'Moni', last: 'Monat', email: 'moni@web.de' });
  await submitRegister();
  await page.waitForURL(/\/license/);
  await page.click('[data-testid="checkout-continue"]');
  await page.waitForURL(/\/license\?checkout=success/);
  await vis('[data-testid="license-status"][data-status="active"]', 20000);
  await logout();

  await open('kuendigen');
  check('Seite ohne Anmeldung erreichbar', path() === '/kuendigen' && (await vis('[data-testid="declaration-form"]')));
  await shot('06_cancel_form');
  await page.click('[data-testid="declaration-next"]');
  check('Pflichtfelder werden geprüft', (await page.locator('.ds-field__error').count()) >= 2);
  const form = page.locator('[data-testid="declaration-form"]');
  await form.getByLabel('Vor- und Nachname').fill('Moni Monat');
  await form.getByLabel('E-Mail-Adresse Ihres Kundenkontos').fill('MONI@web.de');
  await form.getByPlaceholder('z. B. Private monatlich').fill('Private monatlich');
  await page.click('[data-testid="declaration-next"]');
  check('Bestätigungsseite mit Zusammenfassung', (await vis('[data-testid="declaration-confirm"]')) && (await text('[data-testid="declaration-summary"]')).includes('Ordentliche Kündigung zum nächstmöglichen Zeitpunkt'));
  check('Button „Jetzt kündigen“', (await text('[data-testid="declaration-submit"]')) === 'Jetzt kündigen');
  await shot('07_cancel_confirm');
  await page.click('[data-testid="declaration-submit"]');
  check('Eingangsbestätigung mit Datum und Uhrzeit', (await vis('[data-testid="declaration-done"]')) && /Eingegangen am \d+\. \S+ \d{4} um \d{2}:\d{2}:\d{2} Uhr|Eingegangen am \d+\. \S+ \d{4}, \d{2}:\d{2}:\d{2} Uhr/.test(await text('[data-testid="declaration-received"]')), await text('[data-testid="declaration-received"]'));
  await shot('08_cancel_done');
  const d = await db();
  const u = d.profiles.find((p) => p.email === 'moni@web.de');
  const sub = d.subscriptions.find((s) => s.institutionId === u.institutionId);
  check('Abo zum Periodenende gekündigt', sub.cancelAtPeriodEnd === true);
  check('Bestätigung an die Konto-Adresse + Hinweis an OLO Vision', d.mails.some((m) => m.kind === 'cancellation_confirmation' && m.to === 'moni@web.de') && d.mails.some((m) => m.kind === 'declaration_notice' && m.to === 'info@olo-vision.de'));
  // unbekannte Adresse → gleiche Seite
  await open('kuendigen');
  const f2 = page.locator('[data-testid="declaration-form"]');
  await f2.getByLabel('Vor- und Nachname').fill('Niemand');
  await f2.getByLabel('E-Mail-Adresse Ihres Kundenkontos').fill('niemand@example.org');
  await page.click('[data-testid="declaration-next"]');
  await page.click('[data-testid="declaration-submit"]');
  check('Unbekannte Adresse: gleiche Eingangsbestätigung (kein Hinweis auf Konto)', (await vis('[data-testid="declaration-done"]')) && !(await text('[data-testid="declaration-done"]')).match(/kein Konto|nicht gefunden/i));
});

/* 7) Widerruf + Admin */
await safe('Widerrufsbutton & Admin', async () => {
  await open('widerrufen');
  const form = page.locator('[data-testid="declaration-form"]');
  await form.getByLabel('Vor- und Nachname').fill('Karla Kunde');
  await form.getByLabel('E-Mail-Adresse Ihres Kundenkontos').fill('karla@web.de');
  await page.click('[data-testid="declaration-next"]');
  check('Button „Widerruf bestätigen“', (await text('[data-testid="declaration-submit"]')) === 'Widerruf bestätigen');
  await page.click('[data-testid="declaration-submit"]');
  check('Widerruf eingegangen', (await text('[data-testid="declaration-done"]')).includes('Ihr Widerruf ist eingegangen'));
  check('Widerrufsbestätigung versendet', (await db()).mails.some((m) => m.kind === 'withdrawal_confirmation' && m.to === 'karla@web.de'));

  await login('karla@web.de');
  await page.waitForTimeout(800);
  await mock('setRole', 'karla@web.de', 'super_admin');
  await open('admin/declarations');
  check('Admin-Reiter „Kündigungen & Widerrufe“', await vis('[data-testid="declarations-table"]'));
  check('3 Erklärungen', (await page.locator('[data-testid="declaration-row"]').count()) === 3);
  check('Kündigung automatisch verarbeitet', await vis('[data-testid="declaration-row"][data-kind="cancellation"][data-status="processed"]'));
  check('Widerruf zu bearbeiten', await vis('[data-testid="declaration-row"][data-kind="withdrawal"][data-status="needs_review"]'));
  await shot('09_admin_declarations');
  await page.click('[data-testid="declaration-row"][data-kind="withdrawal"] [data-testid="declaration-done-btn"]');
  check('Als erledigt markiert', await vis('[data-testid="declaration-row"][data-kind="withdrawal"][data-status="done"]'));
});

/* 8) Vertragscenter: Prüfhinweise */
await safe('Prüfhinweise', async () => {
  await open('admin/legal');
  check('Impressum-Gruppe vorhanden', await vis('[data-testid="legal-group-imprint"]'));
  await page.click('[data-testid="legal-new-terms"]');
  const ed = page.locator('[data-testid="legal-editor"]');
  await ed.getByLabel('Titel').fill('Allgemeine Geschäftsbedingungen');
  await ed.getByLabel('Inhalt').fill('## 1. Geltung\n\nText.\n\n[Prüfhinweis: Bestellbutton prüfen lassen.]');
  await page.click('.legal-editor__tabs button:has-text("Vorschau")');
  check('Vorschau hebt Prüfhinweis hervor', await vis('[data-testid="legal-editor"] [data-testid="review-marker"]'));
  await page.click('[data-testid="legal-preview-customer"]');
  check('Kundenansicht im Editor ohne Prüfhinweis', (await vis('[data-testid="legal-customer-view"]')) && !(await text('[data-testid="legal-customer-view"] .legal-md')).includes('Prüfhinweis') && (await text('[data-testid="legal-customer-view"] .legal-md')).includes('Text.'));
  await page.click('[data-testid="legal-save"]');
  await page.waitForSelector('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="draft"]');
  check('Entwurf zeigt „1 Prüfhinweis“', (await text('[data-testid="legal-group-terms"] [data-testid="legal-review-count"]')) === '1 Prüfhinweis');
  await shot('10_legal_review_marker');
  // Prüfhinweis blockiert nicht mehr hart: deutlicher Warn-Dialog, „Abbrechen“ lässt den Entwurf unverändert
  await page.click('[data-testid="legal-group-terms"] [data-testid="legal-activate"]');
  check('Warn-Dialog bei Prüfhinweisen', await vis('[data-testid="legal-override-dialog"]:has-text("Dieses Dokument enthält noch einen Prüfhinweis. Möchten Sie es trotzdem veröffentlichen?")'));
  check('Dialog: „Abbrechen“ und „Trotzdem veröffentlichen“', (await vis('.dialog__footer button:has-text("Abbrechen")')) && (await vis('.dialog__footer button:has-text("Trotzdem veröffentlichen")')));
  await shot('10b_legal_review_override');
  await page.click('.dialog__footer button:has-text("Abbrechen")');
  await page.waitForTimeout(300);
  check('Abbrechen: bleibt Entwurf', (await vis('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="draft"]')) && !(await vis('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="active"]', 500)));
  // Server lehnt ohne ausdrückliche Bestätigung ab (nicht nur die Oberfläche)
  const serverCode = await mock('tryLegalActivate', 'terms');
  check('Server: ohne Bestätigung OLR01', serverCode === 'OLR01', serverCode);
  // andere Rollen dürfen die Warnung nicht übergehen – auch nicht mit Bestätigung
  for (const role of ['institution_admin', 'user']) {
    await mock('setRole', 'karla@web.de', role);
    const c = await mock('tryLegalActivate', 'terms', true);
    check(`Rolle ${role}: Übergehen verweigert`, c === '42501', c);
  }
  await mock('setRole', 'karla@web.de', 'super_admin');
  await page.click('[data-testid="legal-group-terms"] [data-testid="legal-activate"]');
  await page.click('.dialog__footer button:has-text("Trotzdem veröffentlichen")');
  await page.waitForSelector('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="active"]');
  check('Trotz Prüfhinweis veröffentlicht', true);
  check('Vertragscenter zeigt Prüfhinweis der veröffentlichten Fassung weiter an', await vis('[data-testid="legal-group-terms"] [data-testid="legal-review-count-published"]'));
  // öffentliche Seite: kein Prüfhinweis (Original bleibt intern gespeichert)
  const pub = (await db()).legalDocs.find((d) => d.type === 'terms' && d.status === 'active');
  check('Intern gespeichert: Original mit Prüfhinweis', pub.content.includes('[Prüfhinweis'));
  await logout();
  await open(`legal/doc/${encodeURIComponent(pub.id)}`);
  await page.waitForSelector('[data-testid="legal-doc"]');
  const pubText = await text('[data-testid="legal-doc"]');
  check('Öffentliche AGB-Seite ohne Prüfhinweis', !pubText.includes('Prüfhinweis') && !pubText.includes('Bestellbutton prüfen') && pubText.includes('Text.'), pubText.slice(0, 120));
  check('Öffentliche Seite: keine Markierungs-Hervorhebung', !(await vis('[data-testid="review-marker"]', 500)));
  await shot('10c_public_without_review');
  await login('karla@web.de');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await open('admin/legal');
  // ohne Prüfhinweis: unverändert normaler Bestätigungsdialog
  await page.click('[data-testid="legal-new-terms"]');
  const ed2 = page.locator('[data-testid="legal-editor"]');
  await ed2.getByLabel('Titel').fill('Allgemeine Geschäftsbedingungen');
  await ed2.getByLabel('Inhalt').fill('## 1. Geltung\n\nGeklärter Text.');
  await page.click('[data-testid="legal-save"]');
  await page.waitForSelector('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="draft"]');
  await page.click('[data-testid="legal-group-terms"] [data-testid="legal-activate"]');
  check('Ohne Prüfhinweis: normaler Dialog, keine Warnung', (await vis('.dialog__footer button:has-text("Veröffentlichen")')) && !(await vis('[data-testid="legal-override-dialog"]', 500)));
  await page.click('.dialog__footer button:has-text("Veröffentlichen")');
  await page.waitForFunction(() => !document.querySelector('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="draft"]'));
  check('Ohne Prüfhinweis veröffentlicht, Vorversion archiviert', (await page.locator('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="active"]').count()) === 1 && (await vis('[data-testid="legal-group-terms"] [data-testid="legal-row"][data-status="archived"]')));
});

/* Mobil */
await safe('Mobil', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logout();
  await open('kuendigen');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.public')].some((e) => e.scrollWidth > e.clientWidth + 1));
  check('Kündigungsseite ohne horizontales Scrollen', !overflow);
  await shot('11_mobile_cancel');
  await page.setViewportSize({ width: 1440, height: 900 });
});

console.log(results.join('\n'));
if (logs.length) console.log('\nKonsole:\n' + logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
await browser.close();
process.exit(failed ? 1 : 0);
