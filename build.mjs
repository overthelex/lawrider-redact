// Builds the unpacked extension into dist/. The model and the ONNX runtime are copied in,
// so the installed extension never fetches anything from the network.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const common = { bundle: true, target: 'chrome116', logLevel: 'info', legalComments: 'none', minify: false };
await build({ ...common, entryPoints: ['src/ext/content.ts'], outfile: 'dist/content.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/ext/background.ts'], outfile: 'dist/background.js', format: 'esm' });
await build({ ...common, entryPoints: ['src/ext/offscreen.ts', 'src/ext/sidepanel.ts'], outdir: 'dist', format: 'esm',
  splitting: true, chunkNames: 'chunks/[name]-[hash]' });

cpSync('static', 'dist', { recursive: true });
cpSync('LICENSE', 'dist/LICENSE');

const ort = 'node_modules/onnxruntime-web/dist';
mkdirSync('dist/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  if (existsSync(`${ort}/${f}`)) cpSync(`${ort}/${f}`, `dist/ort/${f}`);
}
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs');

const model = 'models/distilbert-NER';
if (!existsSync(`${model}/onnx/model_quantized.onnx`)) {
  console.error('Model missing: run `npm run fetch-model` first.');
  process.exit(1);
}
mkdirSync('dist/models/distilbert-NER/onnx', { recursive: true });
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']) {
  cpSync(`${model}/${f}`, `dist/models/distilbert-NER/${f}`);
}
cpSync(`${model}/onnx/model_quantized.onnx`, 'dist/models/distilbert-NER/onnx/model_quantized.onnx');
console.log('Built dist/. Load it in chrome://extensions with "Load unpacked".');
