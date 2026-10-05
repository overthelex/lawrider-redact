import { detect } from '../core/detect.js';
import type { TokenTag } from '../core/ner.js';
import { Session } from '../core/session.js';
import type { AnonymiseReply, PanelState, Request } from './messages.js';

/**
 * Service worker. Holds one placeholder session per tab (in chrome.storage.session, which
 * Chrome keeps in memory and clears when the browser closes) and runs detection. The NER
 * model lives in an offscreen document, because ONNX Runtime does not run in a service worker.
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

interface TabState { conversationId: string | null; session: ReturnType<Session['toJSON']>; answer: string | null; blocked: string | null }

async function loadTab(tabId: number): Promise<TabState> {
  const key = `tab:${tabId}`;
  const got = await chrome.storage.session.get(key);
  return (got[key] as TabState) ?? { conversationId: null, session: { entries: [] }, answer: null, blocked: null };
}
const saveTab = (tabId: number, s: TabState) => chrome.storage.session.set({ [`tab:${tabId}`]: s });

chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`tab:${tabId}`); });

async function settings(): Promise<{ terms: string[]; allow: string[] }> {
  const s = await chrome.storage.local.get(['terms', 'allow']);
  return { terms: (s.terms as string[]) ?? [], allow: (s.allow as string[]) ?? [] };
}

// ── the model, in the offscreen document ──────────────────────────────────────
let creating: Promise<void> | null = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Runs the bundled named-entity model locally to find names before text is sent.',
  }).finally(() => { creating = null; });
  await creating;
}

/** The offscreen page needs a moment to load its script after it is created; retry until it listens. */
async function toOffscreen(msg: object): Promise<any> {
  await ensureOffscreen();
  for (let i = 0; ; i++) {
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
    } catch (e) {
      if (i >= 50 || !String(e).includes('Receiving end does not exist')) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function classify(text: string): Promise<TokenTag[]> {
  const r = await toOffscreen({ type: 'classify', text });
  if (!r?.ok) throw new Error(r?.error ?? 'the local model did not answer');
  return r.tags;
}

async function modelStatus(): Promise<{ status: PanelState['model']; error?: string }> {
  try {
    const r = await toOffscreen({ type: 'status' });
    return r ?? { status: 'loading' };
  } catch (e) {
    return { status: 'error', error: String(e) };
  }
}

// ── anonymising ───────────────────────────────────────────────────────────────
async function anonymise(tabId: number, text: string, conversationId: string | null): Promise<AnonymiseReply> {
  const st = await loadTab(tabId);
  // A different existing conversation in the same tab gets a fresh session; a new chat that
  // has just received its id keeps the session it started with.
  if (conversationId && st.conversationId && conversationId !== st.conversationId) {
    st.session = { entries: [] };
    st.answer = null;
  }
  if (conversationId) st.conversationId = conversationId;
  const session = Session.from(st.session);
  const { terms, allow } = await settings();
  const spans = await detect(text, { classify, terms, allow, session });
  const out = session.anonymise(text, spans);
  st.session = session.toJSON();
  await saveTab(tabId, st);
  return { ok: true, text: out, count: spans.length, items: session.entries() };
}

chrome.runtime.onMessage.addListener((msg: Request & { target?: string }, sender, reply) => {
  if (msg.target === 'offscreen') return; // for the offscreen document, not us
  const tabId = sender.tab?.id;
  (async () => {
    switch (msg.type) {
      case 'anonymise':
        if (tabId === undefined) return { ok: false, error: 'no tab' };
        return await anonymise(tabId, msg.text, msg.conversationId);
      case 'answer': {
        if (tabId === undefined) return;
        const st = await loadTab(tabId);
        st.answer = msg.text;
        await saveTab(tabId, st);
        return { ok: true };
      }
      case 'blocked': {
        if (tabId === undefined) return;
        const st = await loadTab(tabId);
        st.blocked = `${msg.what} at ${new Date().toLocaleTimeString()}`;
        await saveTab(tabId, st);
        return { ok: true };
      }
      case 'panel-state': {
        const st = await loadTab(msg.tabId);
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        const host = tab?.url ? new URL(tab.url).hostname : '';
        const session = Session.from(st.session);
        const m = await modelStatus();
        const state: PanelState = {
          site: host === 'claude.ai' ? 'Claude' : host === 'chatgpt.com' ? 'ChatGPT' : null,
          items: session.entries(),
          answer: st.answer ? session.restore(st.answer) : null,
          blocked: st.blocked,
          model: m.status,
          modelError: m.error,
        };
        return state;
      }
      case 'panel-anonymise':
        return await anonymise(msg.tabId, msg.text, null);
      case 'panel-new-session':
        await saveTab(msg.tabId, { conversationId: null, session: { entries: [] }, answer: null, blocked: null });
        return { ok: true };
      case 'model-status':
        return await modelStatus();
    }
  })().then(reply, (e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
