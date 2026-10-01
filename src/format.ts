import type {Chat, ChatMessage, MessageContent} from './evolution/parse';
import {phoneFromJid} from './evolution/parse';
import {locale, t, type Locale, type StringKey} from './i18n/strings';

const MARKER_KEYS: Partial<Record<MessageContent['kind'], StringKey>> = {
  photo: 'markerPhoto',
  video: 'markerVideo',
  audio: 'markerAudio',
  sticker: 'markerSticker',
  document: 'markerDocument',
  location: 'markerLocation',
  contact: 'markerContact',
  poll: 'markerPoll',
  deleted: 'markerDeleted',
  unsupported: 'markerUnsupported',
};

/** Text shown for a message: the body, or a marker such as "Photo: caption". */
export function describeContent(content: MessageContent): string {
  if (content.kind === 'text') {
    return content.text;
  }
  if (content.kind === 'reaction') {
    return t('markerReaction', {emoji: content.text});
  }
  const marker = t(MARKER_KEYS[content.kind] ?? 'markerUnsupported');
  return content.text ? t('markerWithCaption', {marker, caption: content.text}) : marker;
}

export function isMarker(content: MessageContent): boolean {
  return content.kind !== 'text';
}

export function chatDisplayName(jid: string, name: string | null | undefined): string {
  return name ?? phoneFromJid(jid) ?? t('unknownContact');
}

export function chatPreview(chat: Chat): string {
  const message = chat.lastMessage;
  if (!message) {
    return t('markerNoPreview');
  }
  const text = describeContent(message.content);
  if (message.fromMe) {
    return t('senderPrefix', {sender: t('you'), text});
  }
  if (chat.isGroup && message.senderName) {
    return t('senderPrefix', {sender: message.senderName.split(' ')[0], text});
  }
  return text;
}

export function initials(name: string): string {
  const letters = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => Array.from(part)[0] ?? '')
    .join('');
  return Array.from(letters).slice(0, 2).join('').toUpperCase();
}

type DateFormats = {time: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat; date: Intl.DateTimeFormat};
const dateFormats = new Map<Locale, DateFormats>();

function formats(): DateFormats {
  let current = dateFormats.get(locale);
  if (current == null) {
    current = {
      time: new Intl.DateTimeFormat(locale, {hour: '2-digit', minute: '2-digit'}),
      weekday: new Intl.DateTimeFormat(locale, {weekday: 'short'}),
      date: new Intl.DateTimeFormat(locale, {day: '2-digit', month: '2-digit'}),
    };
    dateFormats.set(locale, current);
  }
  return current;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** One representation per row: time today, "Yesterday", weekday this week, else day/month. */
export function formatListTime(ms: number | null, now: number = Date.now()): string | undefined {
  if (ms == null) {
    return undefined;
  }
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const {time, weekday, date} = formats();
  if (days <= 0) {
    return time.format(ms);
  }
  if (days === 1) {
    return t('yesterday');
  }
  if (days < 7) {
    return weekday.format(ms);
  }
  return date.format(ms);
}

export function formatBubbleTime(ms: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const {time: timeFormat, weekday, date} = formats();
  const time = timeFormat.format(ms);
  if (days <= 0) {
    return time;
  }
  const day = days === 1 ? t('yesterday') : days < 7 ? weekday.format(ms) : date.format(ms);
  return `${day} ${time}`;
}

/** Messages from the same sender within five minutes share one timestamp. */
export function endsMessageRun(messages: ChatMessage[], index: number): boolean {
  const current = messages[index];
  const next = messages[index + 1];
  if (!next) {
    return true;
  }
  return (
    next.fromMe !== current.fromMe ||
    next.senderName !== current.senderName ||
    next.timestamp - current.timestamp > 5 * 60000
  );
}

export function startsMessageRun(messages: ChatMessage[], index: number): boolean {
  return index === 0 || endsMessageRun(messages, index - 1);
}
