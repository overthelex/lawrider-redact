import type { AnonymiseReply, PanelState } from './messages.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let tabId: number | null = null;
let lastAnswer = '';

async function activeTab(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function renderItems(items: PanelState['items']) {
  const el = $('items');
  if (!items.length) { el.className = 'muted'; el.textContent = 'Nothing masked yet.'; return; }
  el.className = '';
  const table = document.createElement('table');
  for (const { placeholder, value } of items) {
    const tr = table.insertRow();
    tr.insertCell().textContent = placeholder;
    tr.insertCell().textContent = value;
  }
  el.replaceChildren(table);
}

async function refresh() {
  tabId = await activeTab();
  if (tabId === null) return;
  const s: PanelState = await chrome.runtime.sendMessage({ type: 'panel-state', tabId });
  if (!s) return;
  const model = s.model === 'ready' ? '<span class="ok">local model ready</span>'
    : s.model === 'loading' ? 'loading the local model…' : `<span class="warn">model error: ${escape(s.modelError ?? '')}</span>`;
  $('status').innerHTML = (s.site ? `Protecting <b>${s.site}</b> in this tab · ` : 'Open ChatGPT or Claude in this tab · ') + model +
    (s.blocked ? `<br><span class="warn">Blocked ${escape(s.blocked)}</span>` : '');
  renderItems(s.items);
  if (s.answer && s.answer !== lastAnswer) {
    lastAnswer = s.answer;
    const a = $('answer');
    a.className = 'box';
    a.textContent = s.answer;
    $('copyAnswer').hidden = false;
  }
}
const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ── documents ────────────────────────────────────────────────────────────────
async function extract(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((it: any) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('this PDF has no text layer (a scan); it cannot be read');
    return text;
  }
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
  }
  return new TextDecoder().decode(buf);
}

async function handleFile(file: File) {
  if (tabId === null) return;
  $('docOut').hidden = false;
  $('docInfo').textContent = `Reading ${file.name}…`;
  $('docText').textContent = '';
  try {
    const text = await extract(file);
    $('docInfo').textContent = `Anonymising ${text.length.toLocaleString()} characters…`;
    const r: AnonymiseReply = await chrome.runtime.sendMessage({ type: 'panel-anonymise', tabId, text });
    if (!r?.ok) throw new Error(r?.error ?? 'no answer');
    $('docInfo').textContent = `${file.name}: ${r.count} items masked. Check the text below before inserting it.`;
    $('docText').textContent = r.text!;
    void refresh();
  } catch (e) {
    $('docInfo').innerHTML = `<span class="warn">${escape(file.name)}: ${escape(e instanceof Error ? e.message : String(e))}</span>`;
  }
}

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer?.files[0]; if (f) void handleFile(f);
});
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (f) void handleFile(f);
});

$('insert').addEventListener('click', async () => {
  if (tabId === null) return;
  const r = await chrome.tabs.sendMessage(tabId, { type: 'insert', text: $('docText').textContent ?? '' }).catch(() => null);
  $('docInfo').textContent = r?.ok ? 'Inserted into the chat box. Review it, then send.' : 'Could not reach the chat page; use Copy instead.';
});
$('copyDoc').addEventListener('click', () => navigator.clipboard.writeText($('docText').textContent ?? ''));
$('copyAnswer').addEventListener('click', () => navigator.clipboard.writeText(lastAnswer));
$('new').addEventListener('click', async () => {
  if (tabId === null) return;
  await chrome.runtime.sendMessage({ type: 'panel-new-session', tabId });
  lastAnswer = '';
  $('answer').className = 'muted';
  $('answer').textContent = 'The answer appears here once the AI has finished replying.';
  $('copyAnswer').hidden = true;
  void refresh();
});

// ── lists ────────────────────────────────────────────────────────────────────
const lines = (id: string) => $<HTMLTextAreaElement>(id).value.split('\n').map((l) => l.trim()).filter(Boolean);
chrome.storage.local.get(['terms', 'allow']).then((s) => {
  $<HTMLTextAreaElement>('terms').value = ((s.terms as string[]) ?? []).join('\n');
  $<HTMLTextAreaElement>('allow').value = ((s.allow as string[]) ?? []).join('\n');
});
$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ terms: lines('terms'), allow: lines('allow') });
  $('saved').textContent = 'Saved.';
  setTimeout(() => ($('saved').textContent = ''), 2000);
});

chrome.tabs.onActivated.addListener(() => { lastAnswer = ''; void refresh(); });
chrome.storage.session.onChanged.addListener(() => void refresh());
void refresh();
setInterval(refresh, 3000);
