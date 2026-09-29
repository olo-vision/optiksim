/**
 * Prüfung der Stripe-Webhook-Signatur (Header "Stripe-Signature": t=<unix>,v1=<hex>[,v1=…]).
 * Signiert wird `${t}.${rawBody}` mit HMAC-SHA256 und dem Endpoint-Secret (whsec_…).
 * https://docs.stripe.com/webhooks#verify-manually
 *
 * WebCrypto → läuft in Deno (Edge Functions) und Node ≥ 20 (Tests).
 */

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vergleich in konstanter Zeit (keine frühe Rückkehr beim ersten Unterschied) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  /** erlaubte Abweichung des Zeitstempels (Replay-Schutz), Standard 300 s wie Stripe */
  toleranceSec?: number;
  nowSec?: number;
}

export async function verifyStripeSignature(payload: string, header: string | null | undefined, secret: string | null | undefined, opts: VerifyOptions = {}): Promise<boolean> {
  if (!header || !secret) return false;
  let t = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  if (!Number.isFinite(t) || !signatures.length) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  let ok = false;
  for (const s of signatures) ok = safeEqual(s, expected) || ok;
  return ok;
}

/** Nur für Tests/Werkzeuge: gültigen Signatur-Header erzeugen */
export async function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}
