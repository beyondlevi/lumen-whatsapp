// Normalizes Evolution API v2 payloads into the app's chat model. Parsing is
// defensive: fields are checked one by one so an unexpected record degrades to
// an "unsupported" marker instead of breaking the list.

export type ContentKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll'
  | 'reaction'
  | 'deleted'
  | 'unsupported';

export type MessageContent = {
  kind: ContentKind;
  /** Body for text, caption/title for media markers, emoji for reactions (empty when removed). */
  text: string;
  /** Reactions: id of the message reacted to. */
  targetId?: string;
  /** Audio: length in seconds, when the message carries it. */
  seconds?: number;
};

export type ChatMessage = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  /** Sender display name for incoming messages (group participants). */
  senderName: string | null;
  /** Sender JID of an incoming group message. */
  participant?: string;
  /** Epoch milliseconds. */
  timestamp: number;
  content: MessageContent;
  pending?: boolean;
};

export type Chat = {
  jid: string;
  /** Null when no name is known; the UI falls back to the phone number. */
  name: string | null;
  isGroup: boolean;
  unreadCount: number;
  lastMessage: ChatMessage | null;
  /** Epoch milliseconds of the latest activity, when known. */
  timestamp: number | null;
  /** Profile picture URL from findChats (`profilePicUrl`), when the server has one. */
  avatarUrl?: string;
};

export type ContactNames = Map<string, string>;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Chats that are not conversations (status updates, channels, broadcast lists). */
export function isHiddenJid(jid: string): boolean {
  return (
    jid === 'status@broadcast' ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  );
}

/** `5511999990001@s.whatsapp.net` becomes `+5511999990001`; other JIDs give null. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) {
    return null;
  }
  const match = /^(\d{6,20})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return match ? `+${match[1]}` : null;
}

/**
 * One key per WhatsApp account across JID spellings: without a device suffix
 * (`:12`), and for Brazilian mobiles with or without the ninth digit
 * (`55 11 9xxxx-xxxx` and the older `55 11 xxxx-xxxx` are the same person).
 */
export function accountKey(jid: string): string {
  const [user = '', server = ''] = jid.toLowerCase().split('@');
  const bare = user.split(':')[0];
  if (server !== 's.whatsapp.net') {
    return `${bare}@${server}`;
  }
  const brazilianMobile = /^55(\d{2})9?([6-9]\d{7})$/.exec(bare);
  return brazilianMobile ? `55${brazilianMobile[1]}9${brazilianMobile[2]}@s.whatsapp.net` : `${bare}@${server}`;
}

/** Evolution stores seconds; accept seconds, milliseconds, numeric strings, Long-like objects, and ISO strings. */
export function toMillis(value: unknown): number | null {
  let numeric: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    numeric = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    if (/^\d+$/.test(value.trim())) {
      numeric = Number(value);
    } else {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
  } else {
    const long = asObject(value);
    if (long && typeof long.low === 'number') {
      const high = typeof long.high === 'number' ? long.high : 0;
      numeric = high * 2 ** 32 + (long.low >>> 0);
    }
  }
  if (numeric == null || numeric <= 0) {
    return null;
  }
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function unwrap(message: Json): Json {
  let current = message;
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapperKey = WRAPPER_KEYS.find(key => asObject(current[key]) != null);
    const inner = wrapperKey ? asObject(asObject(current[wrapperKey])?.message) : null;
    if (!inner) {
      break;
    }
    current = inner;
  }
  return current;
}

/** Returns null for records that must not be shown (protocol/system messages, removed reactions). */
export function parseContent(messageValue: unknown, messageType?: unknown): MessageContent | null {
  const raw = asObject(messageValue);
  if (!raw) {
    return {kind: 'unsupported', text: ''};
  }
  const message = unwrap(raw);
  const part = (key: string) => asObject(message[key]);

  const conversation = asString(message.conversation);
  if (conversation) {
    return {kind: 'text', text: conversation};
  }
  const extended = part('extendedTextMessage');
  if (extended && asString(extended.text)) {
    return {kind: 'text', text: String(extended.text)};
  }
  const image = part('imageMessage');
  if (image) {
    return {kind: 'photo', text: asString(image.caption) ?? ''};
  }
  const video = part('videoMessage') ?? part('ptvMessage');
  if (video) {
    return {kind: 'video', text: asString(video.caption) ?? ''};
  }
  const audioPart = part('audioMessage');
  if (audioPart) {
    const seconds = typeof audioPart.seconds === 'number' && audioPart.seconds > 0 ? audioPart.seconds : undefined;
    return seconds ? {kind: 'audio', text: '', seconds} : {kind: 'audio', text: ''};
  }
  if (part('stickerMessage')) {
    return {kind: 'sticker', text: ''};
  }
  const documentPart = part('documentMessage');
  if (documentPart) {
    return {
      kind: 'document',
      text: asString(documentPart.caption) ?? asString(documentPart.fileName) ?? asString(documentPart.name) ?? '',
    };
  }
  const location = part('locationMessage') ?? part('liveLocationMessage');
  if (location) {
    return {kind: 'location', text: asString(location.name) ?? ''};
  }
  const contact = part('contactMessage');
  if (contact) {
    return {kind: 'contact', text: asString(contact.displayName) ?? ''};
  }
  if (part('contactsArrayMessage')) {
    return {kind: 'contact', text: ''};
  }
  const poll =
    part('pollCreationMessage') ?? part('pollCreationMessageV2') ?? part('pollCreationMessageV3');
  if (poll) {
    return {kind: 'poll', text: asString(poll.name) ?? ''};
  }
  const reaction = part('reactionMessage');
  if (reaction) {
    const targetId = asString(asObject(reaction.key)?.id);
    // An empty reaction text means the reaction was removed.
    const emoji = asString(reaction.text) ?? '';
    if (!targetId) {
      return emoji ? {kind: 'reaction', text: emoji} : null;
    }
    return {kind: 'reaction', text: emoji, targetId};
  }
  const protocol = part('protocolMessage');
  if (protocol) {
    // type 0 / "REVOKE" is "delete for everyone"; the other protocol messages are not chat content.
    return protocol.type === 0 || protocol.type === 'REVOKE' ? {kind: 'deleted', text: ''} : null;
  }
  if (part('senderKeyDistributionMessage') || part('pollUpdateMessage')) {
    return null;
  }

  switch (messageType) {
    case 'imageMessage':
      return {kind: 'photo', text: ''};
    case 'videoMessage':
    case 'ptvMessage':
      return {kind: 'video', text: ''};
    case 'audioMessage':
      return {kind: 'audio', text: ''};
    case 'stickerMessage':
      return {kind: 'sticker', text: ''};
    case 'documentMessage':
    case 'documentWithCaptionMessage':
      return {kind: 'document', text: ''};
    default:
      return {kind: 'unsupported', text: ''};
  }
}

