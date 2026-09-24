import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startFresh } from './helpers.mjs';
// Aufruf: Dev-Server starten (npm run dev), dann `npm run test:e2e`.
// Optional: E2E_URL, E2E_OUT (Screenshot-Ordner), CHROMIUM_PATH (eigener Chromium ohne GPU).
mkdirSync(process.env.E2E_OUT ?? './e2e-screenshots/', { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
const logs = [];
page.on('console', (m) => { if (['error','warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0,300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await startFresh(page, 'tpl-toric-spectacle');
const out = [];
// alle Elementarten hinzufügen und jeweils Inspector rendern
const kinds = ['converging-lens','diverging-lens','plano-convex','plano-concave','biconvex','biconcave','custom-lens','spectacle-lens','contact-lens','rigid-contact-lens','soft-contact-lens','prism','plane-plate','magnifier','custom-medium'];
await page.evaluate(() => window.__oel.getState().newScene());
await page.waitForTimeout(800);
for (const k of kinds) {
  await page.evaluate((k) => window.__oel.getState().addElement(k), k);
  await page.waitForTimeout(250);
  const t = await page.textContent('.insp-header__type');
  out.push(`${k}: ${t}`);
}
// Medium-Formen
for (const shape of ['cylinder','sphere','box']) {
  await page.evaluate((shape) => { const s = window.__oel.getState(); const el = s.doc.elements.at(-1); s.updateEntity(el.id, e => ({...e, body: {...e.body, shape}})); }, shape);
  await page.waitForTimeout(250);
}
// Lichtquelle, Strahlen, Punktquelle
await page.evaluate(() => { const s = window.__oel.getState(); s.addLightSource(); });
await page.waitForTimeout(600);
out.push('light inspector: ' + await page.textContent('.insp-header__type'));
await page.evaluate(() => { const s = window.__oel.getState(); const l = s.doc.lights[0]; s.updateEntity(l.id, e => ({...e, source: {...e.source, kind: 'point', sagittal: true}})); });
await page.waitForTimeout(800);
const res = await page.evaluate(() => document.querySelector('.panel--right')?.textContent.includes('Strahlen gesamt'));
out.push('ray results shown: ' + res);
// Messpunkt
await page.evaluate(() => window.__oel.getState().addMeasurePoint());
await page.waitForTimeout(400);
out.push('measure point: ' + (await page.textContent('.panel--right')).includes('Abstand zur optischen Achse'));
// Raum
await page.click('.tree-row--root');
await page.waitForTimeout(300);
out.push('room: ' + await page.textContent('.insp-header__type'));
// Auge + Teile
await page.evaluate(() => window.__oel.getState().select('eye', 'cornea'));
await page.waitForTimeout(400);
out.push('eye part: ' + await page.textContent('.insp-part'));
out.push('eye refraction: ' + await page.locator('.readout:has-text("Hauptschnitt") .readout__value').first().textContent());
// Duplizieren, Sperren, Ausblenden
await page.evaluate(() => { const s = window.__oel.getState(); const el = s.doc.elements[0]; s.select(el.id); s.duplicateEntity(el.id); s.setEntityFlag(el.id, 'locked', true); s.deleteEntity(el.id); s.setEntityFlag(el.id, 'visible', false); });
await page.waitForTimeout(400);
const st = await page.evaluate(() => { const s = window.__oel.getState(); return { n: s.doc.elements.length, first: s.doc.elements[0] }; });
out.push(`dup/lock/hide: n=${st.n} locked=${st.first.locked} visible=${st.first.visible}`);
// Dialoge
for (const d of ['settings', 'shortcuts', 'add-element']) {
  await page.evaluate((d) => window.__oel.getState().openDialog(d), d);
  await page.waitForTimeout(300);
  out.push(`dialog ${d}: ${await page.textContent('.dialog__title')}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
// Qualität wechseln (Canvas neu) – Kamera bleibt erhalten
const before = await page.evaluate(() => window.__oelProject('eye'));
await page.evaluate(() => window.__oel.getState().setPrefs({ quality: 'balanced' }));
await page.waitForTimeout(4000);
const after = await page.evaluate(() => window.__oelProject('eye'));
out.push(`camera kept after quality switch: ${Math.hypot(before.x-after.x, before.y-after.y) < 5}`);
// Menü
await page.click('.sim-nav .toolbar__menu-btn');
await page.waitForTimeout(300);
out.push('menu items: ' + await page.locator('.menu__item').count());
await page.keyboard.press('Escape');
await page.screenshot({ path: (process.env.E2E_OUT ?? './e2e-screenshots/') + 'smoke.png' });
console.log(out.join('\n'));
console.log('--- logs ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
