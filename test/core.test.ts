import { describe, expect, it } from 'vitest';
import { listSpans, resolve, ruleSpans } from '../src/core/rules.js';
import { Session } from '../src/core/session.js';

const kinds = (t: string) => resolve(ruleSpans(t)).map((s) => [s.kind, s.text]);

describe('rules', () => {
  it('finds UK identifiers', () => {
    const t = 'Contact jane.doe@acme.co.uk or +44 20 7946 0958, NI number JK 12 34 56 C, ' +
      'sort code 20-00-00, account number 12345678, postcode SE12 8UX.';
    expect(kinds(t)).toEqual([
      ['EMAIL', 'jane.doe@acme.co.uk'],
      ['PHONE', '+44 20 7946 0958'],
      ['NINO', 'JK 12 34 56 C'],
      ['SORT_CODE', '20-00-00'],
      ['ACCOUNT', '12345678'],
      ['POSTCODE', 'SE12 8UX'],
    ]);
  });

  it('finds contract parties and company numbers in recitals', () => {
    const t = 'THIS AGREEMENT is made between (1) Acme Widgets (UK) Limited (company number 01234567) ' +
      'whose registered office is at 2 Jeffrey Row, London SE12 8UX and (2) Brightstone Holdings PLC.';
    expect(kinds(t)).toEqual([
      ['COMPANY', 'Acme Widgets (UK) Limited'],
      ['COMPANY_NO', '01234567'],
      ['ADDRESS', '2 Jeffrey Row'],
      ['POSTCODE', 'SE12 8UX'],
      ['COMPANY', 'Brightstone Holdings PLC'],
    ]);
  });

  it('leaves statutes and dates alone', () => {
    const t = 'Sections 24 to 28 of the Landlord and Tenant Act 1954 are excluded as from 22 January 2016.';
    expect(kinds(t)).toEqual([]);
  });

  it('user list wins over rules on overlap', () => {
    const t = 'Project Falcon: Acme Widgets Limited';
    const spans = resolve([...ruleSpans(t), ...listSpans(t, ['Project Falcon', 'Acme Widgets'])]);
    expect(spans.map((s) => [s.kind, s.text])).toEqual([['TERM', 'Project Falcon'], ['TERM', 'Acme Widgets']]);
  });
});

describe('session', () => {
  it('maps the same entity to the same placeholder and restores it', () => {
    const s = new Session();
    const t = 'Acme Limited and ACME LTD and Beta Ltd';
    const out = s.anonymise(t, resolve(ruleSpans(t)));
    expect(out).toBe('[COMPANY_1] and [COMPANY_1] and [COMPANY_2]');
    expect(s.restore('[COMPANY_2] owes [COMPANY_1] money; [PERSON_9] is unknown'))
      .toBe('Beta Ltd owes Acme Limited money; [PERSON_9] is unknown');
  });

  it('masks a surname seen earlier as part of a full name', () => {
    const s = new Session();
    s.placeholderFor('PERSON', 'John Smith');
    const t = 'Mr Smith signed.';
    expect(s.anonymise(t, resolve(s.aliasSpans(t)))).toBe('Mr [PERSON_1] signed.');
  });

  it('survives a round trip through storage', () => {
    const s = new Session();
    s.placeholderFor('EMAIL', 'a@b.com');
    const s2 = Session.from(JSON.parse(JSON.stringify(s)));
    expect(s2.placeholderFor('EMAIL', 'a@b.com')).toBe('[EMAIL_1]');
    expect(s2.placeholderFor('EMAIL', 'c@d.com')).toBe('[EMAIL_2]');
  });
});

describe('capitals', () => {
  it('cuts heading words off a company name in capitals', () => {
    expect(kinds('RULES OF THE HENDERSON GROUP PLC')).toEqual([['COMPANY', 'HENDERSON GROUP PLC']]);
  });
});

import { detect } from '../src/core/detect.js';
describe('detect', () => {
  it('does not mask placeholders it issued earlier', async () => {
    const t = '[PERSON_1] works for [COMPANY_2] and Acme Limited.';
    const spans = await detect(t, { classify: async () => [{ entity: 'B-ORG', score: 0.9, index: 1, word: 'PERSON' }] });
    expect(spans.map((s) => s.text)).toEqual(['Acme Limited']);
  });
  it('respects the allow list', async () => {
    expect((await detect('Acme Limited', { allow: ['acme limited'] })).length).toBe(0);
  });
});

describe('people', () => {
  const tags = (words: [string, string][]) => async () => words.map(([word, entity], index) => ({ word, entity, score: 0.99, index }));
  it('drops titles and masks a surname used before or after the full name', async () => {
    const t = 'Patel agreed. Later Priya Patel signed, and Ms Patel paid.';
    const classify = tags([['Patel', 'B-PER'], ['Priya', 'B-PER'], ['Patel', 'I-PER'], ['Ms', 'B-PER'], ['Patel', 'I-PER']]);
    const s = new Session();
    const out = s.anonymise(t, await detect(t, { classify }));
    expect(out).toBe('[PERSON_1] agreed. Later [PERSON_1] signed, and Ms [PERSON_1] paid.');
  });
});
