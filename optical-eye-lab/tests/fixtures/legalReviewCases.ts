/**
 * Gemeinsame Beispiele für das Entfernen interner Prüfhinweise – geprüft gegen die TypeScript-Umsetzung
 * (supabase/functions/_shared/legalText.ts) UND die SQL-Funktion public.legal_public_text().
 * Beide müssen für jedes Beispiel exakt dasselbe Ergebnis liefern.
 */
export const REVIEW_CASES: { name: string; input: string | null; expected: string | null }[] = [
  { name: 'ohne Hinweis: unverändert (auch Leerraum am Ende)', input: '# AGB\n\n## 1. Geltung\n\nText.  \n\n\n\nEnde\n', expected: '# AGB\n\n## 1. Geltung\n\nText.  \n\n\n\nEnde\n' },
  { name: 'null bleibt null', input: null, expected: null },
  { name: 'eigener Absatz', input: '## 1. Geltung\n\nText.\n\n[Prüfhinweis: Bestellbutton prüfen lassen.]\n\n## 2. Preise\n\nAlle Preise.', expected: '## 1. Geltung\n\nText.\n\n## 2. Preise\n\nAlle Preise.' },
  { name: 'mitten im Satz', input: 'Der Vertrag beginnt [Prüfhinweis: Zeitpunkt klären] mit der Freischaltung.', expected: 'Der Vertrag beginnt mit der Freischaltung.' },
  { name: 'am Zeilenanfang vor Text', input: 'A\n[Prüfhinweis: x] Satz geht weiter.\nB', expected: 'A\nSatz geht weiter.\nB' },
  { name: 'innere Klammern', input: 'Text.\n\n[Prüfhinweis: siehe § 312j [Abs. 3] BGB]\n\nWeiter.', expected: 'Text.\n\nWeiter.' },
  { name: 'mehrere Hinweise hintereinander', input: 'A\n\n[Prüfhinweis: eins]\n[Prüfhinweis: zwei]\n\nB [Prüfhinweis: drei]', expected: 'A\n\nB' },
  { name: 'nicht geschlossen: bis Zeilenende', input: 'A\n\n[Prüfhinweis: vergessen zu schließen\n\nB', expected: 'A\n\nB' },
  { name: 'nur Hinweis → leer', input: '[Prüfhinweis: alles offen]', expected: '' },
  { name: 'Checkbox-Text mit Hinweis', input: 'Ich habe die {link} gelesen. [Prüfhinweis: Formulierung prüfen]', expected: 'Ich habe die {link} gelesen.' },
  { name: 'Aufzählung bleibt eingerückt', input: '- Punkt 1\n  - Unterpunkt [Prüfhinweis: ok?]\n- Punkt 2', expected: '- Punkt 1\n  - Unterpunkt\n- Punkt 2' },
  { name: 'Hinweis über zwei Zeilen', input: 'A\n\n[Prüfhinweis: erste Zeile\nzweite Zeile]\n\nB', expected: 'A\n\nB' },
];