/** Parses one message record (findMessages record, chat.lastMessage, or sendText response). */
export function parseMessage(value: unknown, contacts?: ContactNames): ChatMessage | null {
  const record = asObject(value);
  const key = asObject(record?.key);
  if (!record || !key) {
    return null;
  }
  const remoteJid = asString(key.remoteJid);
  const id = asString(key.id) ?? asString(record.id);
  if (!remoteJid || !id) {
    return null;
  }
  const content = parseContent(record.message, record.messageType);
  if (!content) {
    return null;
  }
  const fromMe = key.fromMe === true;
  const participant = asString(key.participant) ?? asString(record.participant);
  const senderName = fromMe
    ? null
    : asString(record.pushName) ??
      (participant ? contacts?.get(participant) ?? phoneFromJid(participant) : null);
  return {
    id,
    remoteJid,
    fromMe,
    senderName,
    participant: participant ?? undefined,
    timestamp: toMillis(record.messageTimestamp) ?? Date.now(),
    content,
    pending: record.status === 'PENDING' ? true : undefined,
  };
}

export function parseContacts(value: unknown): ContactNames {
  const names: ContactNames = new Map();
  if (!Array.isArray(value)) {
    return names;
  }
  for (const item of value) {
    const contact = asObject(item);
    const jid = asString(contact?.remoteJid);
    const name = asString(contact?.pushName);
    if (jid && name) {
      names.set(jid, name);
    }
  }
  return names;
}

/** A saved contact or known group that can be messaged. */
export type Contact = {jid: string; name: string; isGroup: boolean};

/** Contacts with a name and a JID that takes messages (people and groups, not @lid or broadcasts). */
export function parseContactList(value: unknown): Contact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  for (const item of value) {
    const contact = asObject(item);
    const jid = asString(contact?.remoteJid);
    const name = asString(contact?.pushName)?.trim();
    if (!jid || !name || seen.has(jid) || !(jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us'))) {
      continue;
    }
    seen.add(jid);
    contacts.push({jid, name, isGroup: jid.endsWith('@g.us')});
  }
  return contacts;
}

export function parseChats(value: unknown, contacts?: ContactNames): Chat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const byJid = new Map<string, Chat>();
  for (const item of value) {
    const raw = asObject(item);
    const jid = asString(raw?.remoteJid);
    if (!raw || !jid || isHiddenJid(jid)) {
      continue;
    }
    const lastMessage = parseMessage(raw.lastMessage, contacts);
    const isGroup = isGroupJid(jid);
    // `name` is not returned by v2.3 but older/newer builds may send it.
    const name =
      asString(raw.name) ??
      asString(raw.pushName) ??
      contacts?.get(jid) ??
      (!isGroup && lastMessage && !lastMessage.fromMe ? lastMessage.senderName : null);
    const unread = typeof raw.unreadCount === 'number' && raw.unreadCount > 0 ? raw.unreadCount : 0;
    const timestamp = lastMessage?.timestamp ?? toMillis(raw.updatedAt);
    const avatarUrl = asString(raw.profilePicUrl);
    if (!byJid.has(jid)) {
      byJid.set(jid, {
        jid,
        name,
        isGroup,
        unreadCount: unread,
        lastMessage,
        timestamp,
        ...(avatarUrl && /^https?:|^data:image\//.test(avatarUrl) ? {avatarUrl} : {}),
      });
    }
  }
  return [...byJid.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

/** findMessages returns `{messages: {records}}`; older builds returned a bare array. Output is oldest first. */
export function parseMessages(value: unknown, contacts?: ContactNames): ChatMessage[] {
  const container = asObject(value);
  const records = Array.isArray(value)
    ? value
    : Array.isArray(asObject(container?.messages)?.records)
      ? (asObject(container?.messages)?.records as unknown[])
      : Array.isArray(container?.messages)
        ? (container?.messages as unknown[])
        : [];
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  // Records come newest first; reversing before the stable sort keeps the
  // server's order for messages that share the same second.
  for (const record of [...records].reverse()) {
    const message = parseMessage(record, contacts);
    if (message && !seen.has(message.id)) {
      seen.add(message.id);
      messages.push(message);
    }
  }
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}
