/**
 * Phase 4 – Untersuchungsmodi: Skiaskop öffnen/bewegen/neutralisieren, Refraktionsmodus (Sph/Cyl/Achse),
 * Patientensicht, Kontaktlinse → Fluoreszein, Materialwechsel, Training, Speichern + Neuladen.
 * Aufruf: Dev-Server starten (npm run dev), dann `node tests/e2e/phase4.e2e.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startFresh } from './helpers.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-screenshots/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_PATH ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Software-Rendering (Swiftshader) ist langsam: großzügige Zeitlimits, Arbeitsbereiche brauchen Einschwingzeit
page.setDefaultTimeout(30000);
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('THREE.Clock')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
const shot = (n) => page.screenshot({ path: `${OUT}p4_${n}.png` });
const vis = (sel, ms = 5000) => page.locator(sel).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const safe = async (name, fn) => {
  try {
    if (process.env.E2E_VERBOSE) console.log('…', name);
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
  }
};
const S = () => page.evaluate(() => {
  const s = window.__oel.getState();
  const trial = s.doc.elements.find((e) => e.family === 'lens' && e.role === 'trial');
  const scope = s.doc.lights.find((l) => l.retinoscope);
  return { wb: s.doc.display.workbench, trial: trial ? { sph: trial.rx?.sph ?? trial.params?.rx?.sph, id: trial.id } : null, scope: scope?.retinoscope ?? null, dirty: s.dirty, simId: s.simId, view: s.doc.eye.viewMode };
});
const motion = async () => (await page.locator('.wb-readout:has(.wb-readout__label:text-is("Bewegung")) .wb-readout__value').first().textContent())?.trim();

await startFresh(page, 'tpl-myopia');

// 1) Skiaskop öffnen
await safe('Skiaskop öffnen', async () => {
  await page.waitForTimeout(4000);
  await page.click('[data-testid="workbench-retinoscopy"]');
  await page.waitForFunction(() => window.__oel.getState().doc.lights.some((l) => l.retinoscope), null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  check('Arbeitsbereich Skiaskopie aktiv', (await S()).wb === 'retinoscopy');
  check('Skiaskop in der Szene', !!(await S()).scope);
  check('Reflexansicht sichtbar', await vis('[data-testid="reflex-view"]'));
  check('Bewegung wird angezeigt', !!(await motion()), await motion());
  await shot('01_retinoscopy');
});

// 2) Skiaskop bewegen: Schwenk, Strichlage, Arbeitsabstand
await safe('Skiaskop bewegen', async () => {
  const reflex = () => page.evaluate(() => {
    const c = document.querySelector('[data-testid="reflex-view"] canvas') ?? document.querySelector('canvas[data-testid="reflex-view"]');
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4 * 13) h = (h * 31 + d[i] + d[i + 1]) % 1e9;
    return h;
  });
  const r0 = await reflex();
  await page.locator('[data-testid="sweep"]').fill('3');
  await page.waitForTimeout(600);
  check('Schwenk bewegt den Reflex im Pupillenbild', r0 !== (await reflex()));
  await page.locator('[data-testid="streak-axis"]').fill('45');
  await page.waitForTimeout(200);
  check('Strichlage änderbar', (await S()).scope?.streakAxis === 45);
  await page.locator('[data-testid="streak-axis"]').fill('90');
  await page.click('[data-testid="auto-sweep"]');
  await page.waitForTimeout(800);
  const a = await page.inputValue('[data-testid="sweep"]');
  await page.waitForTimeout(900);
  const b = await page.inputValue('[data-testid="sweep"]');
  check('Automatischer Schwenk bewegt den Strich', a !== b, `${a} → ${b}`);
  await page.click('[data-testid="auto-sweep"]');
  await page.waitForTimeout(1000);
  await page.click('.chip:has-text("50")').catch(() => undefined);
  await page.waitForTimeout(200);
  const wd = await page.evaluate(() => {
    const l = window.__oel.getState().doc.lights.find((x) => x.retinoscope);
    return Math.abs(l.transform.position[2]);
  });
  check('Arbeitsabstand 50 cm gesetzt', Math.abs(wd - 500) < 30, `${wd.toFixed(0)} mm`);
  await page.click('.chip:has-text("67")').catch(() => page.click('.chip:has-text("66")'));
  await page.waitForTimeout(200);
});

// 3) Neutralisation durchführen (Messglas schrittweise wie am Patienten)
await safe('Neutralisation', async () => {
  const start = await motion();
  check('Myopes Auge (−3 dpt) bei 67 cm: Gegenbewegung', start === 'Gegenbewegung', start);
  let m = start;
  for (let i = 0; i < 40 && m !== 'Neutral'; i++) {
    await page.click(`[data-testid="trial-sph"] button[aria-label="Sph ${m === 'Gegenbewegung' ? 'verringern' : 'erhöhen'}"]`);
    await page.waitForTimeout(250);
    m = await motion();
  }
  const st = await S();
  check('Neutralpunkt erreicht', m === 'Neutral', `${m}, Messglas ${st.trial?.sph}`);
  check('Messglas eingesetzt (Rolle „trial“)', !!st.trial);
  const net = await page.locator('.wb-readout:has(.wb-readout__label:text-is("Netto (Refraktion)")) .wb-readout__value').first().textContent();
  check('Arbeitsabstandskorrektur ergibt ≈ −3,00 dpt netto', /−(2,[89]\d|3,[01]\d)/.test(net ?? ''), net);
  await shot('02_neutral');
});

// 4) Refraktionsmodus: Sph/Cyl/Achse ändern
await safe('Refraktionsmodus', async () => {
  await page.click('[data-testid="workbench-refraction"]');
  await page.waitForTimeout(8000);
  check('Arbeitsbereich Refraktion aktiv', (await S()).wb === 'refraction');
  check('Messglas-Bedienung sichtbar', await vis('[data-testid="trial-lens"]'));
  const visus = async () => (await page.locator('.wb-readout:has(.wb-readout__label:text-is("Visus (Schätzung)")) .wb-readout__value').first().textContent())?.trim();
  // Arbeitsabstandskorrektur: Brutto − 1/w = Sph um −1,50 dpt → Nettokorrektion
  for (let i = 0; i < 6; i++) await page.click('[data-testid="trial-sph"] button[aria-label="Sph verringern"]');
  await page.waitForTimeout(1500);
  const v0 = await visus();
  const cyl0 = await page.textContent('[data-testid="trial-cyl"] output');
  await page.click('[data-testid="trial-cyl"] button[aria-label="Cyl verringern"]');
  await page.click('[data-testid="trial-cyl"] button[aria-label="Cyl verringern"]');
  for (let i = 0; i < 3; i++) await page.click('[data-testid="trial-axis"] button[aria-label="Achse erhöhen"]');
  await page.waitForTimeout(300);
  await page.waitForTimeout(1500);
  const cyl1 = await page.textContent('[data-testid="trial-cyl"] output');
  const ax1 = await page.textContent('[data-testid="trial-axis"] output');
  check('Cyl und Achse am Messglas geändert', cyl0 !== cyl1 && /−0,50/.test(cyl1 ?? ''), `${cyl0} → ${cyl1}, Achse ${ax1}`);
  const v1 = await visus();
  check('Visus reagiert auf Zylinderfehler', v0 !== v1, `${v0} → ${v1}`);
  // Lochblende: bei deutlichem Fehler (+1 dpt Sph zusätzlich) steigt der Visus
  const num = (v) => Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  for (let i = 0; i < 4; i++) await page.click('[data-testid="trial-sph"] button[aria-label="Sph verringern"]');
  await page.waitForTimeout(800);
  const vBlur = await visus();
  await page.click('[data-testid="pinhole"]');
  await page.waitForTimeout(800);
  const vPin = await visus();
  check('Lochblende verbessert den Visus bei Fehlsichtigkeit', num(vPin) > num(vBlur), `${vBlur} → ${vPin}`);
  await page.click('[data-testid="pinhole"]');
  for (let i = 0; i < 4; i++) await page.click('[data-testid="trial-sph"] button[aria-label="Sph erhöhen"]');
  await page.click('[data-testid="chart-duochrome"]');
  check('Rot-Grün-Test mit Patientenantwort', await vis('.wb-readout__label:text-is("Rot-Grün")'));
  await page.click('[data-testid="jcc-toggle"]');
  check('Kreuzzylinder aktivierbar', await vis('.wb-readout__label:text-is("Patient")'));
  await page.click('[data-testid="jcc-toggle"]');
  await page.click('[data-testid="chart-landolt"]');
  await page.waitForTimeout(2500);
  await shot('03_refraction');
});

// 5) Patientensicht
await safe('Patientensicht', async () => {
  await page.click('[data-testid="workbench-patient-view"]');
  await page.waitForTimeout(8000);
  check('Arbeitsbereich Patientensicht aktiv', (await S()).wb === 'patient-view');
  const canvases = await page.locator('[data-testid="workbench-dock"] canvas').count();
  check('Simuliertes Netzhautbild (Canvas) vorhanden', canvases >= 1, `${canvases}`);
  const nonBlank = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="workbench-dock"] canvas');
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    return max - min;
  });
  check('Bild ist gerendert (Kontrast > 0)', nonBlank > 20, `Δ=${nonBlank}`);
  await page.click('[data-testid="compare"]').catch(() => undefined);
  await page.waitForTimeout(2000);
  await shot('04_patient');
});

// 6) Kontaktlinse → Fluoreszeinansicht, Materialwechsel
await safe('Kontaktlinse / Fluoreszein', async () => {
  await page.click('[data-testid="workbench-contact-lens"]');
  await page.waitForTimeout(3000);
  await page.click('[data-testid="add-rgp"]');
  await page.waitForTimeout(5000);
  check('Formstabile Linse eingesetzt', await page.evaluate(() => window.__oel.getState().doc.elements.some((e) => !!e.contact)));
  check('Fluoreszeinbild sichtbar', await vis('[data-testid="fluo-view"]'));
  check('Sitzanalyse sichtbar', await vis('[data-testid="fit-analysis"]'));
  const box = await page.locator('[data-testid="fluo-view"] canvas').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  check('Klick zeigt Messwert und Interpretation', (await vis('[data-testid="fluo-probe"]:has-text("Messwert (Geometrie)")')) && (await vis('[data-testid="fluo-probe"]:has-text("Interpretation")')));
  check('Hinweis: Messglas als Überrefraktion', await vis('.wb-note:has-text("Überrefraktion")'));
  await page.click('[data-testid="fluo-3d"]');
  await page.waitForTimeout(500);
  check('3D-Fluoreszeinmodus', (await S()).view === 'fluorescein');
  const sel = page.locator('[data-testid="cl-material"] select, select[data-testid="cl-material"]').first();
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
  const next = opts.find((o) => o.includes('fsa-hyper')) ?? opts[opts.length - 1];
  await sel.selectOption(next);
  await page.waitForTimeout(300);
  const mat = await page.evaluate(() => window.__oel.getState().doc.elements.find((e) => !!e.contact).medium);
  check('Material gewechselt', JSON.stringify(mat).includes(next), `${next}`);
  check('Dk/t wird angezeigt', await vis('text=Dk/t'));
  await shot('05_fluo');
});

// 7) Speichern und neu laden
await safe('Speichern / Neuladen', async () => {
  const before = await S();
  await page.keyboard.press('Control+S');
  await page.waitForFunction(() => !window.__oel.getState().dirty, null, { timeout: 10000 });
  await page.reload();
  await page.waitForFunction(() => !!window.__oel?.getState().simId && !!document.querySelector('.viewport canvas'), null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const after = await S();
  check('Arbeitsbereich nach Neuladen wiederhergestellt', after.wb === before.wb, `${after.wb}`);
  check('Messglas nach Neuladen vorhanden', !!after.trial && after.trial.id === before.trial?.id);
  check('Skiaskop nach Neuladen vorhanden', !!after.scope);
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem('oel:v3:sim:' + id) ?? 'null'), after.simId);
  check('Gespeichert mit Schema v3', saved?.schemaVersion === 3 || saved?.doc?.schemaVersion === 3);
});

// 8) Training: unbekannter Patient, Werte verborgen, Auswertung
await safe('Training', async () => {
  await page.click('[data-testid="workbench-retinoscopy"]');
  await page.click('[data-testid="start-training"]');
  await page.waitForTimeout(500);
  check('Trainingsfall aktiv', await page.evaluate(() => !!window.__oel.getState().doc.training?.hidden));
  check('Refraktion in der Maßkette verborgen', /verborgen/.test((await page.textContent('[data-testid="residual-rx"]')) ?? ''));
  await page.click('[data-testid="evaluate"]');
  check('Auswertung mit Rechenweg', await vis('[data-testid="evaluation"]'));
  await shot('06_training');
});

// 9) Standard/Experte
await safe('Expertenmodus', async () => {
  await page.click('[data-testid="expert-toggle"]');
  const on = await page.evaluate(() => window.__oel.getState().prefs.expertMode);
  check('Expertenmodus umschaltbar', on === true);
  await page.click('[data-testid="expert-toggle"]');
});

// 10) Inspector-Reiter
await safe('Inspector', async () => {
  await page.evaluate(() => window.__oel.getState().select(window.__oel.getState().doc.eye.id));
  await page.click('[data-testid="insp-tab-fach"]');
  check('Fachinfo-Reiter', await vis('.panel--right .panel__scroll *'));
  await page.click('[data-testid="insp-tab-tools"]');
  check('Werkzeug-Reiter', await vis('.tool-card'));
  await page.click('[data-testid="insp-tab-props"]');
});

check('Keine Laufzeitfehler in der Konsole', !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')), logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')).slice(0, 3).join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} bestanden`);
console.log('\n--- Konsole ---\n' + [...new Set(logs)].join('\n'));
await browser.close();
