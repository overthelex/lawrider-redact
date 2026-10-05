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

/** Every span to mask in `text`, non-overlapping and in order. */
export async function detect(text: string, opts: DetectOptions = {}): Promise<Span[]> {
  const spans: Span[] = [...ruleSpans(text), ...listSpans(text, opts.terms ?? [])];
  if (opts.classify) spans.push(...(await nerSpans(text, opts.classify)).filter((s) => plausibleName(text, s)));
  if (opts.session) spans.push(...opts.session.aliasSpans(text));
  const allow = new Set((opts.allow ?? []).map((a) => a.trim().toLowerCase()));
  return resolve(spans).filter((s) => !allow.has(s.text.trim().toLowerCase()));
}
