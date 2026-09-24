import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
// Aufruf: Dev-Server starten (npm run dev), dann `npm run test:e2e`.
// Optional: E2E_URL, E2E_OUT (Screenshot-Ordner), CHROMIUM_PATH (eigener Chromium ohne GPU).
mkdirSync(process.env.E2E_OUT ?? './e2e-screenshots/', { recursive: true });
const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const eyeRx = () => page.evaluate(() => window.__oelPhysics.eyeRefractionState(window.__oel.getState().doc.eye.anatomy).rx);
const doc = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__oel.getState().doc)));
const setNum = async (label, value, scope = '.panel--right') => {
  const f = page.locator(`${scope} .field:has(.field__label:text-is("${label}"))`).first().locator('.field__value');
  await f.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
};
const near = (a, b, t = 0.01) => Math.abs(a - b) < t;

await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5173/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify({ quality: 'performance' })); });
await page.reload();
await page.waitForTimeout(5000);
await page.evaluate(() => { const s = window.__oel.getState(); s.newScene(); s.addLightSource(); s.select('eye'); });
await page.waitForTimeout(1200);

// 1) Eingabe -3,00 sph am Auge
await setNum('Sphäre', '-3,00');
let rx = await eyeRx();
check('Auge: Eingabe −3,00 sph', near(rx.sph, -3) && near(rx.cyl, 0), JSON.stringify(rx));
let d = await doc();
check('Auge: Baulänge verlängert (Achsenametropie/Auto)', d.eye.anatomy.axialLength > 25.2, String(d.eye.anatomy.axialLength));

// 2) -3,00 / -1,75 A 134
await setNum('Zylinder', '-1,75');
await setNum('Achse', '134');
rx = await eyeRx();
check('Auge: −3,00 / −1,75 A 134', near(rx.sph, -3) && near(rx.cyl, -1.75) && near(rx.axis, 134, 0.5), JSON.stringify(rx));
d = await doc();
check('Auge: torische Hornhaut erzeugt', d.eye.anatomy.corneaFrontRadius2 !== undefined && d.eye.anatomy.corneaAxis === 134);
const transposed = await page.locator('.rx-editor__transposed').first().textContent();
check('Transposition wird angezeigt', transposed.replace(/\s/g, '').includes('−4,75dpt/+1,75dptA44°'), transposed);
await page.screenshot({ path: OUT + 'p2_01_eye_astig.png' });

// 3) Brechungsametropie
const alBefore = d.eye.anatomy.axialLength;
await page.click('.panel--right .segmented__item:has-text("Brechung")');
await page.waitForTimeout(500);
d = await doc(); rx = await eyeRx();
check('Brechungsametropie: Baulänge = Le Grand, Refraktion bleibt', near(d.eye.anatomy.axialLength, 24.2) && near(rx.sph, -3) && near(rx.cyl, -1.75), `${alBefore} → ${d.eye.anatomy.axialLength}`);
await page.click('.panel--right .segmented__item:has-text("Achse")');
await page.waitForTimeout(500);
d = await doc();
check('Achsenametropie: Baulänge wieder verlängert', d.eye.anatomy.axialLength > 25);

// 4) Baulänge direkt ändern → Refraktion ändert sich
await setNum('Baulänge', '24,2');
rx = await eyeRx();
check('Baulänge ändern ändert Refraktion (Geometrie = Source of Truth)', rx.sph > -1.5, JSON.stringify(rx));
await setNum('Sphäre', '-3,00');

// 5) Brillenglas hinzufügen, Rezept eingeben
await page.click('button:has-text("Optisches Element")');
await page.click('.add-card:has-text("Brillenglas")');
await page.waitForTimeout(800);
await setNum('Sphäre', '-3,00');
await setNum('Zylinder', '-1,75');
await setNum('Achse', '134');
let lrx = await page.evaluate(() => { const s = window.__oel.getState(); return window.__oelPhysics.lensRx(s.doc.elements[0]); });
check('Brillenglas −3,00 / −1,75 A 134 aus Geometrie', near(lrx.sph, -3) && near(lrx.cyl, -1.75) && near(lrx.axis, 134, 0.5), JSON.stringify(lrx));
d = await doc();
check('Glas ist innentorisch (Rückfläche torisch)', d.elements[0].lens.backRadius2 !== undefined);

// 6) Umschalten Optik → Geometrie, gleiche Wirkung
await page.click('.mode-switch .segmented__item:has-text("Geometrie")');
await page.waitForTimeout(400);
const hs2 = await page.locator('.panel--right .field:has(.field__label:text-is("Radius Hauptschnitt 2"))').count();
check('Geometrie-Modus zeigt torische Hauptschnitte', hs2 >= 1);
const sv = await page.locator('.readout:has-text("Scheitelbrechwert") .readout__value').first().textContent();
check('Geometrie-Modus: gleiche Wirkung angezeigt', sv.replace(/\s/g, '').startsWith('−3,00dpt/−1,75dptcylA134°'), sv);
await page.screenshot({ path: OUT + 'p2_02_geometry.png' });
await page.click('.mode-switch .segmented__item:has-text("Optische Werte")');
await page.waitForTimeout(300);

