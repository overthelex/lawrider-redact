import type { Kind, Span } from './types.js';

const PLACEHOLDER = /\[(PERSON|COMPANY|ORG|LOCATION|ADDRESS|POSTCODE|EMAIL|PHONE|NINO|SORT_CODE|ACCOUNT|IBAN|COMPANY_NO|TERM)_(\d+)\]/g;

/** Same entity, same key: case, spacing and company-suffix spelling do not matter. */
export function normalise(kind: Kind, value: string): string {
  let v = value.toLowerCase().replace(/[\s.,]+/g, ' ').trim();
  if (kind === 'COMPANY') v = v.replace(/\b(?:limited|ltd)$/, 'ltd').replace(/\b(?:plc|p l c)$/, 'plc');
  if (kind === 'POSTCODE' || kind === 'NINO' || kind === 'PHONE' || kind === 'IBAN') v = v.replace(/[\s()+-]/g, '');
  return `${kind}:${v}`;
}

/**
 * One conversation's mapping between real values and placeholders. It lives only in the
 * browser; the serialised form is what goes into chrome.storage.session.
 */
export class Session {
  private byKey = new Map<string, string>();      // normalised value -> placeholder
  private byPlaceholder = new Map<string, string>(); // placeholder -> first original spelling
  private counters = new Map<Kind, number>();

  static from(data: { entries: [string, string, string][] } | undefined): Session {
    const s = new Session();
    for (const [key, ph, original] of data?.entries ?? []) s.add(key, ph, original);
    return s;
  }

  toJSON(): { entries: [string, string, string][] } {
    return { entries: [...this.byKey].map(([k, ph]) => [k, ph, this.byPlaceholder.get(ph)!]) };
  }

  private add(key: string, ph: string, original: string) {
    this.byKey.set(key, ph);
    if (!this.byPlaceholder.has(ph)) this.byPlaceholder.set(ph, original);
    const m = /^\[([A-Z_]+)_(\d+)\]$/.exec(ph)!;
    const kind = m[1] as Kind;
    this.counters.set(kind, Math.max(this.counters.get(kind) ?? 0, Number(m[2])));
  }

  placeholderFor(kind: Kind, value: string): string {
    const key = normalise(kind, value);
    const known = this.byKey.get(key);
    if (known) {
      // Restore with the ordinary spelling, not a heading in capitals ("ACME LIMITED").
      const shown = this.byPlaceholder.get(known)!;
      if (shown === shown.toUpperCase() && value !== value.toUpperCase()) this.byPlaceholder.set(known, value);
      return known;
    }
    const n = (this.counters.get(kind) ?? 0) + 1;
    const ph = `[${kind}_${n}]`;
    this.add(key, ph, value);
    // A person's surname alone ("Mr Smith") should map to the same placeholder.
    if (kind === 'PERSON') {
      const parts = value.trim().split(/\s+/);
      if (parts.length > 1 && parts[parts.length - 1].length >= 3) {
        const aliasKey = normalise('PERSON', parts[parts.length - 1]);
        if (!this.byKey.has(aliasKey)) this.byKey.set(aliasKey, ph);
      }
    }
    return ph;
  }

  /** Surnames of people already seen, so later standalone mentions are masked too. */
  aliasSpans(text: string): Span[] {
    const out: Span[] = [];
    for (const [key, ph] of this.byKey) {
      if (!key.startsWith('PERSON:') || key.includes(' ')) continue;
      const surname = this.byPlaceholder.get(ph)!.trim().split(/\s+/).pop()!;
      if (surname.toLowerCase() !== key.slice(7)) continue;
      const re = new RegExp(String.raw`(?<![\w])${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w])`, 'g');
      for (let m = re.exec(text); m; m = re.exec(text)) {
        out.push({ start: m.index, end: m.index + m[0].length, kind: 'PERSON', text: m[0], source: 'list' });
      }
    }
    return out;
  }

  /** Replace spans (already resolved, non-overlapping) with placeholders. */
  anonymise(text: string, spans: Span[]): string {
    // Full names first, so a surname that appears earlier in the text gets the same placeholder.
    for (const s of spans) if (s.kind === 'PERSON' && /\s/.test(s.text.trim())) this.placeholderFor('PERSON', s.text);
    let out = '';
    let at = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      out += text.slice(at, s.start) + this.placeholderFor(s.kind, s.text);
      at = s.end;
    }
    return out + text.slice(at);
  }

  /** Put the real values back; placeholders the session never issued are left as they are. */
  restore(text: string): string {
    return text.replace(PLACEHOLDER, (ph) => this.byPlaceholder.get(ph) ?? ph);
  }

  entries(): { placeholder: string; value: string }[] {
    return [...this.byPlaceholder].map(([placeholder, value]) => ({ placeholder, value }));
  }
}
