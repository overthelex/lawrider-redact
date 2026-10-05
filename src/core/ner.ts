import type { Kind, Span } from './types.js';

/** One token as the transformers.js token-classification pipeline returns it. */
export interface TokenTag { entity: string; score: number; index: number; word: string }
export type Classifier = (text: string) => Promise<TokenTag[]>;

const KIND: Record<string, Kind | undefined> = { PER: 'PERSON', ORG: 'ORG', LOC: 'LOCATION' };
const MIN_SCORE = 0.5;
const CHUNK = 1200; // characters; well under the model's 512-token window

/** Split on sentence or line ends so no entity is cut in half; returns [offset, text] pairs. */
export function chunks(text: string, size = CHUNK): [number, string][] {
  const out: [number, string][] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + size, text.length);
    if (end < text.length) {
      const window = text.slice(at, end);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (cut > size / 3) end = at + cut + 1;
    }
    out.push([at, text.slice(at, end)]);
    at = end;
  }
  return out;
}

/**
 * The pipeline gives words without character offsets, so walk the text and find each word
 * in order. WordPiece continuations arrive as "##riya" and attach to the previous piece.
 */
export function align(text: string, tags: TokenTag[]): { start: number; end: number; tag: TokenTag }[] {
  const out: { start: number; end: number; tag: TokenTag }[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  for (const tag of [...tags].sort((a, b) => a.index - b.index)) {
    const piece = tag.word.replace(/^##/, '');
    if (!piece) continue;
    const at = lower.indexOf(piece.toLowerCase(), cursor);
    if (at < 0) continue;
    out.push({ start: at, end: at + piece.length, tag });
    cursor = at + piece.length;
  }
  return out;
}

/** Group aligned B-/I- tags into entities. Adjacent pieces of one word always merge. */
export function group(text: string, aligned: ReturnType<typeof align>): Span[] {
  const spans: Span[] = [];
  let cur: { kind: Kind; start: number; end: number; scores: number[] } | null = null;
  const flush = () => {
    if (cur && cur.scores.reduce((a, b) => a + b, 0) / cur.scores.length >= MIN_SCORE) {
      spans.push({ start: cur.start, end: cur.end, kind: cur.kind, text: text.slice(cur.start, cur.end), source: 'ner',
        score: Math.min(...cur.scores) });
    }
    cur = null;
  };
  for (const { start, end, tag } of aligned) {
    const [bio, label] = tag.entity.split('-');
    const kind = KIND[label];
    const continuesWord = tag.word.startsWith('##');
    if (!kind) { if (!continuesWord) flush(); continue; }
    const gap = cur ? text.slice(cur.end, start) : '';
    const joins = cur && (continuesWord || (cur.kind === kind && bio === 'I' && /^[\s&,.'’-]{0,3}$/.test(gap)) ||
      (cur.kind === kind && /^\s*(?:and|&|of)?\s*$/.test(gap) && bio === 'I'));
    if (cur && joins) {
      cur.end = end;
      cur.scores.push(tag.score);
    } else {
      flush();
      cur = { kind, start, end, scores: [tag.score] };
    }
  }
  flush();
  return spans;
}

/**
 * The model was trained on ordinary case and guesses wildly on headings in capitals
 * ("TAX FREE" -> a person). Lines in capitals go to the model in Title Case; the length
 * is unchanged, so offsets still point into the original text.
 */
export function titleCaseCapsLines(text: string): string {
  return text.replace(/^[^a-z\n]*[A-Z]{2}[^a-z\n]*$/gm, (line) =>
    line.toLowerCase().replace(/(^|[\s(“"'‘-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()));
}

export async function nerSpans(text: string, classify: Classifier): Promise<Span[]> {
  const out: Span[] = [];
  for (const [offset, original] of chunks(text)) {
    const part = titleCaseCapsLines(original);
    const tags = await classify(part);
    for (const s of group(part, align(part, tags))) {
      out.push({ ...s, start: s.start + offset, end: s.end + offset, text: original.slice(s.start, s.end) });
    }
  }
  return out;
}
