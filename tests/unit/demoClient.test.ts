import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDemoClient} from '../../src/demo/demoClient';
import {parseChats, parseContacts, parseMessages, phoneFromJid} from '../../src/evolution/parse';
import {chatPreview} from '../../src/format';
import {splitReactions} from '../../src/reactions';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('demo client', () => {
  it('never calls fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network used')));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createDemoClient();
    const chats = parseChats(await client.findChats(40));
    await client.findContacts();
    for (const chat of chats) {
      await client.findMessages(chat.jid, 30);
    }
    await client.markMessagesAsRead([{id: 'x', fromMe: false, remoteJid: chats[0].jid}]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists fictional chats with unread rows, a group and media previews', async () => {
    const client = createDemoClient();
    const contacts = parseContacts(await client.findContacts());
    const chats = parseChats(await client.findChats(40), contacts);
    expect(chats.map(chat => chat.name ?? phoneFromJid(chat.jid))).toEqual([
      'Maya Chen',
      'Hike Crew',
      'Sam Rivera',
      'Bike Shop',
      'Jordan Lee',
      '+12025550199',
    ]);
    expect(chats.filter(chat => chat.unreadCount > 0).map(chat => chat.name ?? chat.jid)).toEqual([
      'Maya Chen',
      'Hike Crew',
      '12025550199@s.whatsapp.net',
    ]);
    expect(chats.map(chat => chatPreview(chat))).toEqual([
      'Can you bring the projector?',
      'Leo: Photo: Trail map',
      // Sam's last record is a reaction to your message, not yet loaded.
      'Reacted ❤️',
      'Document: Invoice_0042.pdf',
      'Location: Central Station',
      'Hi! Is the desk still available?',
    ]);
    // Every number sits in the 555-0100..0199 range reserved for fiction.
    for (const jid of [...chats.map(chat => chat.jid), ...contacts.keys()]) {
      if (!jid.endsWith('@g.us')) {
        expect(jid).toMatch(/^120255501\d\d@s\.whatsapp\.net$/);
      }
    }
  });

  it('keeps messages from both sides and group sender names', async () => {
    const client = createDemoClient();
    const chats = parseChats(await client.findChats(40));
    const maya = parseMessages(await client.findMessages(chats[0].jid, 30));
    expect(maya.some(message => message.fromMe)).toBe(true);
    expect(maya.some(message => !message.fromMe)).toBe(true);
    const group = splitReactions(parseMessages(await client.findMessages(chats[1].jid, 30))).messages;
    expect(group.filter(message => !message.fromMe).map(message => message.senderName)).toEqual([
      'Ana Ruiz',
      'Leo Park',
      'Priya Nair',
      'Leo Park',
    ]);
  });

  it('stores sent replies, answers once, and clears unread on read', async () => {
    vi.useFakeTimers();
    const client = createDemoClient();
    const [maya] = parseChats(await client.findChats(40));
    const sending = client.sendText(maya.jid, 'Sure, I will bring it.');
    await vi.advanceTimersByTimeAsync(1000);
    const response = (await sending) as {status: string; key: {fromMe: boolean}};
    expect(response.status).toBe('PENDING');
    expect(response.key.fromMe).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    let texts = parseMessages(await client.findMessages(maya.jid, 30)).map(message => message.content.text);
    expect(texts.slice(-2)).toEqual(['Sure, I will bring it.', 'Perfect, thanks! See you at 10.']);

    const second = client.sendText(maya.jid, 'Done.');
    await vi.advanceTimersByTimeAsync(5000);
    await second;
    texts = parseMessages(await client.findMessages(maya.jid, 30)).map(message => message.content.text);
    expect(texts.at(-1)).toBe('Done.');

    await client.markMessagesAsRead([{id: 'x', fromMe: false, remoteJid: maya.jid}]);
    const [after] = parseChats(await client.findChats(40));
    expect(after.unreadCount).toBe(0);
  });

  it('starts from the same chats on every launch', async () => {
    const first = createDemoClient();
    const [maya] = parseChats(await first.findChats(40));
    await first.markMessagesAsRead([{id: 'x', fromMe: false, remoteJid: maya.jid}]);
    const [fresh] = parseChats(await createDemoClient().findChats(40));
    expect(fresh.unreadCount).toBe(2);
  });

  it('has stacked reactions, pictures, a photo and a voice note', async () => {
    // Packaged assets resolve against the page origin (127.0.0.1 on the glasses).
    vi.stubGlobal('location', {href: 'http://127.0.0.1:5500/'});
    const client = createDemoClient();
    const chats = parseChats(await client.findChats(40));
    const [maya, hike, sam, bikes, jordan, unknown] = chats;
    const group = splitReactions(parseMessages(await client.findMessages(hike.jid, 30)));
    const leaving = group.messages.find(message => message.content.text === 'Me! Leaving at 7.');
    expect(group.reactions.get(leaving?.id ?? '')).toEqual([
      {emoji: '👍', count: 2, mine: false},
      {emoji: '❤️', count: 1, mine: true},
    ]);
    // Pictures: Maya and the group in findChats, Sam and the shop on request, none for the others.
    expect(maya.avatarUrl).toBeTruthy();
    expect(hike.avatarUrl).toBeTruthy();
    expect(sam.avatarUrl).toBeUndefined();
    expect(await client.fetchProfilePictureUrl(bikes.jid)).toBeTruthy();
    expect(await client.fetchProfilePictureUrl(jordan.jid)).toBeNull();
    expect(await client.fetchProfilePictureUrl(unknown.jid)).toBeNull();

    vi.useFakeTimers();
    const thread = parseMessages(await client.findMessages(maya.jid, 30));
    const voice = thread.find(message => message.content.kind === 'audio');
    const photo = thread.find(message => message.content.kind === 'photo');
    expect(voice?.content.seconds).toBe(6);
    const voiceMedia = client.getMediaMessage({id: voice?.id ?? '', fromMe: false, remoteJid: maya.jid});
    const photoMedia = client.getMediaMessage({id: photo?.id ?? '', fromMe: false, remoteJid: maya.jid});
    const text = thread.find(message => message.content.kind === 'text');
    const notMedia = client.getMediaMessage({id: text?.id ?? '', fromMe: false, remoteJid: maya.jid});
    notMedia.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await voiceMedia).toMatchObject({mimetype: 'audio/ogg; codecs=opus'});
    expect((await photoMedia).url).toBeTruthy();
    await expect(notMedia).rejects.toThrow('not of the media type');
  });
});
