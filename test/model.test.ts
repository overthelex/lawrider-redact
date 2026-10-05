/**
 * Runs the real bundled model when models/distilbert-NER exists (npm run fetch-model).
 * Skipped otherwise, so CI without the 66 MB model still passes.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detect } from '../src/core/detect.js';
import { Session } from '../src/core/session.js';

const MODEL = new URL('../models/distilbert-NER/onnx/model_quantized.onnx', import.meta.url);
const have = existsSync(MODEL);

describe.skipIf(!have)('real model', async () => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = new URL('../models/', import.meta.url).pathname;
  const ner = await pipeline('token-classification', 'distilbert-NER', { dtype: 'q8' });
  const classify = async (t: string) => (await ner(t)) as any;

  it('masks people, companies and places in a recital, keeps the law', async () => {
    const t = 'THIS DEED is made on 22 January 2016 between (1) Brightstone Holdings PLC of 9 Motcomb Street, ' +
      'London SW1X 8LA and (2) Priya Patel, under section 38A of the Landlord and Tenant Act 1954.';
    const s = new Session();
    const out = s.anonymise(t, await detect(t, { classify, session: s }));
    expect(out).not.toMatch(/Brightstone|Motcomb|SW1X|Priya|Patel/);
    expect(out).toContain('section 38A of the Landlord and Tenant Act 1954');
    expect(out).toContain('22 January 2016');
    expect(s.restore(out)).toBe(t);
  });

  it('runs over a real contract without breaking the restore', async () => {
    const dir = '/Users/vovkes/lawrider-uk/tools/contract_dd/corpus/data/';
    if (!existsSync(dir)) return;
    const f = readdirSync(dir).find((x) => x.startsWith('employment'))!;
    const t = readFileSync(dir + f, 'utf8').slice(0, 20000);
    const s = new Session();
    const spans = await detect(t, { classify, session: s });
    const out = s.anonymise(t, spans);
    // One placeholder per entity, so spelling variants come back in one (non-capitals) spelling.
    expect(s.restore(out).toLowerCase()).toBe(t.toLowerCase());
    console.log(f, spans.length, 'spans;', s.entries().slice(0, 15).map((e) => `${e.placeholder}=${e.value}`).join(' | '));
  }, 120000);
});
