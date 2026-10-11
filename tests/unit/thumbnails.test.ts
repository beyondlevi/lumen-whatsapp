import {beforeEach, describe, expect, it} from 'vitest';
import {bytesToBase64, parseContent, parseMessage, type Chat, type ChatMessage} from '../../src/evolution/parse';
import {loadChatCache, saveChatCache} from '../../src/state/chatCache';
import {messageThumbnail} from '../../src/state/photoThumbnails';

// The first bytes of a JPEG (FF D8 FF E0), as each shape Evolution may return them.
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const BASE64 = '/9j/4A==';

describe('jpegThumbnail (proto bytes) as Evolution returns it', () => {
  it('reads findMessages’ base64 (2.3.6+: Prisma stores bytes as base64)', () => {
    expect(bytesToBase64(BASE64)).toBe(BASE64);
  });

  it('reads a Uint8Array serialized by JSON.stringify (HTTP answers; 2.3.3 to 2.3.5)', () => {
    expect(bytesToBase64({0: 0xff, 1: 0xd8, 2: 0xff, 3: 0xe0})).toBe(BASE64);
  });

  it('reads a Node Buffer serialized as {type, data} and a plain array', () => {
    expect(bytesToBase64({type: 'Buffer', data: JPEG})).toBe(BASE64);
    expect(bytesToBase64(JPEG)).toBe(BASE64);
  });

  it('ignores anything else', () => {
    for (const value of [undefined, null, '', 'not base64!', {}, {a: 1}, [256], {0: 'x'}, 42]) {
      expect(bytesToBase64(value)).toBeUndefined();
    }
  });
});

describe('photo and video messages', () => {
  it('keep the thumbnail and the size from imageMessage', () => {
    expect(parseContent({imageMessage: {caption: 'Olha isso', jpegThumbnail: BASE64, width: 800, height: 600}})).toEqual({
      kind: 'photo',
      text: 'Olha isso',
      thumbnail: BASE64,
      width: 800,
      height: 600,
    });
  });

  it('read the thumbnail of a video, and of the sendMedia answer (numeric keys)', () => {
    expect(parseContent({videoMessage: {jpegThumbnail: BASE64}})).toEqual({kind: 'video', text: '', thumbnail: BASE64});
    const sent = parseMessage({
      key: {id: 'P1', fromMe: true, remoteJid: 'x@s.whatsapp.net'},
      message: {imageMessage: {jpegThumbnail: {0: 0xff, 1: 0xd8, 2: 0xff, 3: 0xe0}, width: 1200, height: 1600}},
      messageTimestamp: 1790000000,
    });
    expect(sent?.content).toMatchObject({kind: 'photo', thumbnail: BASE64, width: 1200, height: 1600});
  });

  it('without a thumbnail, show none (the app downloads the photo for one)', () => {
    expect(parseContent({imageMessage: {caption: 'Sem miniatura'}})).toEqual({kind: 'photo', text: 'Sem miniatura'});
    const message = {content: {kind: 'photo', text: ''}} as ChatMessage;
    expect(messageThumbnail(message)).toBeNull();
    expect(messageThumbnail({...message, content: {...message.content, thumbnail: BASE64}})).toBe(`data:image/jpeg;base64,${BASE64}`);
  });
});

describe('the chat cache', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.assign(globalThis, {
      localStorage: {getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value)},
    });
  });

  it('keeps photos without their thumbnails, so it stays small', () => {
    const photo: ChatMessage = {
      id: 'M1',
      remoteJid: 'x@s.whatsapp.net',
      fromMe: false,
      senderName: 'Ana',
      timestamp: 1,
      content: {kind: 'photo', text: 'Olha', thumbnail: BASE64, width: 800, height: 600},
    };
    const chat: Chat = {jid: 'x@s.whatsapp.net', name: 'Ana', isGroup: false, unreadCount: 0, lastMessage: photo, timestamp: 1};
    saveChatCache('account', [chat], {'x@s.whatsapp.net': [photo]});
    const cached = loadChatCache('account');
    expect(cached?.threads['x@s.whatsapp.net'][0].content).toEqual({kind: 'photo', text: 'Olha', width: 800, height: 600});
    expect(cached?.chats[0].lastMessage?.content.thumbnail).toBeUndefined();
  });
});
