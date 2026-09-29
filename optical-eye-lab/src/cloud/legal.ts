/**
 * Rechtstexte im Browser (Phase 8) – reine, testbare Hilfen.
 *
 * - Die Texte selbst und die Checkbox-Formulierungen kommen aus dem Vertragscenter (Datenbank). Im Code
 *   stehen nur neutrale Oberflächen-Vorlagen als Rückfall, falls ein Dokument keinen eigenen
 *   Checkbox-Text hat – keine juristischen Formulierungen.
 * - Inhalte werden als einfaches Markdown dargestellt (Überschriften, Absätze, Listen, **fett**),
 *   ohne HTML-Ausgabe (kein dangerouslySetInnerHTML → keine Skript-Einschleusung über Rechtstexte).
 */
import type { LegalAudience, LegalConsentType, LegalDocRef, InstitutionType } from './types';

/** Neutrale Vorlagen der Checkbox-Beschriftung ({link} = verlinkter Dokumenttitel) */
export const DEFAULT_CHECKBOX_TEMPLATE: Record<LegalConsentType, string> = {
  accepted: 'Ich akzeptiere die {link}.',
  acknowledged: 'Ich habe die {link} zur Kenntnis genommen.',
  agreed: '{link}',
};

export interface ConsentLabel {
  before: string;
  linkText: string | null;
  after: string;
}

/** Beschriftung einer Zustimmung: eigener Text aus dem Vertragscenter oder neutrale Vorlage */
export function consentLabel(doc: Pick<LegalDocRef, 'title' | 'checkboxLabel' | 'consentType'>): ConsentLabel {
  const tpl = doc.checkboxLabel?.trim() || (doc.consentType ? DEFAULT_CHECKBOX_TEMPLATE[doc.consentType] : '{link}');
  const i = tpl.indexOf('{link}');
  if (i < 0) return { before: tpl, linkText: null, after: '' };
  return { before: tpl.slice(0, i), linkText: doc.title, after: tpl.slice(i + '{link}'.length) };
}

/** Pflicht-Zustimmungen (Checkboxen) vs. reine Verweise (z. B. Widerrufsformular) */
export const requiredDocs = (docs: LegalDocRef[]) => docs.filter((d) => d.required);
export const infoDocs = (docs: LegalDocRef[]) => docs.filter((d) => !d.required);
export const allConsentsGiven = (docs: LegalDocRef[], checked: ReadonlySet<string>) => requiredDocs(docs).every((d) => checked.has(d.id));

export const audienceFor = (t: InstitutionType): Exclude<LegalAudience, 'all'> => (t === 'private' ? 'b2c' : 'b2b');

/** Link auf GENAU die angezeigte Version */
export const legalDocPath = (id: string) => `/legal/doc/${encodeURIComponent(id)}`;

/* ------------------------------ Einfaches Markdown ------------------------------ */

export type Inline = { text: string; bold?: boolean };
export type Block = { kind: 'h1' | 'h2' | 'h3' | 'p'; inline: Inline[] } | { kind: 'ul'; items: Inline[][] } | { kind: 'ol'; items: Inline[][] };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: '' }];
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: (`h${h[1].length}` as 'h1' | 'h2' | 'h3'), inline: parseInline(h[2]) });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1]));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Nächste Versionsnummer vorschlagen (1.0 → 1.1, 2 → 2.1) */
export function suggestNextVersion(versions: string[]): string {
  const nums = versions
    .map((v) => /^(\d+)(?:\.(\d+))?$/.exec(v))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2] ?? 0)] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!nums.length) return '1.0';
  const [maj, min] = nums[nums.length - 1];
  return `${maj}.${min + 1}`;
}
