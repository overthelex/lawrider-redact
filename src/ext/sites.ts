/**
 * The two chat sites, as their DOM stood on 5 Oct 2026 (checked live). Both composers are
 * ProseMirror editors. Selectors drift; when a site changes, this file is the only place to fix.
 */
export interface Site {
  name: 'claude' | 'chatgpt';
  composer(): HTMLElement | null;
  sendButton(): HTMLButtonElement | null;
  isSendButton(el: Element): boolean;
  answers(): HTMLElement[];   // assistant messages, oldest first
  streaming(): boolean;
  conversationId(): string | null;
}

const claude: Site = {
  name: 'claude',
  composer: () => document.querySelector<HTMLElement>('[data-testid="chat-input"][contenteditable="true"]'),
  sendButton: () => document.querySelector<HTMLButtonElement>('button[data-testid="chat-input-send"]'),
  isSendButton: (el) => el instanceof HTMLButtonElement && el.dataset.testid === 'chat-input-send',
  answers: () => [...document.querySelectorAll<HTMLElement>('[data-is-streaming]')]
    .filter((row) => !row.querySelector('[data-testid="user-message"]')),
  streaming: () => !!document.querySelector('[data-is-streaming="true"]'),
  conversationId: () => location.pathname.match(/^\/chat\/([\w-]+)/)?.[1] ?? null,
};

const chatgpt: Site = {
  name: 'chatgpt',
  composer: () => document.querySelector<HTMLElement>('#prompt-textarea[contenteditable="true"]'),
  sendButton: () => document.querySelector<HTMLButtonElement>('button[data-testid="send-button"]'),
  isSendButton: (el) => el instanceof HTMLButtonElement && (el.dataset.testid === 'send-button' || el.id === 'composer-submit-button'),
  answers: () => [...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')]
    .map((m) => m.querySelector<HTMLElement>('.markdown') ?? m),
  streaming: () => !!document.querySelector('[data-testid="stop-button"]'),
  conversationId: () => location.pathname.match(/^\/c\/([\w-]+)/)?.[1] ?? null,
};

export function currentSite(): Site | null {
  if (location.hostname === 'claude.ai') return claude;
  if (location.hostname === 'chatgpt.com') return chatgpt;
  return null;
}
