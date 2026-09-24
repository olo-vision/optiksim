/**
 * Gemeinsame E2E-Hilfen (Phase 3): frischer Start, Demo-Login, Simulation aus Vorlage öffnen.
 * Hinweis: Die Alt-Einstellung „optical-eye-lab.prefs.v1“ wird bei der Migration als Vorgabe
 * für neue/unkonfigurierte Konten übernommen – so starten Tests mit Qualität „Leistung“
 * (Swiftshader) und ohne Onboarding.
 */
export const BASE = (process.env.E2E_URL ?? 'http://127.0.0.1:5173/').replace(/\/?$/, '/');
export const url = (path) => new URL(path.replace(/^\//, ''), BASE).href;
export const DEMO = { email: 'demo@opticaleyelab.local', password: 'demo' };

export async function resetStorage(page, legacyPrefs = { quality: 'performance', onboardingDone: true }) {
  await page.goto(url('login'));
  await page.evaluate((p) => {
    localStorage.clear();
    if (p) localStorage.setItem('optical-eye-lab.prefs.v1', JSON.stringify(p));
  }, legacyPrefs);
  await page.reload();
  await page.waitForSelector('.login__form', { timeout: 20000 });
}

export async function loginDemo(page) {
  await page.fill('.login__form input[type=email]', DEMO.email);
  await page.fill('.login__form input[type=password]', DEMO.password);
  await page.click('.login__form button[type=submit]');
  await page.waitForURL(/\/(dashboard|simulations)/, { timeout: 20000 });
}

/** Legt eine Simulation aus einer Vorlage an und wartet, bis der Simulator bereit ist. */
export async function openTemplate(page, templateId, settleMs = 3000) {
  await page.goto(url(`simulations/new?template=${templateId}`));
  await page.waitForURL(/\/simulations\/sim_/, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__oel && !!document.querySelector('.viewport canvas') && window.__oel.getState().simId, null, { timeout: 30000 });
  await page.waitForTimeout(settleMs);
}

export async function startFresh(page, templateId = 'tpl-toric-spectacle') {
  // „Seite verlassen?“-Rückfragen (beforeunload) bestätigen, damit Neuladen nie hängen bleibt
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  await resetStorage(page);
  await loginDemo(page);
  if (templateId) await openTemplate(page, templateId);
}
