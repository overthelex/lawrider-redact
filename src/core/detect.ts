import { nerSpans, type Classifier } from './ner.js';
import { listSpans, resolve, ruleSpans } from './rules.js';
import type { Session } from './session.js';
import type { Span } from './types.js';

export interface DetectOptions {
  classify?: Classifier; // the local NER model; omitted means rules and lists only
  terms?: string[];      // the user's always-mask list
  allow?: string[];      // values the user chose to leave visible
  session?: Session;     // to catch later mentions of people already seen
}

// Defined terms a contract capitalises ("the Company", "the Landlord"): roles, not identities.
const ROLE_WORDS = new Set(['company', 'group', 'board', 'employee', 'employer', 'landlord', 'tenant', 'buyer', 'seller',
  'purchaser', 'vendor', 'borrower', 'lender', 'guarantor', 'contractor', 'subcontractor', 'client', 'consultant',
  'supplier', 'customer', 'licensor', 'licensee', 'parties', 'party', 'agreement', 'deed', 'lease', 'premises',
  'property', 'building', 'executive', 'director', 'shareholder', 'investor', 'trustee', 'bank', 'agent', 'employment']);

/**
 * The model is a general-purpose tagger: it also tags capitalised contract roles. Keep a
 * model span only if it starts with a capital and is not a single word the same text also
 * uses in lower case or a known role word.
 */
export function plausibleName(text: string, span: Span): boolean {
  if (span.source !== 'ner') return true;
  if (!/^[A-Z]/.test(span.text)) return false;
  const words = span.text.trim().split(/\s+/);
  if (words.length > 1) return !words.every((w) => ROLE_WORDS.has(w.toLowerCase()));
  const w = words[0];
  if (ROLE_WORDS.has(w.toLowerCase()) || w.length < 2) return false;
  return !new RegExp(String.raw`(?<![\w])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w])`).test(text);
}

const HONORIFIC = /^(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Lord|Lady|Rev)\.?\s+/;

/** "Ms Patel" -> "Patel": the title is not the name, and a bare title is no name at all. */
function trimHonorific(s: Span): Span | null {
  if (s.kind !== 'PERSON') return s;
  const m = s.text.match(HONORIFIC);
  if (!m) return /^(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Lord|Lady|Rev)\.?$/.test(s.text.trim()) ? null : s;
  const rest = s.text.slice(m[0].length);
  return rest ? { ...s, start: s.start + m[0].length, text: rest } : null;
}

/** Wherever "Priya Patel" appears, a bare "Patel" elsewhere in the text is the same person. */
function surnameSpans(text: string, people: Span[]): Span[] {
  const out: Span[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const parts = p.text.trim().split(/\s+/);
    const surname = parts[parts.length - 1];
    if (parts.length < 2 || surname.length < 3 || seen.has(surname)) continue;
    seen.add(surname);
    const re = new RegExp(String.raw`(?<![\w])${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w])`, 'g');
    for (const m of text.matchAll(re)) {
      out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'PERSON', text: m[0], source: 'ner', score: p.score });
    }
  }
  return out;
}

/** Every span to mask in `text`, non-overlapping and in order. */
export async function detect(text: string, opts: DetectOptions = {}): Promise<Span[]> {
  const spans: Span[] = [...ruleSpans(text), ...listSpans(text, opts.terms ?? [])];
  if (opts.classify) {
    const found = (await nerSpans(text, opts.classify)).map(trimHonorific)
      .filter((s): s is Span => !!s && plausibleName(text, s));
    spans.push(...found, ...surnameSpans(text, found.filter((s) => s.kind === 'PERSON')));
  }
  if (opts.session) spans.push(...opts.session.aliasSpans(text));
  // Once a value is found anywhere, mask every other occurrence of it too.
  const seen = new Map<string, Span>();
  for (const s of spans) if (s.text.trim().length >= 3 && !seen.has(s.text)) seen.set(s.text, s);
  for (const [value, s] of seen) {
    const re = new RegExp(String.raw`(?<![\w])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w])`, 'g');
    for (const m of text.matchAll(re)) spans.push({ ...s, start: m.index!, end: m.index! + m[0].length, text: m[0], source: 'ner' });
  }
  const allow = new Set((opts.allow ?? []).map((a) => a.trim().toLowerCase()));
  // Never mask inside a placeholder we issued earlier ("[PERSON_1]" must not become "[ORG_1]").
  const issued: [number, number][] = [];
  for (const m of text.matchAll(/\[[A-Z_]+_\d+\]/g)) issued.push([m.index!, m.index! + m[0].length]);
  return resolve(spans).filter((s) => !allow.has(s.text.trim().toLowerCase()) &&
    issued.every(([a, b]) => s.end <= a || s.start >= b));
}
