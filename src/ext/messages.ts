export interface Item { placeholder: string; value: string }

export type Request =
  | { type: 'anonymise'; text: string; conversationId: string | null }
  | { type: 'answer'; text: string; conversationId: string | null }
  | { type: 'blocked'; what: string }
  | { type: 'panel-state'; tabId: number }
  | { type: 'panel-anonymise'; tabId: number; text: string }
  | { type: 'panel-new-session'; tabId: number }
  | { type: 'model-status' };

export interface AnonymiseReply { ok: boolean; text?: string; count?: number; items?: Item[]; error?: string }

export interface PanelState {
  site: string | null;
  items: Item[];
  answer: string | null;      // the last answer with real values restored
  blocked: string | null;
  model: 'ready' | 'loading' | 'error';
  modelError?: string;
}
