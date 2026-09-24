import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startFresh } from './helpers.mjs';
// Aufruf: Dev-Server starten (npm run dev), dann `npm run test:e2e`.
// Optional: E2E_URL, E2E_OUT (Screenshot-Ordner), CHROMIUM_PATH (eigener Chromium ohne GPU).
mkdirSync(process.env.E2E_OUT ?? './e2e-screenshots/', { recursive: true });
const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error','warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info='') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const S = () => page.evaluate(() => { const s = window.__oel.getState(); return JSON.parse(JSON.stringify({ doc: s.doc, sel: s.selectedId, tool: s.tool, past: s.past.length, proj: s.projection, dirty: s.dirty })); });

await startFresh(page, 'tpl-toric-spectacle');
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + '01_start.png' });
let st = await S();
check('Start: Standard-Demo geladen', st.doc.elements.length === 1 && st.doc.elements[0].kind === 'spectacle-lens');

// 1) Auswahl über Szenenbaum
await page.click('.tree-row:has-text("Brillenglas 1")');
await page.waitForTimeout(600);
st = await S();
check('Auswahl über Szenenbaum', st.sel === st.doc.elements[0].id);
const inspType = await page.textContent('.insp-header__type');
check('Inspector zeigt Brillenglas', inspType?.includes('Brillenglas'), inspType);
await page.screenshot({ path: OUT + '02_selected.png' });

// 2) HSA im Inspector auf 14 mm setzen
const hsaField = page.locator('.field:has(.field__label:text-is("HSA")) .field__value');
await hsaField.click();
await page.keyboard.press('Control+A');
await page.keyboard.type('14');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const gap = await page.textContent('.mgap__value');
check('HSA-Eingabe verschiebt Glas (Maßkette 14,00 mm)', gap?.replace(/\s/g,'') === '14,00mm', gap);

// 3) Vorderradius ändern -> Szene und berechnete Werte ändern sich
await page.click('.mode-switch .segmented__item:has-text("Geometrie")');
await page.waitForTimeout(300);
const before = await page.locator('.readout:has-text("Scheitelbrechwert") .readout__value').first().textContent();
const r1 = page.locator('.field:has(.field__label:text-is("Radius"))').first().locator('.field__value');
await r1.click();
await page.keyboard.press('Control+A');
await page.keyboard.type('120');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
st = await S();
const after = await page.locator('.readout:has-text("Scheitelbrechwert") .readout__value').first().textContent();
await page.click('.mode-switch .segmented__item:has-text("Optische Werte")');
check('Radius-Eingabe übernimmt Wert', st.doc.elements[0].lens.frontRadius === 120);
check('Berechneter Scheitelbrechwert aktualisiert', before !== after, `${before} → ${after}`);

// 4) Gizmo ziehen (Y-Achse nach oben)
const id = st.doc.elements[0].id;
const y0 = st.doc.elements[0].transform.position[1];
const c = await page.evaluate((id) => window.__oelProject(id), id);
const tip = await page.evaluate((id) => window.__oelProject(id, [0, 18, 0]), id);
// Pfeil zwischen Mitte und ~Spitze greifen: Suche entlang der Y-Richtung
let moved = false;
for (const f of [0.55, 0.7, 0.85, 1.0, 0.4]) {
  const sx = c.x + (tip.x - c.x) * f, sy = c.y + (tip.y - c.y) * f;
  await page.mouse.move(sx, sy); await page.waitForTimeout(150);
  await page.mouse.down(); await page.mouse.move(sx, sy - 40, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  st = await S();
  if (Math.abs(st.doc.elements[0].transform.position[1] - y0) > 0.5) { moved = true; break; }
}
check('Gizmo: Verschieben per Maus', moved, `y ${y0} → ${st.doc.elements[0].transform.position[1]}`);
check('Auswahl bleibt nach Gizmo-Drag erhalten', st.sel === id);
const posField = await page.locator('.vec3:has-text("Position") .field__number').nth(1).textContent();
check('Inspector zeigt neue Y-Position live', Math.abs(parseFloat(posField.replace(',', '.').replace('−','-')) - st.doc.elements[0].transform.position[1]) < 0.01, posField);

// 5) Undo
await page.keyboard.press('Control+Z');
await page.waitForTimeout(300);
st = await S();
check('Undo nimmt Gizmo-Bewegung zurück', Math.abs(st.doc.elements[0].transform.position[1] - y0) < 0.01);
await page.keyboard.press('Control+Shift+Z');
await page.waitForTimeout(300);
st = await S();
check('Redo stellt sie wieder her', Math.abs(st.doc.elements[0].transform.position[1] - y0) > 0.5);

// 6) Rotationswerkzeug + Rotation per Inspector
await page.keyboard.press('e');
await page.waitForTimeout(200);
st = await S();
check('Werkzeug Drehen (Taste E)', st.tool === 'rotate');
const rotY = page.locator('.vec3:has-text("Rotation") .field__value').nth(1);
await rotY.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('15'); await page.keyboard.press('Enter');
await page.waitForTimeout(400);
st = await S();
check('Rotation per Inspector', st.doc.elements[0].transform.rotation[1] === 15);
const tilt = await page.locator('.readout:has-text("Neigung zur Achse") .readout__value').textContent();
check('Neigung wird angezeigt', tilt.includes('15'), tilt);
await page.screenshot({ path: OUT + '03_rotated.png' });

// 7) Element hinzufügen über Dialog
await page.click('button:has-text("Optisches Element")');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '04_add_dialog.png' });
await page.click('.add-card:has-text("Prisma")');
await page.waitForTimeout(800);
st = await S();
check('Prisma hinzugefügt und ausgewählt', st.doc.elements.length === 2 && st.doc.elements[1].kind === 'prism' && st.sel === st.doc.elements[1].id);
const chainCount = await page.locator('.measure-bar__seg').count();
check('Maßkette enthält 2 Elemente', chainCount === 2);
await page.click('button:has-text("Optisches Element")');
await page.click('.add-card:has-text("Weiche Kontaktlinse")');
await page.waitForTimeout(800);
st = await S();
const cl = st.doc.elements[2];
check('Kontaktlinse sitzt auf der Hornhaut', cl.contact.onEye === true && Math.abs(cl.transform.position[2] + (cl.contact.tearFilmThickness + cl.lens.centerThickness/2)) < 0.01, JSON.stringify(cl.transform.position));
await page.screenshot({ path: OUT + '05_three_elements.png' });

