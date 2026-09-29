/**
 * Phase 5 – Module & Dashboard: Modul-Kacheln, eigenständige Modulseiten, Modulwechsel, Wechsel in den
 * vollständigen Simulator und zurück, Brillenglas-Modul (Dicke ↔ Material), geplante Module, Responsiv.
 * Aufruf: Dev-Server starten (npm run dev), dann `node tests/e2e/phase5.e2e.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startFresh, url } from './helpers.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Software-Rendering (Swiftshader) ist langsam: großzügige Zeitlimits
page.setDefaultTimeout(30000);
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock') && !m.text().includes('willReadFrequently')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}p5_${n}.png` });
const vis = (sel, ms = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const safe = async (name, fn) => {
  try {
    if (process.env.E2E_VERBOSE) console.log('…', name);
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
  }
};
const readout = async (label) => (await page.locator(`.wb-readout:has(.wb-readout__label:text-is("${label}")) .wb-readout__value`).first().textContent())?.trim() ?? '';
const num = (t) => Number(String(t).replace(',', '.').replace(/[^\d.-]/g, ''));
const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

await startFresh(page, null);

// 1) Dashboard: Simulator + Module
await safe('Dashboard', async () => {
  await page.goto(url('dashboard'));
  check('Kachel „Vollständiger Simulator“', await vis('[data-testid="simulator-tile"]'));
  for (const id of ['retinoscopy', 'refraction', 'patient-view', 'contact-lens', 'spectacle-lens']) check(`Modul-Kachel ${id}`, await vis(`[data-testid="module-tile-${id}"]`));
  check('Geplante Module als Hinweis', await vis('.module-overview__more:has-text("Spaltlampe")'));
  await shot('01_dashboard');
});

// 2) Modulübersicht
await safe('Modulübersicht', async () => {
  await page.click('.side-nav__item:has-text("Module")');
  await page.waitForURL(/\/modules$/);
  check('Gruppen der Modulübersicht', (await page.locator('.page-section__title').count()) >= 3);
  const planned = page.locator('[data-testid="module-tile-slit-lamp"]');
  check('Geplantes Modul deaktiviert', await planned.isDisabled());
  await shot('02_modules');
});

// 3) Skiaskopie als eigenständiges Modul
let retinoSim = '';
await safe('Modul Skiaskopie', async () => {
  await page.click('[data-testid="module-tile-retinoscopy"]');
  await page.waitForURL(/\/modules\/retinoscopy\/sim_/);
  retinoSim = page.url().split('/').pop();
  await page.waitForSelector('[data-testid="module-shell"]');
  check('Fokussierte Modulseite', await vis('[data-testid="module-panel"] [data-testid="reflex-view"]', 20000));
  check('Keine Simulator-Reiter im Modul', (await page.locator('.workbench-bar').count()) === 0);
  check('Sitzung als Simulation gespeichert (moduleId)', await page.evaluate((id) => JSON.parse(localStorage.getItem('oel:v3:sims:index') || '[]').some((m) => m.id === id && m.moduleId === 'retinoscopy'), retinoSim));
  await page.waitForTimeout(2500);
  await shot('03_retino');
});

// 4) Modulwechsel über die Kopfzeile
await safe('Modulwechsel', async () => {
  await page.click('[data-testid="module-switcher"]');
  await page.click('.menu__item:has-text("Refraktion")');
  await page.waitForURL(/\/modules\/refraction\/sim_/);
  check('Refraktion geöffnet', await vis('[data-testid="module-panel"] [data-testid="trial-lens"]', 20000));
  await page.click('[data-testid="module-home"]');
  await page.waitForURL(/\/dashboard/);
  check('Zurück zum Dashboard', true);
  await page.click('[data-testid="module-tile-retinoscopy"]');
  await page.waitForURL(/\/modules\/retinoscopy\/sim_/);
  check('Modul setzt letzte Sitzung fort', page.url().endsWith(retinoSim), page.url());
});

// 5) Brillenglas: Dicke folgt dem Material
await safe('Modul Brillenglas', async () => {
  await page.goto(url('modules/spectacle-lens'));
  await page.waitForURL(/\/modules\/spectacle-lens\/sim_/);
  check('Querschnitte sichtbar', await vis('[data-testid="lens-profiles"]', 20000));
  await page.waitForTimeout(1500);
  const before = await readout('Randdicke min / max');
  const tBefore = await readout('Mittendicke');
  await page.click('[data-testid="material-comparison"] tr:has-text("1,740")');
  await page.waitForTimeout(800);
  const after = await readout('Randdicke min / max');
  const maxB = num(before.split('/')[1]);
  const maxA = num(after.split('/')[1]);
  check('Minusglas: höherer Index → dünnerer Rand', maxA < maxB, `${before} → ${after} (Mitte ${tBefore})`);
  const n = await page.evaluate(() => window.__oel.getState().doc.elements.find((e) => e.kind === 'spectacle-lens').medium.n);
  check('Material übernommen (n = 1,74)', Math.abs(n - 1.74) < 1e-6);
  // Plusglas: Wirkung auf +4 → Mittendicke hängt vom Index ab
  await page.evaluate(() => {
    const s = window.__oel.getState();
    const el = s.doc.elements.find((e) => e.kind === 'spectacle-lens');
    s.select(el.id);
  });
  for (let i = 0; i < 30; i++) {
    const v = num(await page.locator('[data-testid="spec-sph"] output').textContent());
    if (v >= 3.99) break;
    await page.click('[data-testid="spec-sph"] button[aria-label="Sph erhöhen"]');
  }
  await page.waitForTimeout(600);
  const t174 = num(await readout('Mittendicke'));
  await page.click('[data-testid="material-comparison"] tr:has-text("1,500")');
  await page.waitForTimeout(800);
  const t150 = num(await readout('Mittendicke'));
  check('Plusglas: höherer Index → dünnere Mitte', t174 < t150, `1,74: ${t174} mm, 1,50: ${t150} mm`);
  await shot('05_spectacle');
});

// 6) In den vollständigen Simulator und zurück
await safe('Simulator ↔ Modul', async () => {
  const sim = page.url().split('/').pop();
  await page.click('[data-testid="open-simulator"]');
  await page.waitForURL(new RegExp(`/simulations/${sim}$`));
  await page.waitForFunction(() => !!document.querySelector('.viewport canvas'));
  check('Gleiche Simulation im Simulator', true);
  check('Arbeitsbereich Brillenglas aktiv', await vis('[data-testid="workbench-spectacle-lens"][aria-selected="true"]'));
  check('Material bleibt erhalten', await page.evaluate(() => Math.abs(window.__oel.getState().doc.elements.find((e) => e.kind === 'spectacle-lens').medium.n - 1.5) < 1e-6));
  await page.click('[data-testid="open-as-module"]');
  await page.waitForURL(new RegExp(`/modules/spectacle-lens/${sim}$`));
  check('„Als Modul öffnen“ führt zurück ins Modul', await vis('[data-testid="module-shell"]'));
});

// 7) Neuladen einer Modulseite
await safe('Neuladen', async () => {
  const u = page.url();
  await page.reload();
  await page.waitForSelector('[data-testid="module-shell"]');
  check('Modulseite ist neu ladbar (Deep-Link)', page.url() === u && (await vis('[data-testid="lens-profiles"]', 20000)));
});

// 8) Geplantes Modul
await safe('Geplantes Modul', async () => {
  await page.goto(url('modules/slit-lamp'));
  check('„In Entwicklung“-Hinweis', await vis('text=in Entwicklung'));
});

// 9) Responsiv
await safe('Responsiv', async () => {
  for (const [w, h] of [[1180, 820], [900, 800], [700, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(url('dashboard'));
    await page.waitForTimeout(600);
    check(`Dashboard ${w} px ohne horizontalen Überlauf`, !(await overflowX()));
  }
  await page.goto(url('modules/retinoscopy'));
  await page.waitForURL(/\/modules\/retinoscopy\/sim_/);
  await page.waitForTimeout(2500);
  check('Modulseite 700 px ohne horizontalen Überlauf', !(await overflowX()));
  check('Modulseite 700 px: Panel sichtbar', await vis('[data-testid="reflex-view"]', 20000));
  await shot('09_module_700');
  await page.setViewportSize({ width: 1440, height: 900 });
});

check('Keine Laufzeitfehler in der Konsole', !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')), logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')).slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} bestanden`);
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
