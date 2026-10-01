import {describe, expect, it} from 'vitest';
import type {Chat, ChatMessage} from '../../src/evolution/parse';
import {chatPreview} from '../../src/format';
import {splitReactions} from '../../src/reactions';

const CHAT = '5511999990001@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';

let clock = 0;
function text(id: string, value: string, fromMe = false, extra: Partial<ChatMessage> = {}): ChatMessage {
  clock += 1000;
  return {id, remoteJid: CHAT, fromMe, senderName: fromMe ? null : 'Ana Souza', timestamp: clock, content: {kind: 'text', text: value}, ...extra};
}
function reaction(id: string, target: string, emoji: string, fromMe = false, extra: Partial<ChatMessage> = {}): ChatMessage {
  clock += 1000;
  return {id, remoteJid: CHAT, fromMe, senderName: fromMe ? null : 'Ana Souza', timestamp: clock, content: {kind: 'reaction', text: emoji, targetId: target}, ...extra};
}

describe('splitReactions', () => {
  it('turns reaction records into badges on their target', () => {
    const messages = [
      text('A', 'Hello'),
      text('B', 'Hi!', true),
      reaction('R1', 'B', '👍'),
      reaction('R2', 'A', '❤️', true),
    ];
    const view = splitReactions(messages);
    expect(view.messages.map(message => message.id)).toEqual(['A', 'B']);
    expect(view.reactions.get('B')).toEqual([{emoji: '👍', count: 1, mine: false}]);
    expect(view.reactions.get('A')).toEqual([{emoji: '❤️', count: 1, mine: true}]);
  });

  it('keeps the latest reaction per sender, counts senders, and drops removed ones', () => {
    const ana = {participant: 'ana@s.whatsapp.net', remoteJid: GROUP};
    const bia = {participant: 'bia@s.whatsapp.net', remoteJid: GROUP};
    const messages = [
      text('A', 'Saturday?', false, {remoteJid: GROUP}),
      reaction('R1', 'A', '😂', false, ana),
      reaction('R2', 'A', '👍', false, ana),
      reaction('R3', 'A', '👍', false, bia),
      reaction('R4', 'A', '❤️', true, {remoteJid: GROUP}),
      reaction('R5', 'A', '', true, {remoteJid: GROUP}),
      reaction('R6', 'missing', '👍', false, ana),
    ];
    const view = splitReactions(messages);
    expect(view.messages).toHaveLength(1);
    expect(view.reactions.get('A')).toEqual([{emoji: '👍', count: 2, mine: false}]);
    expect(view.reactions.has('missing')).toBe(false);
  });
});

describe('chatPreview with reactions', () => {
  const chat = (last: ChatMessage, isGroup = false): Chat => ({
    jid: isGroup ? GROUP : CHAT,
    name: isGroup ? 'Family' : 'Ana Souza',
    isGroup,
    unreadCount: 0,
    lastMessage: last,
    timestamp: last.timestamp,
  });

  it('previews the last real message for your own reaction', () => {
    const real = text('A', 'See you tomorrow');
    const mine = reaction('R', 'A', '❤️', true);
    expect(chatPreview(chat(mine), [real, mine])).toBe('See you tomorrow');
    expect(chatPreview(chat(mine), [])).toBe('You reacted ❤️');
  });

  it('says who reacted to what for someone else', () => {
    const mine = text('A', 'Lunch on Sunday at noon?', true);
    const theirs = reaction('R', 'A', '👍');
    expect(chatPreview(chat(theirs), [mine, theirs])).toBe('Reacted 👍 to “Lunch on Sunday at noon?”');
    expect(chatPreview(chat(theirs), [])).toBe('Reacted 👍');
    const inGroup = reaction('R2', 'A', '😂', false, {remoteJid: GROUP, senderName: 'Bruno Lima'});
    expect(chatPreview(chat(inGroup, true), [mine, inGroup])).toBe('Bruno: Reacted 😂 to “Lunch on Sunday at noon?”');
  });

  it('never shows a reaction as a message', () => {
    const real = text('A', 'Ok', true);
    const removed = reaction('R', 'A', '');
    expect(chatPreview(chat(removed), [real, removed])).toBe('You: Ok');
  });
});
