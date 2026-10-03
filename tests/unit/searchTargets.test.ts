import {describe, expect, it} from 'vitest';
import {accountKey, parseContactList, phoneFromJid} from '../../src/evolution/parse';
import {rankByName} from '../../src/search/nameMatch';
import {searchCandidates, uniqueTargets, type SearchTarget} from '../../src/search/searchTargets';

// findContacts as Evolution returns it for an account with communities and
// numbers saved twice (fields trimmed to those the app reads).
const findContacts = [
  {remoteJid: '120363111111111111@g.us', pushName: 'Comunidade Lovable Day', type: 'group'},
  {remoteJid: '120363222222222222@g.us', pushName: 'Comunidade Lovable Day', type: 'group'},
  {remoteJid: '120363333333333333@g.us', pushName: 'Comunidade Vintage Time - 02', type: 'group'},
  {remoteJid: '5511988887777@s.whatsapp.net', pushName: 'Paulo Mendes', type: 'contact'},
  {remoteJid: '551188887777@s.whatsapp.net', pushName: 'Paulo Mendes', type: 'contact'},
  {remoteJid: '5511988887777:12@s.whatsapp.net', pushName: 'Paulo Mendes', type: 'contact'},
  {remoteJid: '98765432101234@lid', pushName: 'Paulo Mendes', type: 'contact'},
  {remoteJid: '5521977776666@s.whatsapp.net', pushName: 'João Silva', type: 'contact'},
  {remoteJid: '5531955554444@s.whatsapp.net', pushName: 'João Silva', type: 'contact'},
  {remoteJid: '5511999990001@s.whatsapp.net', pushName: 'Ana Souza', type: 'contact'},
  {remoteJid: '5511944443333@s.whatsapp.net', pushName: 'Ana Souza', type: 'contact'},
  {remoteJid: '5511933332222@s.whatsapp.net', pushName: 'Bruno Lima', type: 'group_member'},
];

const chat = (id: string, name: string, isGroup = false): SearchTarget => ({
  id,
  name,
  phone: phoneFromJid(id),
  isGroup,
  detail: 'last message',
  inChats: true,
});

const chats = [
  chat('5511999990001@s.whatsapp.net', 'Ana Souza'),
  chat('120363444444444444@g.us', 'Comunidade Vintage Time - 02', true),
];

function targets(): SearchTarget[] {
  const contacts = parseContactList(findContacts).map(contact => ({
    id: contact.jid,
    name: contact.name,
    phone: phoneFromJid(contact.jid),
    isGroup: contact.isGroup,
    detail: null,
    inChats: false,
  }));
  return uniqueTargets(chats, contacts, accountKey);
}

const found = (query: string) => rankByName(query, searchCandidates(targets())).map(match => `${match.name}|${match.item.id}`);

describe('accountKey', () => {
  it('is the same for one account under different JID spellings', () => {
    expect(accountKey('5511988887777@s.whatsapp.net')).toBe(accountKey('551188887777@s.whatsapp.net'));
    expect(accountKey('5511988887777:12@s.whatsapp.net')).toBe(accountKey('5511988887777@s.whatsapp.net'));
    expect(accountKey('5511988887777@S.WHATSAPP.NET')).toBe(accountKey('5511988887777@s.whatsapp.net'));
  });

  it('keeps different numbers apart (landlines, other countries, groups)', () => {
    expect(accountKey('551133334444@s.whatsapp.net')).not.toBe(accountKey('5511933334444@s.whatsapp.net'));
    expect(accountKey('5521977776666@s.whatsapp.net')).not.toBe(accountKey('5531955554444@s.whatsapp.net'));
    expect(accountKey('15550100106@s.whatsapp.net')).toBe('15550100106@s.whatsapp.net');
    expect(accountKey('120363111111111111@g.us')).not.toBe(accountKey('120363222222222222@g.us'));
  });
});

describe('uniqueTargets', () => {
  it('lists a community and its announcements group once', () => {
    expect(found('comunidade lovable day')).toEqual(['Comunidade Lovable Day|120363111111111111@g.us']);
  });

  it('lists a person saved under several JIDs once (ninth digit, device suffix, @lid)', () => {
    expect(found('Paulo Mendes')).toEqual(['Paulo Mendes|5511988887777@s.whatsapp.net']);
  });

  it('keeps only the chat when a contact has the same account or the same name', () => {
    expect(found('comunidade vintage')).toEqual(['Comunidade Vintage Time - 02|120363444444444444@g.us']);
    // Same account as the chat, and another number saved with the chat's name.
    expect(found('Ana Souza')).toEqual(['Ana Souza|5511999990001@s.whatsapp.net']);
  });

  it('keeps people with the same name and different numbers', () => {
    expect(found('João Silva')).toEqual(['João Silva|5521977776666@s.whatsapp.net', 'João Silva|5531955554444@s.whatsapp.net']);
  });

  it('keeps every chat and the remaining contacts, chats first', () => {
    expect(targets().map(target => `${target.inChats ? 'chat' : 'contact'}:${target.name}`)).toEqual([
      'chat:Ana Souza',
      'chat:Comunidade Vintage Time - 02',
      'contact:Comunidade Lovable Day',
      'contact:Paulo Mendes',
      'contact:João Silva',
      'contact:João Silva',
      'contact:Bruno Lima',
    ]);
  });
});
