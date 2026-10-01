/**
 * Registrierung und übrige Auth-/öffentliche Seiten auf Smartphone, Tablet und Desktop (Mock-Backend, Port 5174).
 *
 * Je Viewport und Seite:
 *  - kein horizontaler Überlauf (Dokument und jedes sichtbare Element des Formulars)
 *  - nichts liegt oberhalb des Dokumentanfangs (früher: zentriertes, zu hohes Formular → Kopf unerreichbar)
 *  - jedes Feld, jede Checkbox, der Absende-Button und die Fußzeilen-Links lassen sich in den sichtbaren Bereich
 *    scrollen und sind dort nicht verdeckt (elementFromPoint)
 *  - Seite scrollt über das Dokument (kein fester Vollbild-Container), Touch: Eingabeschrift ≥ 16 px (kein iOS-Zoom)
 * Zusätzlich: Tastatur-Simulation (Viewport-Höhe schrumpft), vollständige Registrierung auf iPhone-Größe.
 *
 * Aufruf: `npm run dev:e2e-cloud` (Port 5174), dann `node tests/e2e/responsive-auth.e2e.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.E2E_CLOUD_URL ?? 'http://127.0.0.1:5174/').replace(/\/?$/, '/');
const url = (p) => new URL(p.replace(/^\//, ''), BASE).href;
const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const logs = [];

const VIEWPORTS = [
  { name: 'iphone-se', width: 320, height: 568, mobile: true },
  { name: 'android-small', width: 360, height: 640, mobile: true },
  { name: 'iphone', width: 390, height: 844, mobile: true },
  { name: 'iphone-max', width: 430, height: 932, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
  { name: 'ipad-portrait', width: 768, height: 1024, mobile: true },
  { name: 'ipad-air-portrait', width: 820, height: 1180, mobile: true },
  { name: 'ipad-landscape', width: 1024, height: 768, mobile: true },
  { name: 'ipad-air-landscape', width: 1180, height: 820, mobile: true },
  { name: 'ipad-pro-landscape', width: 1366, height: 1024, mobile: true },
  { name: 'laptop', width: 1366, height: 768, mobile: false },
  { name: 'desktop', width: 1920, height: 1080, mobile: false },
];

/** Prüft Layout und Erreichbarkeit der Elemente einer Seite */
async function audit(page, vp, label, selectors) {
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const root = document.querySelector('.login__card, .public__main');
    const outside = [];
    const above = [];
    for (const el of root ? root.querySelectorAll('*') : []) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('select') || (el.matches('input[type=radio], input[type=checkbox]') && getComputedStyle(el).opacity === '0')) continue;
      // bewusst unsichtbare Felder (Honeypot gegen Bots) zählen nicht
      if (el.closest('[aria-hidden="true"], .declaration__hp')) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) outside.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.left)}–${Math.round(r.right)}`);
      if (r.top + window.scrollY < -0.5) above.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.top + window.scrollY)}`);
    }
    const layout = document.querySelector('.login, .public');
    const fonts = [...document.querySelectorAll('.login input:not([type=checkbox]):not([type=radio]), .login select, .public input:not([type=checkbox]):not([type=radio]), .public select')]
      .filter((i) => i.getBoundingClientRect().width > 0 && !i.closest('[aria-hidden="true"], .declaration__hp'))
      .map((i) => parseFloat(getComputedStyle(i).fontSize));
    return {
      hOverflow: document.documentElement.scrollWidth - window.innerWidth,
      outside: outside.slice(0, 4),
      above: above.slice(0, 4),
      docScroll: document.documentElement.classList.contains('doc-scroll') && getComputedStyle(layout).position !== 'fixed',
      minFont: fonts.length ? Math.min(...fonts) : 99,
      coarse: matchMedia('(pointer: coarse)').matches,
    };
  });
  check(`${vp.name} ${label}: kein horizontaler Überlauf`, res.hOverflow <= 1 && !res.outside.length, res.outside.join(', ') || (res.hOverflow > 1 ? `+${res.hOverflow}px` : ''));
  check(`${vp.name} ${label}: nichts oberhalb des Seitenanfangs`, !res.above.length, res.above.join(', '));
  check(`${vp.name} ${label}: Dokument scrollt (kein fester Container)`, res.docScroll);
  if (res.coarse) check(`${vp.name} ${label}: Eingabeschrift ≥ 16 px (kein iOS-Zoom)`, res.minFont >= 16, String(res.minFont));
  const missing = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) {
      missing.push(`${sel} fehlt`);
      continue;
    }
    await loc.scrollIntoViewIfNeeded();
    const ok = await loc.evaluate((el) => {
      const target = el.matches('input[type=checkbox], input[type=radio]') ? el.closest('label') ?? el : el;
      const r = target.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > window.innerHeight + 0.5 || r.right > vw + 0.5) return `außerhalb ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`;
      const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
      return hit && (target.contains(hit) || hit.contains(target) || target.closest('label')?.contains(hit)) ? '' : `verdeckt von ${hit?.tagName.toLowerCase()}.${String(hit?.className).split(' ')[0]}`;
    });
    if (ok) missing.push(`${sel}: ${ok}`);
  }
  check(`${vp.name} ${label}: alle Felder/Buttons/Links erreichbar und sichtbar`, !missing.length, missing.slice(0, 3).join(' | '));
}

