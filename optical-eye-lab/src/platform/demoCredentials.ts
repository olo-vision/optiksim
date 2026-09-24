/**
 * Lokale Demo-Anmeldedaten.
 *
 * WICHTIG – bewusst KEINE echte Sicherheit:
 *  - Die Daten liegen unverschlüsselt im LocalStorage dieses Browsers.
 *  - Das Passwort wird nur deshalb gehasht (SHA-256 mit Salt), damit es nicht im Klartext
 *    in den Entwicklerwerkzeugen steht. Wer Zugriff auf den Browser hat, hat Zugriff auf alle Daten.
 *  - Für echte Konten ist ein Server-Anbieter vorgesehen (siehe AuthProvider / docs/PHASE3.md).
 */

export interface DemoCredential {
  userId: string;
  email: string;
  salt: string;
  hash: string;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
}

export async function hashDemoPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export async function makeCredential(userId: string, email: string, password: string): Promise<DemoCredential> {
  const salt = randomSalt();
  return { userId, email: email.trim().toLowerCase(), salt, hash: await hashDemoPassword(password, salt) };
}

export async function verifyCredential(c: DemoCredential, password: string): Promise<boolean> {
  return (await hashDemoPassword(password, c.salt)) === c.hash;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
export const MIN_PASSWORD_LENGTH = 4;