// 7) HSA verändern → Restrefraktion ändert sich
const res12 = await page.locator('[data-testid="residual-rx"]').textContent();
await setNum('HSA', '20');
const res20 = await page.locator('[data-testid="residual-rx"]').textContent();
check('HSA-Änderung ändert Restrefraktion', res12 !== res20, `${res12} → ${res20}`);
const eff = await page.locator('.readout:has-text("Wirksam am Hornhautscheitel") .readout__value').first().textContent();
check('Wirksame Brechkraft am HS angezeigt', eff.includes('dpt'), eff);
// Erklärung öffnen
await page.locator('.readout:has-text("Wirksam am Hornhautscheitel") .explain-btn').first().click();
await page.waitForTimeout(300);
const expl = await page.locator('.explain-pop').textContent().catch(() => '');
check('Info-Erklärung mit Formel F_HS = F / (1 − d·F)', expl.includes('F / (1 − d·F)') && expl.includes('0,0200 m'), expl.slice(0, 80));
await page.screenshot({ path: OUT + 'p2_03_explain.png' });
await page.keyboard.press('Escape');

// 8) Kontaktlinse aufsetzen, Glas entfernen
await page.evaluate(() => { const s = window.__oel.getState(); s.deleteEntity(s.doc.elements[0].id); });
await page.click('button:has-text("Optisches Element")');
await page.click('.add-card:has-text("Formstabile Kontaktlinse")');
await page.waitForTimeout(800);
d = await doc();
check('KL aufgesetzt (onEye) mit Tränenfilm', d.elements[0].contact.onEye === true && d.elements[0].contact.tearFilm === true);
const tlText = await page.locator('.readout:has-text("Wirkung der Tränenlinse") .readout__value').first().textContent().catch(() => '');
check('Tränenlinse im Inspector', tlText.includes('dpt'), tlText);
await setNum('Sphäre', '-3,00');
await page.waitForTimeout(400);
const resCL = await page.locator('[data-testid="residual-rx"]').textContent();
check('KL-Korrektion: Restrefraktion angezeigt', resCL.includes('Rest'), resCL);
// Tränenfilm aus / an
await page.locator('.panel--right .field:has(.field__label:text-is("Tränenfilm als Medium")) .toggle__track').click();
await page.waitForTimeout(400);
d = await doc();
check('Tränenfilm abschaltbar', d.elements[0].contact.tearFilm === false);
await page.locator('.panel--right .field:has(.field__label:text-is("Tränenfilm als Medium")) .toggle__track').click();
await page.waitForTimeout(400);
d = await doc();
check('Tränenfilm aktiv', d.elements[0].contact.tearFilm === true);
// Zentrierung
await setNum('Zentrierung horizontal', '1');
d = await doc();
check('KL-Zentrierung folgt dem Auge', near(d.elements[0].transform.position[0], -1, 0.05), JSON.stringify(d.elements[0].transform.position));
await page.evaluate(() => window.__oel.getState().setDocField('display', { showRays: true }));
await page.evaluate(() => { const s = window.__oel.getState(); s.updateEntity('eye', (e) => ({ ...e, viewMode: 'section' })); s.sendCameraCommand({ type: 'focus-eye' }); });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + 'p2_04_contact.png' });

// 9) Speichern und neu laden
const before = await doc();
await page.keyboard.press('Control+S');
await page.waitForTimeout(400);
await page.reload();
await page.waitForTimeout(5000);
await page.evaluate(() => { const s = window.__oel.getState(); s.newScene(); });
await page.waitForTimeout(500);
await page.evaluate((id) => window.__oel.getState().loadSaved(id), before.id);
await page.waitForTimeout(1500);
const after = await doc();
check('Speichern/Laden: torische Hornhaut erhalten', near(after.eye.anatomy.corneaFrontRadius2, before.eye.anatomy.corneaFrontRadius2, 1e-9));
check('Speichern/Laden: KL mit Tränenfilm/Zentrierung erhalten', after.elements[0].contact.onEye && after.elements[0].contact.centration.x === 1);
const rxAfter = await eyeRx();
check('Speichern/Laden: Refraktion identisch', near(rxAfter.sph, -3) && near(rxAfter.cyl, -1.75));

// 10) Alle Demos laden
const ids = await page.evaluate(() => ['normal-eye','myopia','hyperopia','astigmatism','eye-spectacle','eye-contact','rgp-tear-lens','hsa-change','astig-correction','eye-two-lenses']);
for (const id of ids) {
  await page.evaluate((id) => window.__oel.getState().loadPreset(id), id);
  await page.waitForTimeout(1500);
}
check('Alle Demo-Szenen laden ohne Fehler', !logs.some((l) => l.includes('pageerror')));

console.log(results.join('\n'));
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
