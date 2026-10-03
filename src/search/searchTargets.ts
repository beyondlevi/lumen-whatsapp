import {normalizeName, type NameCandidate} from './nameMatch';

/** A chat or contact that voice search can find. */
export type SearchTarget = {
  /** What the conversation route takes (WhatsApp JID, Telegram peer id). */
  id: string;
  name: string;
  phone: string | null;
  isGroup: boolean;
  /** Second line of a chat's row (its last message, as in the list). */
  detail: string | null;
  /** A chat of the list; otherwise a contact without a conversation yet. */
  inChats: boolean;
};

/** Recent chats first, then contacts, as the matcher's tie order. */
export function searchCandidates(targets: readonly SearchTarget[]): NameCandidate<SearchTarget>[] {
  return [...targets.filter(target => target.inChats), ...targets.filter(target => !target.inChats)].map(target => ({
    name: target.name,
    phone: target.phone,
    item: target,
  }));
}

/**
 * The chats, then one row per contact that is not already listed. A contact
 * is left out when it is the same account as a chat or an earlier contact
 * (`accountKey` gives the same value for the same account), when a chat has
 * the same name, or when it is a group named like an earlier contact group (a
 * community and its announcements group). People with the same name and
 * different numbers all stay.
 */
export function uniqueTargets(
  chats: readonly SearchTarget[],
  contacts: readonly SearchTarget[],
  accountKey: (id: string) => string = id => id,
): SearchTarget[] {
  const accounts = new Set(chats.map(chat => accountKey(chat.id)));
  const chatNames = new Set(chats.map(chat => normalizeName(chat.name)));
  const groupNames = new Set<string>();
  const kept: SearchTarget[] = [];
  for (const contact of contacts) {
    const account = accountKey(contact.id);
    const name = normalizeName(contact.name);
    if (accounts.has(account) || chatNames.has(name) || (contact.isGroup && groupNames.has(name))) {
      continue;
    }
    accounts.add(account);
    if (contact.isGroup) {
      groupNames.add(name);
    }
    kept.push(contact);
  }
  return [...chats, ...kept];
}