const REG_COMMON = ['.auth-card__head h2', '[data-testid="type-private"]', '[data-testid="type-business"]', '[data-testid="type-education"]', 'input[autocomplete="given-name"]', 'input[autocomplete="family-name"]', 'input[type=email]', 'input[autocomplete="new-password"] >> nth=0', 'input[autocomplete="new-password"] >> nth=1', '[data-testid="legal-consents"] input[type=checkbox]', '[data-testid="register-form"] button[type=submit]', '.auth-card__foot a', '[data-testid="footer-cancel"]', '[data-testid="footer-withdraw"]'];
const REG_B2B = ['input[autocomplete="organization"]', 'input[autocomplete="organization-title"]', 'input[autocomplete="address-line1"]', 'input[autocomplete="postal-code"]', 'input[autocomplete="address-level2"]', 'select[autocomplete="country"]', 'input[placeholder="z. B. DE123456789"]'];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => logs.push(`[${vp.name}] ${e.message}`));
  try {
    await page.goto(url(''));
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify({ quality: 'performance', onboardingDone: true }));
    });
    await page.reload();
    // veröffentlichte Rechtstexte → Zustimmungs-Checkboxen erscheinen bei der Registrierung
    await page.evaluate(() => {
      const m = window.__oloMock;
      m.publishLegal('privacy', 'all', '1.0', 'Ich habe die {link} zur Kenntnis genommen.');
      m.publishLegal('license_terms', 'all', '1.0', 'Ich akzeptiere die {link}.');
      m.publishLegal('imprint', 'all', '1.0', null, '# Impressum\n\nOLO Vision');
    });
    // Registrierung – alle drei Kontotypen
    await page.goto(url('register'));
    await page.waitForSelector('[data-testid="register-form"]');
    for (const type of ['private', 'business', 'education']) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(`[data-testid="type-${type}"]`).click();
      await page.waitForTimeout(150);
      await audit(page, vp, `Registrierung (${type})`, type === 'private' ? REG_COMMON : [...REG_COMMON, ...REG_B2B]);
      if (type === 'business' && ['iphone', 'ipad-portrait', 'ipad-air-landscape', 'laptop'].includes(vp.name)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${OUT}resp_auth_${vp.name}_register.png`, fullPage: true });
      }
    }
    // Tastatur simulieren: letztes Feld fokussieren, sichtbare Höhe schrumpft (~45 %)
    if (vp.mobile) {
      const field = page.locator('input[autocomplete="new-password"]').nth(1);
      await field.scrollIntoViewIfNeeded();
      await field.focus();
      await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
      await page.waitForTimeout(400);
      const vis = await field.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      check(`${vp.name} Tastatur: aktives Feld bleibt sichtbar`, vis);
      const submit = page.locator('[data-testid="register-form"] button[type=submit]');
      await submit.scrollIntoViewIfNeeded();
      const subVis = await submit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === el;
      });
      check(`${vp.name} Tastatur: „Konto erstellen“ weiter erreichbar`, subVis);
      await page.setViewportSize({ width: vp.width, height: vp.height });
    }
    // weitere Auth-Seiten (gleiche Layout-Komponente)
    for (const [path, label, sels] of [
      ['login', 'Anmeldung', ['[data-testid="login-form"] input[type=email]', '[data-testid="login-form"] input[type=password]', '[data-testid="login-form"] button[type=submit]', '[data-testid="footer-cancel"]']],
      ['forgot-password', 'Passwort vergessen', ['input[type=email]', 'button[type=submit]', '[data-testid="footer-cancel"]']],
      ['reset-password', 'Passwort zurücksetzen', ['.auth-card__head h2', '[data-testid="footer-cancel"]']],
    ]) {
      await page.goto(url(path));
      await page.waitForSelector('.auth-card__head h2');
      await audit(page, vp, label, sels);
    }
    // öffentliche Seiten (gleiches Dokument-Scrollen)
    for (const [path, label, sels] of [
      ['pricing', 'Tarife', ['.public__bar', '[data-testid="footer-cancel"]']],
      ['kuendigen', 'Kündigen', ['.public__main input[type=email]', '.public__main button[type=submit]', '[data-testid="footer-withdraw"]']],
      ['impressum', 'Impressum', ['[data-testid="legal-doc"] h1', '[data-testid="footer-cancel"]']],
    ]) {
      await page.goto(url(path));
      await page.waitForSelector('.public__main');
      await page.waitForTimeout(200);
      await audit(page, vp, label, sels);
    }
  } catch (e) {
    check(`${vp.name}: Ablauf`, false, String(e.message ?? e).split('\n')[0]);
  }
  await ctx.close();
}

// vollständige Registrierung (Unternehmen) auf iPhone-Größe – inkl. Bestätigungshinweis „E-Mail bestätigen“
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto(url(''));
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => {
      window.__oloMock.publishLegal('privacy', 'all', '1.0', 'Ich habe die {link} zur Kenntnis genommen.');
      window.__oloMock.publishLegal('license_terms', 'all', '1.0', 'Ich akzeptiere die {link}.');
      window.__oloMock.setRequireConfirmation(true);
    });
    await page.goto(url('register'));
    await page.waitForSelector('[data-testid="register-form"]');
    await page.locator('[data-testid="type-business"]').tap();
    const f = page.locator('[data-testid="register-form"]');
    await f.getByLabel('Firmenname').fill('Optik Mobil');
    await f.getByLabel('Vorname', { exact: true }).fill('Mia');
    await f.getByLabel('Nachname', { exact: true }).fill('Mobil');
    await f.getByLabel('E-Mail').fill('mia@mobil-optik.de');
    await f.getByLabel('Passwort', { exact: true }).fill('Geheim123');
    await f.getByLabel('Passwort bestätigen').fill('Geheim123');
    await f.getByLabel('Straße und Hausnummer').fill('Hauptstraße 1');
    await f.getByLabel('PLZ').fill('66709');
    await f.locator('input[autocomplete="address-level2"]').fill('Weiskirchen');
    for (const box of await f.locator('[data-testid="legal-consents"] input[type=checkbox]').all()) {
      await box.scrollIntoViewIfNeeded();
      await box.check();
    }
    const submit = f.locator('button[type=submit]');
    await submit.scrollIntoViewIfNeeded();
    await submit.tap();
    const ok = await page.locator('[data-testid="confirm-notice"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    check('iphone: Registrierung (Unternehmen) vollständig per Touch abgeschlossen', ok);
    await audit(page, { name: 'iphone' }, 'E-Mail bestätigen', ['[data-testid="confirm-notice"]', '[data-testid="footer-cancel"]']);
  } catch (e) {
    check('iphone: Registrierung per Touch', false, String(e.message ?? e).split('\n')[0]);
  }
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
if (logs.length) console.log('\n--- Konsole ---\n' + logs.join('\n'));
process.exit(failed.length ? 1 : 0);
