/**
 * Laufzeit-Test der ECHTEN Edge Functions unter Deno (inkl. _shared/deps.ts und @supabase/server)
 * gegen einen nachgebauten Supabase-Server. Prüft das Sicherheitsmodell:
 *
 *  - Identität: Benutzer-JWT wird geprüft (JWKS/ES256 lokal, Rückfall Auth-Server für HS256).
 *    Gefälschte/fehlende Token → 401, ohne dass die Datenbank angefragt wird.
 *  - Datenbank: ausschließlich mit dem Secret Key (apikey = sb_secret_…); der Benutzer-JWT gelangt NIE in
 *    eine /rest/v1-Anfrage (sonst liefe sie als authenticated/anon → „permission denied“).
 *  - Institution und Stripe-Kunde kommen aus der Datenbank, nicht aus dem Request.
 *  - Webhook: ohne JWT erreichbar, aber nur mit Signatur; DB-Operationen über den Admin-Client.
 *
 * Aufruf: `npm run test:edge` (benötigt `deno` im PATH oder DENO_BIN=/pfad/zu/deno).
 * Stripe selbst wird nicht erreicht (kein Schlüssel) – der Test endet dort bewusst mit 502.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fnDir = join(root, 'supabase', 'functions');
const DENO = process.env.DENO_BIN ?? 'deno';
const SECRET = 'sb_secret_testserverkey000000000000';
const PUBLISHABLE = 'sb_publishable_testpublickey0000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_INST = '99999999-9999-4999-8999-999999999999';
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);

/* ------------------------------ Schlüssel / Token ------------------------------ */
const b64u = (b) => Buffer.from(b).toString('base64url');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'ES256', use: 'sig' };
let BASE = '';
function es256(payload, kid = 'test-key-1', key = privateKey) {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const p = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}
function hs256(payload, secret = 'legacy-jwt-secret') {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (extra = {}) => ({ sub: USER_ID, email: 'anna@optik.de', role: 'authenticated', aud: 'authenticated', iss: `${BASE}/auth/v1`, iat: now(), exp: now() + 3600, amr: [{ method: 'password', timestamp: now() }], ...extra });

/* ------------------------------ Supabase-Nachbau ------------------------------ */
const log = [];
let legacyToken = '';
let customerRow = { stripe_customer_id: 'cus_own_institution' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const entry = { method: req.method, path: url.pathname, query: url.search, apikey: req.headers.apikey ?? null, authorization: req.headers.authorization ?? null, body };
    log.push(entry);
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/auth/v1/.well-known/jwks.json') return send(200, { keys: [jwk] });
    if (url.pathname === '/auth/v1/user') {
      if (req.headers.authorization === `Bearer ${legacyToken}` && legacyToken) return send(200, { id: USER_ID, email: 'anna@optik.de', role: 'authenticated', aud: 'authenticated' });
      return send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const isService = req.headers.apikey === SECRET;
      return isService ? send(200, {}) : send(401, { msg: 'not admin' });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      // wie Supabase nach der Rechte-Umstellung: nur der Secret Key (service_role) darf lesen
      const auth = req.headers.authorization;
      const isService = req.headers.apikey === SECRET && (!auth || auth === `Bearer ${SECRET}`);
      if (!isService) return send(401, { code: '42501', message: 'permission denied for table ' + url.pathname.split('/').pop() });
      const table = url.pathname.slice('/rest/v1/'.length);
      // PostgREST: Objekt-Antwort nur bei Accept vnd.pgrst.object, sonst Liste
      const asObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
      const rows = (list) => (asObject ? (list.length === 1 ? send(200, list[0]) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${list.length} rows` })) : send(200, list));
      if (table === 'profiles') return rows(url.search.includes(`user_id=eq.${USER_ID}`) ? [{ user_id: USER_ID, email: 'anna@optik.de', role: 'institution_admin', institution_id: 'inst-own' }] : []);
      if (table === 'institutions') return rows(url.search.includes('id=eq.inst-own') ? [{ id: 'inst-own', type: 'business', name: 'Optik Auge GmbH' }] : []);
      if (table === 'licenses') return rows([{ status: 'pending', source: 'stripe' }]);
      if (table === 'subscriptions') return rows([]);
      if (table === 'billing_customers') return rows(url.search.includes('institution_id=eq.inst-own') && customerRow ? [customerRow] : []);
      if (table === 'rpc/checkout_consent_check') return send(200, { ok: true, outdated: false, missing: [] });
      if (table === 'rpc/stripe_event_begin') return send(200, true);
      if (table === 'rpc/stripe_event_claim') return send(200, 'start');
      if (table === 'rpc/throttle_hit') return send(200, true);
      if (table === 'rpc/declaration_confirmations_pending') return send(200, []);
      if (table === 'rpc/declaration_mark_confirmed') return send(200, null);
      if (table === 'rpc/stripe_event_finish') return send(200, null);
      // Rechtsbetrieb (consumer-request, mail-jobs)
      if (table === 'rpc/consumer_declaration_record') return send(200, { id: '00000000-0000-4000-8000-000000000001', received_at: new Date().toISOString(), recent_count: 0, account: null, subscription: null });
      if (table === 'rpc/consumer_declaration_update') return send(200, null);
      if (table === 'rpc/system_mail_log') return send(200, true);
      if (table === 'rpc/contract_confirmation_pending') return send(200, []);
      if (table === 'rpc/renewal_reminder_candidates') return send(200, []);
      // 0.10.0 Kontolöschung
      if (table === 'rpc/delete_account_data') return send(200, { ok: true, email: 'anna@optik.de', institution_id: 'inst-own' });
      return send(404, { message: 'unknown ' + table });
    }
    send(404, {});
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------ minimaler SMTP-Server (Klartext, AUTH PLAIN/LOGIN) ------------------------------ */
async function startFakeSmtp() {
  const net = await import('node:net');
  const messages = [];
  const state = { auth: false };
  const srv = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    let cur = { rcpt: [], data: '' };
    let authStep = 0;
    const w = (l) => sock.write(l + '\r\n');
    w('220 fake.smtp ESMTP');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(cur);
            cur = { rcpt: [], data: '' };
            w('250 OK queued');
          } else cur.data += line + '\n';
          continue;
        }
        if (authStep === 1) { authStep = 2; w('334 UGFzc3dvcmQ6'); continue; }
        if (authStep === 2) { authStep = 0; state.auth = true; w('235 Authentication successful'); continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { w('250-fake.smtp'); w('250-AUTH PLAIN LOGIN'); w('250 8BITMIME'); }
        else if (cmd === 'HELO') w('250 fake.smtp');
        else if (cmd === 'AUTH') {
          if (/^AUTH PLAIN \S+/i.test(line)) { state.auth = true; w('235 Authentication successful'); }
          else if (/^AUTH LOGIN/i.test(line)) { authStep = 1; w('334 VXNlcm5hbWU6'); }
          else w('334 ');
        } else if (cmd === 'MAIL') w('250 OK');
        else if (cmd === 'RCPT') { cur.rcpt.push(line); w('250 OK'); }
        else if (cmd === 'DATA') { inData = true; w('354 End data with <CR><LF>.<CR><LF>'); }
        else if (cmd === 'QUIT') { w('221 Bye'); sock.end(); }
        else if (cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
        else w('502 Command not implemented');
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, messages, get auth() { return state.auth; }, close: () => srv.close() };
}

/* ------------------------------ Function unter Deno starten ------------------------------ */
async function startFunction(name, port, extraEnv = {}) {
  const child = spawn(DENO, ['run', '--quiet', '--allow-env', '--allow-net', '--allow-read', `--config=${join(fnDir, name, 'deno.json')}`, join(fnDir, name, 'index.ts')], {
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: BASE,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
      STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_edge_test',
      SITE_URL: 'http://localhost:5173',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { method: 'OPTIONS' });
      return { child, output: () => out };
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  child.kill();
  throw new Error(`${name} startet nicht:\n${out}`);
}
const call = async (port, { token, body = {}, headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const restCalls = () => log.filter((e) => e.path.startsWith('/rest/v1/'));
const clearLog = () => (log.length = 0);
const noUserJwtInRest = (tokens) => restCalls().every((e) => !tokens.some((t) => (e.authorization ?? '').includes(t)) && e.apikey === SECRET);

// Deno.serve nutzt standardmäßig Port 8000; PORT wird von der Edge Runtime gesetzt – lokal über --port nicht verfügbar,
// daher nacheinander auf 8000.
const PORT = 8000;
const validToken = es256(claims());

try {
  /* ---------- create-checkout-session ---------- */
  let fn = await startFunction('create-checkout-session', PORT);

  clearLog();
  let r = await call(PORT, {});
  check('Checkout ohne Token → 401', r.status === 401);
  check('… ohne Datenbankzugriff', restCalls().length === 0);

  clearLog();
  const { privateKey: evilKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  r = await call(PORT, { token: es256(claims(), 'test-key-1', evilKey), body: { plan: 'business' } });
  check('Gefälschter JWT (falscher Schlüssel) → 401', r.status === 401, JSON.stringify(r.json));
  check('… ohne Datenbankzugriff', restCalls().length === 0);

  clearLog();
  r = await call(PORT, { token: es256(claims({ exp: now() - 60 })), body: { plan: 'business' } });
  check('Abgelaufener JWT → 401', r.status === 401);

  clearLog();
  r = await call(PORT, { token: SECRET, body: { plan: 'business' } });
  check('Secret Key als Bearer wird nicht als Benutzer akzeptiert → 401', r.status === 401);

  clearLog();
  r = await call(PORT, { token: validToken, body: { plan: 'business', institution_id: OTHER_INST, customer: 'cus_foreign', price: 'price_cheap' } });
  const tables = restCalls().map((e) => e.path.replace('/rest/v1/', ''));
  check('Gültiger JWT (ES256/JWKS): Konto über Admin-Client gelesen', ['profiles', 'institutions', 'licenses', 'subscriptions', 'rpc/checkout_consent_check', 'billing_customers'].every((t) => tables.includes(t)), tables.join(','));
  check('Zustimmungsprüfung mit der geprüften User-ID (nicht aus dem Body)', restCalls().some((e) => e.path === '/rest/v1/rpc/checkout_consent_check' && e.body.includes(USER_ID)));
  check('Admin-Client: apikey = Secret Key, Benutzer-JWT nie in DB-Anfragen', noUserJwtInRest([validToken]), JSON.stringify(restCalls().map((e) => [e.path, e.apikey?.slice(0, 10), (e.authorization ?? '').slice(0, 20)])));
  check('Profil über die geprüfte User-ID gesucht', restCalls().some((e) => e.path.endsWith('/profiles') && e.query.includes(`user_id=eq.${USER_ID}`)));
  check('Fremde Institution aus dem Body wird nicht angefragt', !restCalls().some((e) => e.query.includes(OTHER_INST)));
  check('Kein „permission denied“ mehr; Abbruch erst bei Stripe (Test ohne echten Schlüssel)', r.status === 502 && r.json?.code === 'stripe_error', `${r.status} ${JSON.stringify(r.json)}`);

  clearLog();
  legacyToken = hs256(claims());
  r = await call(PORT, { token: legacyToken, body: { plan: 'business' } });
  check('Älterer HS256-JWT: Rückfall auf Auth-Server', log.some((e) => e.path === '/auth/v1/user' && e.apikey === PUBLISHABLE) && r.status === 502, `${r.status}`);
  check('… auch hier Benutzer-JWT nie in DB-Anfragen', noUserJwtInRest([legacyToken]));
  legacyToken = '';

  clearLog();
  r = await call(PORT, { token: hs256(claims(), 'falsches-geheimnis'), body: { plan: 'business' } });
  check('Unbekannter HS256-JWT → 401 (Auth-Server lehnt ab)', r.status === 401 && restCalls().length === 0);
  fn.child.kill();
  await new Promise((r2) => setTimeout(r2, 500));

  /* ---------- Fehlkonfiguration: Publishable Key als Secret ---------- */
  fn = await startFunction('create-checkout-session', PORT, { SUPABASE_SECRET_KEYS: JSON.stringify({ default: PUBLISHABLE }) });
  clearLog();
  r = await call(PORT, { token: validToken, body: { plan: 'business' } });
  check('Publishable Key als Server-Schlüssel wird abgelehnt (500, keine DB-Anfrage)', r.status === 500 && restCalls().length === 0, `${r.status}`);
  check('… Log ohne Schlüssel/Token', !fn.output().includes(PUBLISHABLE) && !fn.output().includes(validToken));
  fn.child.kill();
  await new Promise((r2) => setTimeout(r2, 500));

  /* ---------- create-customer-portal ---------- */
  fn = await startFunction('create-customer-portal', PORT);
  clearLog();
  r = await call(PORT, { token: validToken, body: { customer: 'cus_foreign' } });
  check('Portal: eigener Kunde über Admin-Client ermittelt', restCalls().some((e) => e.path.endsWith('/billing_customers') && e.query.includes('institution_id=eq.inst-own')));
  check('Portal: Benutzer-JWT nie in DB-Anfragen', noUserJwtInRest([validToken]));
  check('Portal: bis Stripe durchgelaufen (502 ohne echten Schlüssel)', r.status === 502, `${r.status} ${JSON.stringify(r.json)}`);
  customerRow = null;
  clearLog();
  r = await call(PORT, { token: validToken, body: { customer: 'cus_foreign' } });
  check('Portal ohne eigenen Kunden → 404 (fremder Kunde aus dem Body wird ignoriert)', r.status === 404);
  customerRow = { stripe_customer_id: 'cus_own_institution' };
  clearLog();
  r = await call(PORT, {});
  check('Portal ohne Token → 401', r.status === 401 && restCalls().length === 0);
  fn.child.kill();
  await new Promise((r2) => setTimeout(r2, 500));

  /* ---------- stripe-webhook ---------- */
  fn = await startFunction('stripe-webhook', PORT);
  clearLog();
  const payload = JSON.stringify({ id: 'evt_edge_1', type: 'customer.subscription.updated', created: now(), data: { object: { id: 'sub_1' } } });
  r = await call(PORT, { body: payload, headers: { 'stripe-signature': 't=1,v1=' + '0'.repeat(64) } });
  check('Webhook: ungültige Signatur → 400, keine DB-Anfrage', r.status === 400 && restCalls().length === 0);
  const t = now();
  const sig = crypto.createHmac('sha256', 'whsec_edge_test').update(`${t}.${payload}`).digest('hex');
  clearLog();
  r = await call(PORT, { body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
  check('Webhook: gültige Signatur ohne JWT → Idempotenz-RPC über Admin-Client', restCalls().some((e) => e.path === '/rest/v1/rpc/stripe_event_claim'));
  check('Webhook: DB-Anfragen nur mit Secret Key', restCalls().every((e) => e.apikey === SECRET));
  check('Webhook: Stripe nicht erreichbar → 500 + Ereignis als fehlgeschlagen markiert (Stripe wiederholt)', r.status === 500 && restCalls().some((e) => e.path === '/rest/v1/rpc/stripe_event_finish' && e.body.includes('failed')), `${r.status}`);
  fn.child.kill();

  /* ---------- consumer-request (ohne JWT) + echter SMTP-Versand unter Deno ---------- */
  const smtp = await startFakeSmtp();
  fn = await startFunction('consumer-request', PORT, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'info@olo-vision.de', SMTP_PASSWORD: 'nicht-echt', MAIL_FROM: 'OLO Vision <info@olo-vision.de>' });
  clearLog();
  r = await call(PORT, { body: { kind: 'cancellation', name: 'Karla', email: 'karla@web.de' } });
  check('Kündigungsbutton: ohne Anmeldung → 200', r.status === 200 && r.json?.ok === true, `${r.status} ${JSON.stringify(r.json)}`);
  check('Kündigungsbutton: Erklärung über Admin-Client gespeichert', restCalls().some((e) => e.path === '/rest/v1/rpc/consumer_declaration_record') && restCalls().every((e) => e.apikey === SECRET));
  if (process.env.SMTP_DEBUG) console.log(JSON.stringify(smtp.messages).slice(0, 3000));
  check('SMTP (nodemailer unter Deno): Bestätigung + Hinweis versendet', smtp.messages.length === 2 && smtp.messages.some((m) => m.rcpt.join(' ').includes('karla@web.de') && m.data.includes('Vorgangsnummer')) && smtp.auth, `${smtp.messages.length} Mails, auth=${smtp.auth}`);
  check('SMTP: Passwort nicht im Log', !fn.output().includes('nicht-echt'));
  r = await call(PORT, { body: { kind: 'cancellation', name: '', email: 'x' } });
  check('Kündigungsbutton: ungültige Eingaben → 422', r.status === 422);
  fn.child.kill();
  await new Promise((r2) => setTimeout(r2, 500));

  /* ---------- delete-account (Benutzer-JWT, frische Anmeldung, „LÖSCHEN“) ---------- */
  fn = await startFunction('delete-account', PORT, { STRIPE_SECRET_KEY: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'info@olo-vision.de', SMTP_PASSWORD: 'nicht-echt', MAIL_FROM: 'OLO Vision <info@olo-vision.de>' });
  clearLog();
  r = await call(PORT, { body: { confirm: 'LÖSCHEN' } });
  check('Löschen ohne Token → 401, ohne DB-Zugriff', r.status === 401 && restCalls().length === 0);
  r = await call(PORT, { token: es256(claims()), body: { confirm: 'ja' } });
  check('Löschen ohne Bestätigungswort → 422', r.status === 422 && r.json?.code === 'confirm_required');
  clearLog();
  // frisch ausgestelltes Token (Refresh), aber letzte Passwort-Anmeldung vor 1 Stunde → nicht ausreichend
  r = await call(PORT, { token: es256(claims({ amr: [{ method: 'password', timestamp: now() - 3600 }] })), body: { confirm: 'LÖSCHEN' } });
  check('Löschen mit alter Anmeldung (auch nach Token-Refresh) → 401 reauth_required, ohne Löschung', r.status === 401 && r.json?.code === 'reauth_required' && !restCalls().some((e) => e.path.includes('delete_account_data')));
  clearLog();
  const mailsBefore = smtp.messages.length;
  r = await call(PORT, { token: es256(claims()), body: { confirm: 'LÖSCHEN', targetUserId: OTHER_INST } });
  check('Fremdes Konto löschen ohne Super-Admin → 403', r.status === 403 && !restCalls().some((e) => e.path.includes('delete_account_data')));
  clearLog();
  r = await call(PORT, { token: es256(claims()), body: { confirm: 'LÖSCHEN' } });
  check('Löschen: 200, Daten-RPC über Admin-Client mit geprüfter User-ID', r.status === 200 && restCalls().some((e) => e.path === '/rest/v1/rpc/delete_account_data' && e.body.includes(USER_ID)) && restCalls().every((e) => e.apikey === SECRET), `${r.status} ${JSON.stringify(r.json)}`);
  check('Löschen: Auth-Benutzer über Admin-API entfernt', log.some((e) => e.path === `/auth/v1/admin/users/${USER_ID}` && e.method === 'DELETE' && e.apikey === SECRET));
  check('Löschen: Bestätigungs-E-Mail an die bisherige Adresse', smtp.messages.length === mailsBefore + 1 && smtp.messages.at(-1).rcpt.join(' ').includes('anna@optik.de'));
  fn.child.kill();
  await new Promise((r2) => setTimeout(r2, 500));

  /* ---------- mail-jobs (nur mit CRON_SECRET) ---------- */
  fn = await startFunction('mail-jobs', PORT, { CRON_SECRET: 'edge-cron-secret-123456' });
  r = await call(PORT, {});
  check('Mail-Jobs ohne Secret → 401', r.status === 401);
  r = await call(PORT, { headers: { 'x-cron-secret': 'edge-cron-secret-123456' } });
  check('Mail-Jobs mit Secret → 200', r.status === 200 && r.json?.reminders?.checked === 0, `${r.status} ${JSON.stringify(r.json)}`);
  fn.child.kill();
  smtp.close();
} catch (e) {
  check('Ablauf', false, String(e.message ?? e).split('\n').slice(0, 6).join(' | '));
} finally {
  server.close();
}

console.log(results.join('\n'));
console.log(`\n${results.filter((x) => x.startsWith('PASS')).length}/${results.length} bestanden`);
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
