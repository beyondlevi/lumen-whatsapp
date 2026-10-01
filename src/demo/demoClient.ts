// Demo mode stand-in for EvolutionClient. Answers with Evolution API v2 shaped
// payloads built from the fictional chats in demoData, so the app parses and
// renders them exactly like server data. Never calls fetch and never touches
// storage: every launch starts from the same chats.

import type {EvolutionApi, MessageKeyRef} from '../evolution/client';
import {DEMO_DAY_END, demoChats, type DemoChat, type DemoMessage} from './demoData';

/** Time the "Sending" state stays on screen. */
const SEND_DELAY_MS = 600;
/** Delay before a chat's scripted answer to your first reply. */
const AUTO_REPLY_DELAY_MS = 2500;

type StoredMessage = Omit<DemoMessage, 'daysAgo' | 'time'> & {timestamp: number};
type StoredChat = Omit<DemoChat, 'messages'> & {messages: StoredMessage[]; autoReplied: boolean};

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Epoch seconds of `HH:MM` on the day `daysAgo` days before today. */
function demoTime(daysAgo: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

export function createDemoClient(): EvolutionApi {
  const chats: StoredChat[] = demoChats().map(chat => ({
    ...chat,
    autoReplied: false,
    messages: chat.messages.map(({daysAgo, time, ...rest}) => ({...rest, timestamp: demoTime(daysAgo, time)})),
  }));
  const launchedAt = Date.now();
  const dayEnd = demoTime(0, DEMO_DAY_END);
  let sentCounter = 0;

  /** Demo clock: 09:41 at launch, then running with real time. */
  const now = () => dayEnd + Math.floor((Date.now() - launchedAt) / 1000);
  const chatFor = (jid: string) => chats.find(chat => chat.jid === jid);

  const record = (chat: StoredChat, message: StoredMessage) => ({
    id: message.id,
    key: {
      id: message.id,
      remoteJid: chat.jid,
      fromMe: message.fromMe,
      ...(message.participant ? {participant: message.participant} : {}),
    },
    ...(message.pushName && !message.fromMe ? {pushName: message.pushName} : {}),
    messageType: message.messageType,
    message: message.message,
    messageTimestamp: message.timestamp,
    status: message.fromMe ? 'READ' : 'DELIVERY_ACK',
  });

  const add = (chat: StoredChat, message: Omit<StoredMessage, 'id' | 'timestamp'>) => {
    sentCounter += 1;
    const stored: StoredMessage = {...message, id: `DEMOX${String(sentCounter).padStart(4, '0')}`, timestamp: now()};
    chat.messages.push(stored);
    return stored;
  };

  return {
    async findChats(take: number) {
      return [...chats]
        .sort((a, b) => (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0))
        .slice(0, take)
        .map(chat => {
          const last = chat.messages.at(-1);
          const isGroup = chat.jid.endsWith('@g.us');
          return {
            id: `chat-${chat.jid}`,
            remoteJid: chat.jid,
            ...(chat.name ? (isGroup ? {name: chat.name} : {pushName: chat.name}) : {}),
            unreadCount: chat.unreadCount,
            updatedAt: new Date((last?.timestamp ?? dayEnd) * 1000).toISOString(),
            lastMessage: last ? record(chat, last) : null,
          };
        });
    },

    async findContacts() {
      const contacts = new Map<string, string>();
      for (const chat of chats) {
        if (chat.name && !chat.jid.endsWith('@g.us')) {
          contacts.set(chat.jid, chat.name);
        }
        for (const message of chat.messages) {
          if (message.participant && message.pushName) {
            contacts.set(message.participant, message.pushName);
          }
        }
      }
      return [...contacts].map(([remoteJid, pushName]) => ({remoteJid, pushName}));
    },

    async findMessages(remoteJid: string, limit: number) {
      const chat = chatFor(remoteJid);
      const records = chat ? chat.messages.slice(-limit).reverse().map(message => record(chat, message)) : [];
      return {messages: {total: records.length, pages: 1, currentPage: 1, records}};
    },

    async sendText(remoteJid: string, value: string) {
      await wait(SEND_DELAY_MS);
      const chat = chatFor(remoteJid);
      if (!chat) {
        return null;
      }
      const sent = add(chat, {fromMe: true, messageType: 'conversation', message: {conversation: value}});
      if (chat.autoReply && !chat.autoReplied) {
        chat.autoReplied = true;
        const answer = chat.autoReply;
        const pushName = chat.name;
        setTimeout(() => {
          add(chat, {fromMe: false, pushName, messageType: 'conversation', message: {conversation: answer}});
          chat.unreadCount += 1;
        }, AUTO_REPLY_DELAY_MS);
      }
      return {...record(chat, sent), status: 'PENDING'};
    },

    async sendReaction(key: MessageKeyRef, reaction: string) {
      await wait(SEND_DELAY_MS / 2);
      const chat = chatFor(key.remoteJid);
      if (chat) {
        add(chat, {fromMe: true, messageType: 'reactionMessage', message: {reactionMessage: {key, text: reaction}}});
      }
      return {status: 'PENDING'};
    },

    async markMessagesAsRead(keys: MessageKeyRef[]) {
      for (const jid of new Set(keys.map(key => key.remoteJid))) {
        const chat = chatFor(jid);
        if (chat) {
          chat.unreadCount = 0;
        }
      }
      return {message: 'Read messages', read: 'success'};
    },
  };
}
