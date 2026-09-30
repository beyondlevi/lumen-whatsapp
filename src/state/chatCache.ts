// Last known chats and recent messages, kept in localStorage so the app shows
// the list immediately on the next launch. Keyed by server URL + instance; the
// API key is never stored here.
import type {EvolutionConfig} from '../config/lumenConfig';
import type {Chat, ChatMessage} from '../evolution/parse';

const CACHE_KEY = 'lumen-whatsapp.chat-cache.v1';
const MAX_THREADS = 20;
const MAX_MESSAGES = 30;

export type ChatCache = {chats: Chat[]; threads: Record<string, ChatMessage[]>};

type Stored = ChatCache & {account: string; savedAt: number};

export function cacheAccount(config: EvolutionConfig): string {
  return `${config.url}\n${config.instance}`;
}

function isChat(value: unknown): value is Chat {
  const chat = value as Partial<Chat> | null;
  return chat != null && typeof chat.jid === 'string' && typeof chat.unreadCount === 'number';
}

export function loadChatCache(account: string): ChatCache | null {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Stored | null;
    if (stored == null || stored.account !== account || !Array.isArray(stored.chats)) {
      return null;
    }
    const chats = stored.chats.filter(isChat);
    const threads: Record<string, ChatMessage[]> = {};
    for (const [jid, messages] of Object.entries(stored.threads ?? {})) {
      if (Array.isArray(messages)) {
        threads[jid] = messages.filter(message => typeof message?.id === 'string');
      }
    }
    return chats.length > 0 ? {chats, threads} : null;
  } catch {
    return null;
  }
}

export function saveChatCache(account: string, chats: Chat[], threads: Record<string, ChatMessage[]>): void {
  const kept: Record<string, ChatMessage[]> = {};
  for (const chat of chats) {
    if (Object.keys(kept).length >= MAX_THREADS) {
      break;
    }
    const messages = threads[chat.jid];
    if (messages?.length) {
      kept[chat.jid] = messages
        .filter(message => !message.pending)
        .slice(-MAX_MESSAGES);
    }
  }
  const stored: Stored = {account, savedAt: Date.now(), chats, threads: kept};
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the next launch just waits for the server.
  }
}
