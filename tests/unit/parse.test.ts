import {describe, expect, it} from 'vitest';
import findChats from '../fixtures/findChats.json';
import findContacts from '../fixtures/findContacts.json';
import findMessages from '../fixtures/findMessages.json';
import sendText from '../fixtures/sendText.json';
import {
  parseChats,
  parseContacts,
  parseContent,
  parseMessage,
  parseMessages,
  phoneFromJid,
  toMillis,
} from '../../src/evolution/parse';

describe('parseChats (Evolution v2 findChats)', () => {
  it('maps name, preview message, time and unread count', () => {
    const chats = parseChats(findChats);
    expect(chats.map(chat => chat.jid)).toEqual([
      '5511999990001@s.whatsapp.net',
      '120363000000000001@g.us',
      '5511999990003@s.whatsapp.net',
    ]);
    const [ana, family, carla] = chats;
    expect(ana).toMatchObject({name: 'Ana Souza', isGroup: false, unreadCount: 2});
    expect(ana.timestamp).toBe(1759151112 * 1000);
    expect(ana.lastMessage?.content).toEqual({kind: 'text', text: 'Oi! Tudo certo para amanhã?'});
    expect(family).toMatchObject({name: 'Família', isGroup: true, unreadCount: 0});
    expect(family.lastMessage).toMatchObject({senderName: 'Bruno Lima', content: {kind: 'photo', text: 'Olha isso'}});
    // unreadCount null is not unread; own voice note is an audio marker.
    expect(carla).toMatchObject({unreadCount: 0, lastMessage: {fromMe: true, content: {kind: 'audio'}}});
  });

  it('hides status and newsletter chats and falls back to contact names', () => {
    const contacts = parseContacts(findContacts);
    const chats = parseChats(
      [
        {remoteJid: 'status@broadcast', pushName: 'x', lastMessage: null},
        {remoteJid: '1203630000@newsletter', pushName: 'x', lastMessage: null},
        {remoteJid: '5511999990004@s.whatsapp.net', pushName: null, updatedAt: '2026-09-29T10:00:00.000Z'},
        {remoteJid: '5511999990001@s.whatsapp.net', pushName: null, updatedAt: '2026-09-29T09:00:00.000Z'},
      ],
      contacts,
    );
    expect(chats.map(chat => [chat.jid, chat.name])).toEqual([
      ['5511999990004@s.whatsapp.net', null],
      ['5511999990001@s.whatsapp.net', 'Ana Souza'],
    ]);
  });

  it('returns an empty list for unexpected payloads', () => {
    expect(parseChats({error: 'x'})).toEqual([]);
    expect(parseChats(null)).toEqual([]);
  });
});

describe('parseMessages (Evolution v2 findMessages)', () => {
  it('reads messages.records, oldest first, with markers', () => {
    const messages = parseMessages(findMessages);
    expect(messages.map(message => message.content.kind)).toEqual(['audio', 'text', 'reaction', 'text']);
    expect(messages[1]).toMatchObject({fromMe: true, senderName: null});
    expect(messages[2].content).toEqual({kind: 'reaction', text: '👍', targetId: '3EB0DEADBEEF0000000002'});
    expect(messages[3]).toMatchObject({fromMe: false, senderName: 'Ana Souza', timestamp: 1759151112000});
  });

  it('accepts a bare array (older builds) and drops duplicates', () => {
    const records = findMessages.messages.records;
    expect(parseMessages([...records, records[0]])).toHaveLength(4);
  });
});

describe('parseMessage (sendText response)', () => {
  it('parses the 201 body as a pending own message', () => {
    expect(parseMessage(sendText)).toMatchObject({
      id: '3EB0F1E2D3C4B5A6978869',
      fromMe: true,
      pending: true,
      content: {kind: 'text', text: 'Olá!'},
    });
  });
});

describe('parseContent', () => {
  it.each([
    [{extendedTextMessage: {text: 'hi'}}, {kind: 'text', text: 'hi'}],
    [{ephemeralMessage: {message: {conversation: 'wrapped'}}}, {kind: 'text', text: 'wrapped'}],
    [{viewOnceMessageV2: {message: {imageMessage: {}}}}, {kind: 'photo', text: ''}],
    [{videoMessage: {caption: 'clip'}}, {kind: 'video', text: 'clip'}],
    [{stickerMessage: {}}, {kind: 'sticker', text: ''}],
    [{documentWithCaptionMessage: {message: {documentMessage: {fileName: 'a.pdf'}}}}, {kind: 'document', text: 'a.pdf'}],
    [{locationMessage: {degreesLatitude: 1}}, {kind: 'location', text: ''}],
    [{contactMessage: {displayName: 'Ana'}}, {kind: 'contact', text: 'Ana'}],
    [{pollCreationMessageV3: {name: 'Lunch?'}}, {kind: 'poll', text: 'Lunch?'}],
    [{protocolMessage: {type: 0}}, {kind: 'deleted', text: ''}],
    [{somethingNew: {}}, {kind: 'unsupported', text: ''}],
  ])('%j', (message, expected) => {
    expect(parseContent(message)).toEqual(expected);
  });

  it('skips non-chat records', () => {
    expect(parseContent({reactionMessage: {text: ''}})).toBeNull();
    // A removed reaction is kept (empty emoji) so it can clear an earlier one.
    expect(parseContent({reactionMessage: {key: {id: 'M1'}, text: ''}})).toEqual({kind: 'reaction', text: '', targetId: 'M1'});
    expect(parseContent({audioMessage: {seconds: 7, ptt: true}})).toEqual({kind: 'audio', text: '', seconds: 7});
    expect(parseContent({audioMessage: {ptt: true}})).toEqual({kind: 'audio', text: ''});
    expect(parseContent({protocolMessage: {type: 'EPHEMERAL_SETTING'}})).toBeNull();
    expect(parseContent({senderKeyDistributionMessage: {}})).toBeNull();
  });

  it('falls back to messageType for stripped media', () => {
    expect(parseContent({}, 'imageMessage')).toEqual({kind: 'photo', text: ''});
  });
});

describe('helpers', () => {
  it('normalizes timestamps', () => {
    expect(toMillis(1759151112)).toBe(1759151112000);
    expect(toMillis('1759151112')).toBe(1759151112000);
    expect(toMillis(1759151112000)).toBe(1759151112000);
    expect(toMillis({low: 1759151112, high: 0})).toBe(1759151112000);
    expect(toMillis('2026-09-29T13:05:12.000Z')).toBe(Date.parse('2026-09-29T13:05:12.000Z'));
    expect(toMillis(null)).toBeNull();
  });

  it('formats phone JIDs only', () => {
    expect(phoneFromJid('5511999990001@s.whatsapp.net')).toBe('+5511999990001');
    expect(phoneFromJid('5511999990001:12@s.whatsapp.net')).toBe('+5511999990001');
    expect(phoneFromJid('123456789012345@lid')).toBeNull();
    expect(phoneFromJid('120363000000000001@g.us')).toBeNull();
  });
});
