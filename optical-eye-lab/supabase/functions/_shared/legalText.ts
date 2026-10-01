/**
 * Rechtstexte: interne Prüfhinweise von der kundenseitigen Fassung trennen.
 *
 * `[Prüfhinweis: …]` sind ausschließlich interne Hinweise für den Betreiber. Sie dürfen im gespeicherten
 * Original stehen (Vertragscenter zeigt sie vollständig), aber NIE in einer Ausgabe an Kunden erscheinen.
 *
 * Diese Datei ist die EINZIGE Umsetzung in TypeScript – sie wird von den Edge Functions (Deno) und vom
 * Browser (src/cloud/legal.ts) importiert und hat deshalb keine Abhängigkeiten. Die Datenbank hat dieselbe
 * Regel als SQL-Funktion `public.legal_public_text()` (Migration 20261005090000); beide werden in
 * tests/legaltext.unit.test.ts bzw. tests/db/legalreview.test.ts gegen dieselben Beispiele geprüft.
 *
 * Regel:
 *  - Ein Prüfhinweis beginnt mit „[Prüfhinweis“ und endet an der passenden „]“ (eine Ebene innerer
 *    Klammern wie „[1]“ ist erlaubt). Leerzeichen/Tabs davor werden mit entfernt, am Zeilenanfang auch die danach.
 *  - Fehlt die schließende Klammer, wird bis zum Zeilenende entfernt (lieber zu viel als ein Leck).
 *  - Enthält ein Text KEINEN Prüfhinweis, bleibt er Zeichen für Zeichen unverändert (wichtig für Prüfsummen
 *    bereits veröffentlichter Versionen).
 *  - Sonst: durch das Entfernen entstandene Mehrfach-Leerzeilen werden auf eine Leerzeile reduziert,
 *    Leerraum am Anfang/Ende entfernt.
 */

export const REVIEW_MARKER = '[Prüfhinweis';

/** Hinweis am Zeilenanfang (samt folgender Leerzeichen); erlaubt eine Ebene innerer [ … ] */
const REVIEW_BLOCK_LINESTART = /(^|\n)[ \t]*\[Prüfhinweis(?:[^[\]]|\[[^[\]]*\])*\][ \t]*/g;
/** Hinweis mitten im Satz (samt vorangehender Leerzeichen – das Leerzeichen danach trennt die Wörter weiter) */
const REVIEW_BLOCK_INLINE = /[ \t]*\[Prüfhinweis(?:[^[\]]|\[[^[\]]*\])*\]/g;
/** nicht geschlossener Hinweis: bis zum Zeilenende */
const REVIEW_UNCLOSED = /[ \t]*\[Prüfhinweis[^\n]*/g;

export const hasReviewMarkers = (text: string | null | undefined): boolean => !!text && text.includes(REVIEW_MARKER);
export const countReviewMarkers = (text: string | null | undefined): number => (text ? text.split(REVIEW_MARKER).length - 1 : 0);

/** Kundenseitige Fassung eines Rechtstext-Feldes (Inhalt, Titel, Checkbox-Text). */
export function publicLegalText(text: string): string;
export function publicLegalText(text: string | null): string | null;
export function publicLegalText(text: string | null | undefined): string | null | undefined;
export function publicLegalText(text: string | null | undefined): string | null | undefined {
  if (text == null || !text.includes(REVIEW_MARKER)) return text;
  return text
    .replace(REVIEW_BLOCK_LINESTART, '$1')
    .replace(REVIEW_BLOCK_INLINE, '')
    .replace(REVIEW_UNCLOSED, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Text, über den die Prüfsumme (content_hash) einer Version gebildet wird – genau die Fassung, die Kunden
 * sehen und der sie zustimmen. Gleich aufgebaut wie in public.admin_legal_activate().
 */
export const legalHashInput = (title: string, checkboxLabel: string | null, content: string): string =>
  `${publicLegalText(title)}\n${publicLegalText(checkboxLabel) ?? ''}\n${publicLegalText(content)}`;
