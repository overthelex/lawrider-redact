import type { Kind, Span } from './types.js';

/**
 * Pattern rules for identifiers whose shape is fixed in the UK. They run before the NER
 * model and win over it on overlap, because a shape match is certain and a model guess
 * is not. Dates and statute references are deliberately NOT masked: they are what a
 * legal question is about and carry no identity on their own.
 */
interface Rule { kind: Kind; re: RegExp; group?: number }

const COMPANY_SUFFIX = String.raw`(?:Limited|LIMITED|Ltd\.?|LTD\.?|LLP|L\.L\.P\.|PLC|plc|P\.L\.C\.|LP|Inc\.?|LLC|GmbH|S\.A\.|B\.V\.|N\.V\.)`;
// A capitalised word that is not itself a suffix, so "Acme Limited and Beta Ltd" stays two names.
const CAP = String.raw`(?!(?:Limited|LIMITED|Ltd|LTD|LLP|PLC|plc)\b)[A-Z][\w'’&.-]*`;
// "and" and "the" are left out on purpose: "The Tenant and Acme Limited" must not become one
// name. The NER model catches names such as "Marks and Spencer" instead.
const COMPANY_TOKEN = String.raw`(?:${CAP}|\((?:UK|U\.K\.|Holdings|Group)\)|&|of|for)`;

export const RULES: Rule[] = [
  { kind: 'EMAIL', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  // Companies House number after its label: 8 digits, or 2 letters + 6 digits (SC, NI, OC...).
  {
    kind: 'COMPANY_NO',
    re: /\b(?:company|registered|registration)\s+(?:number|no\.?)\s*:?\s*((?:[A-Z]{2}\d{6}|\d{8}))\b/gi,
    group: 1,
  },
  // National Insurance number: two letters (not D, F, I, Q, U, V; second not O), six digits, A-D.
  { kind: 'NINO', re: /\b(?![DFIQUV])[A-Z](?![DFIQUVO])[A-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g },
  { kind: 'SORT_CODE', re: /\b\d{2}-\d{2}-\d{2}\b/g },
  { kind: 'ACCOUNT', re: /\b(?:account|a\/c)\s*(?:number|no\.?)?\s*:?\s*(\d{8})\b/gi, group: 1 },
  // UK phone numbers: +44 or 0, then 9-10 more digits with optional spaces or brackets.
  { kind: 'PHONE', re: /(?<![\w+])(?:\+44\s?\(?0?\)?\s?|\(?0)[1-9]\d{1,3}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g },
  // Postcodes: the full Royal Mail shape, including GIR 0AA.
  { kind: 'POSTCODE', re: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g },
  // A street address line: a number and a street word.
  {
    kind: 'ADDRESS',
    re: /\b\d{1,4}[A-Za-z]?,?\s+(?:[A-Z][a-z'’]+\s){1,4}(?:Road|Street|Lane|Avenue|Square|Row|Place|Court|Close|Drive|Gardens|Terrace|Way|Hill|Park|Crescent|Walk|Mews|Grove|Wharf|Yard|Circus|Embankment|Parade|Rise)\b/g,
  },
  { kind: 'COMPANY', re: new RegExp(String.raw`\b${CAP}(?:[ \t]+${COMPANY_TOKEN}){0,7}[ \t]+${COMPANY_SUFFIX}(?![\w])`, 'g') },
];

/** Leading words a company match must not start with: connectives and document headings. */
const LEAD_STOP = /^(?:and|of|the|for|between|by|to|with|from|in|on|at|this|dated|as|amended|exhibit|schedule|annex|appendix|agreement|deed|lease|contract|parties|party|executed|signed)\b[ \t]*/i;

/** Heading words that run into a company name written in capitals ("RULES OF THE X PLC"). */
const CAPS_HEADING = /^(?:RULES|PLAN|TERMS|CONDITIONS|ARTICLES|MEMORANDUM|MINUTES|RESOLUTIONS?|WRITTEN|SPECIAL|ORDINARY|NOTICE|MEETING|BOARD|SHARE|OPTION|SCHEME|POLICY|CERTIFICATE|FORM|DATED|BETWEEN|AND|OF|THE|FOR|IN|ON|BY|TO)\b[ \t]*/;

export function ruleSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      let value = rule.group ? m[rule.group] : m[0];
      let start = rule.group ? m.index + m[0].lastIndexOf(value) : m.index;
      if (rule.kind === 'COMPANY') {
        // A sentence boundary inside the match means a heading ran into the name: keep the tail.
        const parts = value.split(/\.[ \t]+(?=[A-Z])/);
        if (parts.length > 1) {
          const tail = parts[parts.length - 1];
          start += value.length - tail.length;
          value = tail;
        }
        while (LEAD_STOP.test(value) || (value === value.toUpperCase() && CAPS_HEADING.test(value))) {
          const re = LEAD_STOP.test(value) ? LEAD_STOP : CAPS_HEADING;
          const cut = value.match(re)![0].length;
          value = value.slice(cut);
          start += cut;
        }
      }
      if (!value || (rule.kind === 'COMPANY' && !/[ \t]/.test(value.trim()))) continue;
      out.push({ start, end: start + value.length, kind: rule.kind, text: value, source: 'rule' });
    }
  }
  return out;
}

/** Spans for terms the user always wants masked (client and matter names), whole words, any case. */
export function listSpans(text: string, terms: string[]): Span[] {
  const out: Span[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (t.length < 2) continue;
    const re = new RegExp(String.raw`(?<![\w])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w])`, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'TERM', text: m[0], source: 'list' });
    }
  }
  return out;
}

const PRIORITY: Record<Span['source'], number> = { list: 3, rule: 2, ner: 1 };

/**
 * Resolve overlaps: the user's list beats rules, rules beat the model; within a source the
 * longer span wins. Returns non-overlapping spans in text order.
 */
export function resolve(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) =>
    PRIORITY[b.source] - PRIORITY[a.source] || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: Span[] = [];
  for (const s of sorted) {
    if (kept.every((k) => s.end <= k.start || s.start >= k.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}
