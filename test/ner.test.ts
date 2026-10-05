import { describe, expect, it } from 'vitest';
import { align, chunks, group, nerSpans } from '../src/core/ner.js';

const s = 'between John Smith of London and Marks and Spencer Group, by Priya Patel.';
const tags = [
  { entity: 'B-PER', score: 0.99, index: 2, word: 'John' },
  { entity: 'I-PER', score: 0.99, index: 3, word: 'Smith' },
  { entity: 'B-LOC', score: 0.99, index: 5, word: 'London' },
  { entity: 'B-ORG', score: 0.53, index: 7, word: 'Marks' },
  { entity: 'I-ORG', score: 0.9, index: 8, word: 'and' },
  { entity: 'I-ORG', score: 0.9, index: 9, word: 'Spencer' },
  { entity: 'I-ORG', score: 0.9, index: 10, word: 'Group' },
  { entity: 'B-PER', score: 0.99, index: 13, word: 'P' },
  { entity: 'B-PER', score: 0.99, index: 14, word: '##riya' },
  { entity: 'I-PER', score: 0.99, index: 15, word: 'Patel' },
];

describe('ner grouping', () => {
  it('groups B/I pieces into whole entities with offsets', () => {
    const spans = group(s, align(s, tags));
    expect(spans.map((x) => [x.kind, x.text])).toEqual([
      ['PERSON', 'John Smith'], ['LOCATION', 'London'], ['ORG', 'Marks and Spencer Group'], ['PERSON', 'Priya Patel'],
    ]);
    for (const x of spans) expect(s.slice(x.start, x.end)).toBe(x.text);
  });

  it('drops weak entities', () => {
    const weak = [{ entity: 'B-PER', score: 0.3, index: 1, word: 'John' }];
    expect(group(s, align(s, weak))).toEqual([]);
  });

  it('chunks long text on sentence ends and keeps offsets', async () => {
    const long = 'Filler sentence here. '.repeat(100) + 'John Smith signed.';
    const parts = chunks(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p[1]).join('')).toBe(long);
    const spans = await nerSpans(long, async (t) => {
      const i = t.indexOf('John');
      return i < 0 ? [] : [{ entity: 'B-PER', score: 0.99, index: 1, word: 'John' }, { entity: 'I-PER', score: 0.99, index: 2, word: 'Smith' }];
    });
    expect(spans.map((x) => long.slice(x.start, x.end))).toEqual(['John Smith']);
  });
});

import { titleCaseCapsLines } from '../src/core/ner.js';
describe('caps lines', () => {
  it('title-cases lines in capitals without changing length', () => {
    const t = 'SIGNED BY JOHN SMITH\nordinary line with ACME';
    const out = titleCaseCapsLines(t);
    expect(out).toBe('Signed By John Smith\nordinary line with ACME');
    expect(out.length).toBe(t.length);
  });
});