// 8) Auswahl per Klick in die 3D-Szene (Auge)
await page.keyboard.press('Escape');
await page.evaluate(() => window.__oel.getState().sendCameraCommand({ type: 'view', view: 'side' }));
await page.waitForTimeout(1500);
const eyeC = await page.evaluate(() => window.__oelProject('eye', [0, 4, 14]));
await page.mouse.click(eyeC.x, eyeC.y);
await page.waitForTimeout(500);
st = await S();
check('Klick in 3D wählt Auge', st.sel === 'eye', `sel=${st.sel}`);
const part = await page.locator('.insp-part').textContent().catch(() => '');
check('Angeklickter Augenteil wird erkannt', part.length > 0, part);
// Hover-Info
const cornea = await page.evaluate(() => window.__oelProject('eye', [0, 8, 16]));
await page.mouse.move(cornea.x + 1, cornea.y + 1); await page.waitForTimeout(300);
await page.mouse.move(cornea.x + 2, cornea.y + 2); await page.waitForTimeout(400);
const tipText = await page.locator('.hover-tip').textContent().catch(() => '');
check('Hover-Info erscheint', tipText.length > 0, tipText.slice(0, 60));

// 9) Schnittansicht
await page.click('.viewbar .segmented__item:has-text("Schnitt")');
await page.waitForTimeout(1200);
st = await S();
check('Schnittansicht aktiv', st.doc.eye.viewMode === 'section');
await page.evaluate(() => window.__oel.getState().sendCameraCommand({ type: 'view', view: 'side' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '06_section_side.png' });
const eyeLabels = await page.locator('.scene-label--eye').count();
check('Beschriftungen im Schnitt', eyeLabels === 7, String(eyeLabels));

// 10) Ortho + Views
await page.keyboard.press('5');
await page.waitForTimeout(1500);
st = await S();
check('Orthografische Kamera', st.proj === 'orthographic');
await page.screenshot({ path: OUT + '07_ortho.png' });
await page.keyboard.press('5');
await page.waitForTimeout(800);
await page.keyboard.press('1');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '08_front.png' });

// 11) Speichern / Neuladen / Reset (Phase 3: Bibliothek statt Szenenliste)
await page.keyboard.press('Control+S');
await page.waitForTimeout(800);
st = await S();
check('Speichern setzt dirty zurück', st.dirty === false);
const simId = await page.evaluate(() => window.__oel.getState().simId);
const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem('oel:v3:sim:' + id) || 'null'), simId);
check('Simulation in der lokalen Bibliothek', !!stored && stored.elements.length === st.doc.elements.length);
const savedCount = st.doc.elements.length;
await page.reload();
await page.waitForFunction(() => window.__oel?.getState().simId, null, { timeout: 30000 });
await page.waitForTimeout(4000);
st = await S();
check('Gespeicherte Simulation nach Neuladen geöffnet', st.doc.elements.length === savedCount);
await page.click('.tree-row:has-text("Prisma 1")');
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
st = await S();
check('Löschen per Taste', st.doc.elements.length === savedCount - 1);
await page.evaluate(() => window.__oel.getState().resetScene());
await page.waitForTimeout(400);
st = await S();
check('Zurücksetzen stellt gespeicherten Stand her', st.doc.elements.length === savedCount);

// 12) Automatisches Speichern + Neuladen
await page.evaluate(() => window.__oel.getState().setSceneName('Autosave-Test'));
await page.waitForFunction(() => !window.__oel.getState().dirty, null, { timeout: 20000 });
const statusTxt = await page.textContent('.statusbar .save-status');
check('Statusleiste zeigt „Gespeichert“', /Gespeichert/.test(statusTxt ?? ''), statusTxt);
await page.reload();
await page.waitForFunction(() => window.__oel?.getState().simId, null, { timeout: 30000 });
await page.waitForTimeout(3000);
st = await S();
check('Automatisch gespeicherter Stand nach Neuladen', st.doc.name === 'Autosave-Test');

// 13) Presets
for (const pid of ['normal-eye', 'eye-contact', 'eye-two-lenses']) {
  await page.evaluate((pid) => window.__oel.getState().loadPreset(pid), pid);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + `10_preset_${pid}.png` });
}
st = await S();
check('Preset zwei Linsen', st.doc.elements.length === 2);
const focusTxt = await page.locator('.measure-bar__focus').textContent().catch(() => '');
check('Fokusanzeige Kepler-System', focusTxt.length > 0, focusTxt);

// 14) Layout-Größen
for (const [w, h] of [[1366, 768], [1180, 820]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Layout ${w}×${h} ohne horizontalen Überlauf`, !overflow);
  await page.screenshot({ path: OUT + `11_layout_${w}.png` });
}

console.log(results.join('\n'));
console.log('\n--- Konsole (Fehler/Warnungen) ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
