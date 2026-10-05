import { env, pipeline } from '@huggingface/transformers';

/**
 * Hosts the named-entity model. Everything it loads is inside the extension package:
 * remote models are disabled and the ONNX runtime files are bundled, so this page makes no
 * network request.
 */
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = chrome.runtime.getURL('ort/');
wasm.numThreads = 1; // threads need cross-origin isolation, which an extension page lacks

let status: 'loading' | 'ready' | 'error' = 'loading';
let error: string | undefined;
const ner = pipeline('token-classification', 'distilbert-NER', { dtype: 'q8', device: 'wasm' })
  .then((p) => { status = 'ready'; return p; })
  .catch((e) => { status = 'error'; error = String(e); throw e; });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'status') { reply({ status, error }); return; }
  if (msg.type === 'classify') {
    ner.then((p) => p(msg.text))
      .then((tags) => reply({ ok: true, tags }))
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
});
