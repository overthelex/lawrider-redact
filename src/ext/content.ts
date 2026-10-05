import type { AnonymiseReply } from './messages.js';
import { currentSite } from './sites.js';

/**
 * Runs on chatgpt.com and claude.ai. Catches the send (Enter or the send button) in the
 * capture phase, before the page's own handlers, swaps the composer text for its anonymised
 * version and then lets the send through once. If anonymising fails, nothing is sent.
 */
const site = currentSite();
let bypass = false;
let busy = false;

function toast(msg: string, kind: 'info' | 'error' = 'info', ms = 4000) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<div style="position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;
    padding:10px 14px;border-radius:8px;font:13px/1.4 -apple-system,Segoe UI,sans-serif;color:#fff;
    background:${kind === 'error' ? '#b42318' : '#1d4ed8'};box-shadow:0 4px 16px rgba(0,0,0,.25)">
    <b>LawRider Redact</b><br></div>`;
  root.querySelector('div')!.append(msg);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), ms);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replace everything in the ProseMirror composer: a paste keeps paragraphs, insertText is the fallback. */
async function replaceComposer(el: HTMLElement, text: string) {
  el.focus();
  document.execCommand('selectAll');
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(60);
  if (normalise(el.innerText) !== normalise(text)) {
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    await sleep(60);
  }
}
const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

async function send() {
  for (let i = 0; i < 20; i++) {
    const b = site!.sendButton();
    if (b && !b.disabled) { bypass = true; b.click(); return; }
    await sleep(50);
  }
  toast('Text anonymised. Press send again.', 'info');
}

async function intercept(e: Event) {
  if (bypass) { bypass = false; return; }
  const composer = site!.composer();
  if (!composer) return;
  const text = composer.innerText;
  if (!text.trim()) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (busy) return;
  busy = true;
  try {
    const reply: AnonymiseReply = await chrome.runtime.sendMessage({ type: 'anonymise', text, conversationId: site!.conversationId() });
    if (!reply?.ok) {
      toast(`Not sent: ${reply?.error ?? 'the extension did not answer'}. Nothing left your browser.`, 'error', 8000);
      return;
    }
    if (reply.count) {
      await replaceComposer(composer, reply.text!);
      if (normalise(composer.innerText) !== normalise(reply.text!)) {
        toast('Could not replace the text in the chat box, so nothing was sent.', 'error', 8000);
        return;
      }
      toast(`${reply.count} item${reply.count === 1 ? '' : 's'} masked. See the LawRider panel.`);
    }
    await send();
    watchAnswer();
  } finally {
    busy = false;
  }
}

if (site) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const c = site.composer();
    if (c && e.composedPath().includes(c)) void intercept(e);
  }, true);

  document.addEventListener('click', (e) => {
    if (e.composedPath().some((n) => n instanceof Element && site.isSendButton(n))) void intercept(e);
    // Opening the file picker: files must go through the panel instead.
    const input = e.composedPath().find((n) => n instanceof HTMLInputElement && n.type === 'file');
    if (input) block(e, 'a file upload');
  }, true);

  document.addEventListener('submit', (e) => {
    if (bypass) return;
    const c = site.composer();
    if (c && (e.target as Element).contains(c)) void intercept(e);
  }, true);

  document.addEventListener('drop', (e) => { if (e.dataTransfer?.files.length) block(e, 'a dropped file'); }, true);
  document.addEventListener('paste', (e) => {
    if (e.isTrusted && e.clipboardData?.files.length) block(e, 'a pasted file');
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file' && t.files?.length) { t.value = ''; block(e, 'a file upload'); }
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'insert' && typeof msg.text === 'string') {
      const c = site.composer();
      if (!c) { reply({ ok: false }); return; }
      void replaceComposer(c, msg.text).then(() => reply({ ok: true }));
      return true;
    }
  });
}

function block(e: Event, what: string) {
  e.preventDefault();
  e.stopImmediatePropagation();
  toast(`Blocked ${what}. Open the LawRider panel and drop the document there, so it is anonymised first.`, 'error', 8000);
  void chrome.runtime.sendMessage({ type: 'blocked', what });
}

/** After a send, wait for the newest answer to finish streaming and hand its text to the panel. */
function watchAnswer() {
  const before = site!.answers().length;
  let last = '';
  let stable = 0;
  const timer = setInterval(() => {
    const answers = site!.answers();
    if (answers.length <= before) return;
    const text = answers[answers.length - 1].innerText;
    if (text && text === last && !site!.streaming()) stable++; else stable = 0;
    last = text;
    if (stable >= 2) {
      clearInterval(timer);
      void chrome.runtime.sendMessage({ type: 'answer', text, conversationId: site!.conversationId() });
    }
  }, 700);
  setTimeout(() => clearInterval(timer), 10 * 60_000);
}
