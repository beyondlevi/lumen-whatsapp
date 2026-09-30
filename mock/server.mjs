// Mock Evolution API v2 server for development and tests. It serves the
// endpoints the app uses with the response shapes of Evolution v2.3.x
// (findChats array with embedded lastMessage, findMessages
// {messages: {total, pages, currentPage, records}}, sendText 201 message,
// error bodies {status, error, response: {message}}), and the same guard order:
// unknown instance -> 404 before the apikey check -> 401.
//
// Usage: node mock/server.mjs [--port 8089]
//   instance: "Lumen Test" (has a space, to exercise URL-encoding)
//   apikey:   "mock-api-key" (fake, local only)
// Test controls (not part of Evolution):
//   POST /__mock/reset              {downForMs?}  reseed; refuse connections for downForMs
//   POST /__mock/incoming           {remoteJid, text, pushName?}  deliver a new message
//   GET  /__mock/sent               messages sent through sendText
//   GET  /__mock/reactions          reactions sent through sendReaction
import http from 'node:http';

export const MOCK_INSTANCE = 'Lumen Test';
export const MOCK_API_KEY = 'mock-api-key';
const INSTANCE_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

let state;
let downUntil = 0;
let idCounter = 0;

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}${String(idCounter).padStart(18, '0')}`;
}

function record({remoteJid, fromMe, pushName, message, messageType, secondsAgo, participant, status}) {
  const key = {id: nextId(fromMe ? '3EB0' : '3A'), fromMe, remoteJid};
  if (participant) key.participant = participant;
  return {
    id: nextId('cmb'),
    key,
    pushName: fromMe ? 'Você' : pushName ?? null,
    messageType,
    message,
    messageTimestamp: Math.floor(Date.now() / 1000) - secondsAgo,
    instanceId: INSTANCE_ID,
    source: fromMe ? 'web' : 'android',
    contextInfo: null,
    MessageUpdate: status ? [{status}] : [],
    // Internal: incoming messages stay unread until markMessageAsRead.
    _unread: !fromMe && status !== 'READ',
  };
}

const text = value => ({message: {conversation: value}, messageType: 'conversation'});

function seed() {
  const ana = '5511999990001@s.whatsapp.net';
  const family = '120363000000000001@g.us';
  const carla = '5511999990003@s.whatsapp.net';
  const diego = '5511999990005@s.whatsapp.net';
  const lid = '123456789012345@lid';
  const bruno = '5511999990002@s.whatsapp.net';
  const messages = [
    // Ana: two unread texts, reaction and voice note.
    record({remoteJid: ana, fromMe: false, pushName: 'Ana Souza', secondsAgo: 7200, messageType: 'audioMessage',
      message: {audioMessage: {url: 'https://mmg.whatsapp.net/v/t62.7117-24/000_n.enc', mimetype: 'audio/ogg; codecs=opus', seconds: 7, ptt: true}}}),
    record({remoteJid: ana, fromMe: true, secondsAgo: 3600, status: 'READ', ...text('Combinado, até amanhã')}),
    record({remoteJid: ana, fromMe: false, pushName: 'Ana Souza', secondsAgo: 3500, messageType: 'reactionMessage',
      message: {reactionMessage: {key: {id: '3EB0DEADBEEF0000000002', fromMe: true, remoteJid: ana}, text: '👍'}}}),
    record({remoteJid: ana, fromMe: false, pushName: 'Ana Souza', secondsAgo: 240, ...text('Oi! Tudo certo para amanhã?')}),
    record({remoteJid: ana, fromMe: false, pushName: 'Ana Souza', secondsAgo: 180, ...text('Levo o projetor')}),
    // Family group: photo from Bruno, read.
    record({remoteJid: family, fromMe: false, pushName: 'Bruno Lima', participant: bruno, secondsAgo: 5400, status: 'READ', ...text('Almoço no domingo?')}),
    record({remoteJid: family, fromMe: true, secondsAgo: 5300, status: 'READ', ...text('Eu vou')}),
    record({remoteJid: family, fromMe: false, pushName: 'Bruno Lima', participant: bruno, secondsAgo: 5000, status: 'READ',
      messageType: 'imageMessage', message: {imageMessage: {caption: 'Olha isso', mimetype: 'image/jpeg'}}}),
    // Carla: last message is our voice note (yesterday).
    record({remoteJid: carla, fromMe: false, pushName: 'Carla Dias', secondsAgo: 90000, status: 'READ', ...text('Me manda o endereço?')}),
    record({remoteJid: carla, fromMe: true, secondsAgo: 86500, status: 'READ', messageType: 'audioMessage',
      message: {audioMessage: {seconds: 12, ptt: true}}}),
    // Diego: document, read, three days ago.
    record({remoteJid: diego, fromMe: false, pushName: 'Diego Alves', secondsAgo: 260000, status: 'READ', messageType: 'documentMessage',
      message: {documentMessage: {fileName: 'orcamento.pdf', mimetype: 'application/pdf'}}}),
    // Unknown @lid contact: sticker, unread, no name anywhere.
    record({remoteJid: lid, fromMe: false, pushName: null, secondsAgo: 600, messageType: 'stickerMessage',
      message: {stickerMessage: {mimetype: 'image/webp'}}}),
    // Status broadcast: must be hidden by the app.
    record({remoteJid: 'status@broadcast', fromMe: false, pushName: 'Ana Souza', secondsAgo: 60, ...text('status')}),
  ];
  const contacts = [
    {remoteJid: ana, pushName: 'Ana Souza', type: 'contact'},
    {remoteJid: family, pushName: 'Família', type: 'group'},
    {remoteJid: carla, pushName: 'Carla Dias', type: 'contact'},
    {remoteJid: bruno, pushName: 'Bruno Lima', type: 'group_member'},
    {remoteJid: diego, pushName: 'Diego Alves', type: 'contact'},
  ];
  // Chat.name (returned as pushName by findChats on v2.3.x): null for Carla and Diego.
  const chatNames = {[ana]: 'Ana Souza', [family]: 'Família'};
  return {messages, contacts, chatNames, sent: [], reactions: []};
}

function reset(downForMs = 0) {
  idCounter = 0;
  state = seed();
  downUntil = Date.now() + downForMs;
}

function cleanLastMessage(message) {
  const {_unread, MessageUpdate, ...rest} = message;
  const status = MessageUpdate.length ? MessageUpdate[MessageUpdate.length - 1].status : 'DELIVERY_ACK';
  const cleaned = {...rest, participant: null, sessionId: null, status};
  // Evolution strips media down in chat.lastMessage (cleanMessageData).
  const m = message.message;
  if (m.imageMessage) cleaned.message = {imageMessage: {caption: m.imageMessage.caption}};
  if (m.audioMessage) cleaned.message = {audioMessage: {seconds: m.audioMessage.seconds}};
  if (m.stickerMessage) cleaned.message = {stickerMessage: {}};
  if (m.documentMessage) cleaned.message = {documentMessage: {caption: m.documentMessage.caption, name: m.documentMessage.name}};
  return cleaned;
}

function publicRecord(message) {
  const {_unread, ...rest} = message;
  return rest;
}

function findChats(body) {
  const byJid = new Map();
  for (const message of state.messages) {
    const jid = message.key.remoteJid;
    const current = byJid.get(jid);
    if (!current || current.messageTimestamp <= message.messageTimestamp) byJid.set(jid, message);
  }
  const chats = [...byJid.entries()].map(([jid, last]) => {
    const contact = state.contacts.find(c => c.remoteJid === jid);
    const unread = state.messages.filter(m => m.key.remoteJid === jid && m._unread).length;
    return {
      id: contact ? `contact-${jid}` : null,
      remoteJid: jid,
      pushName: state.chatNames[jid] ?? null,
      profilePicUrl: null,
      updatedAt: new Date(last.messageTimestamp * 1000).toISOString(),
      windowStart: null,
      windowExpires: null,
      windowActive: false,
      lastMessage: cleanLastMessage(last),
      unreadCount: unread,
      isSaved: Boolean(contact),
    };
  });
  chats.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return typeof body?.take === 'number' ? chats.slice(0, body.take) : chats;
}

function findMessages(body) {
  const remoteJid = body?.where?.key?.remoteJid;
  const pageSize = Number(body?.offset) || 50;
  const page = Number(body?.page) || 1;
  // Newest first; messages in the same second keep their arrival order.
  const all = state.messages
    .map((message, index) => ({message, index}))
    .filter(({message}) => !remoteJid || message.key.remoteJid === remoteJid)
    .sort((a, b) => b.message.messageTimestamp - a.message.messageTimestamp || b.index - a.index)
    .map(({message}) => message);
  const records = all.slice((page - 1) * pageSize, page * pageSize).map(publicRecord);
  return {messages: {total: all.length, pages: Math.ceil(all.length / pageSize), currentPage: page, records}};
}

function findContacts() {
  return state.contacts.map(contact => ({
    id: `contact-${contact.remoteJid}`,
    remoteJid: contact.remoteJid,
    pushName: contact.pushName,
    profilePicUrl: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-09-29T13:05:12.000Z',
    instanceId: INSTANCE_ID,
    isGroup: contact.remoteJid.endsWith('@g.us'),
    isSaved: true,
    type: contact.type,
  }));
}

function errorBody(status, error, message) {
  return {status, error, response: {message}};
}

function send(res, status, payload, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(payload));
}

function corsHeaders(origin) {
  // Like Evolution with CORS_ORIGIN=*: the cors package reflects the caller's origin.
  return origin
    ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'}
    : {'Access-Control-Allow-Origin': '*'};
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function route(method, pathname) {
  const match = /^\/(chat|message|instance)\/([A-Za-z]+)\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  let instance;
  try {
    instance = decodeURIComponent(match[3]);
  } catch {
    instance = null;
  }
  return {method, name: `${match[1]}/${match[2]}`, instance};
}

async function handle(req, res) {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/__mock/')) {
    if (url.pathname === '/__mock/reset' && req.method === 'POST') {
      const body = await readJson(req);
      reset(Number(body.downForMs) || 0);
      return send(res, 200, {ok: true}, origin);
    }
    if (url.pathname === '/__mock/incoming' && req.method === 'POST') {
      const body = await readJson(req);
      const message = record({remoteJid: body.remoteJid, fromMe: false, pushName: body.pushName ?? null,
        secondsAgo: 0, ...text(String(body.text))});
      state.messages.push(message);
      return send(res, 200, {ok: true, id: message.key.id}, origin);
    }
    if (url.pathname === '/__mock/reactions' && req.method === 'GET') {
      return send(res, 200, state.reactions, origin);
    }
    if (url.pathname === '/__mock/sent' && req.method === 'GET') {
      return send(res, 200, state.sent, origin);
    }
    return send(res, 404, {ok: false}, origin);
  }

  // Simulated "internet not up yet": drop the connection so fetch() rejects.
  if (Date.now() < downUntil) {
    req.socket.destroy();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'POST,GET,PUT,DELETE',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '',
      'Content-Length': '0',
    });
    return res.end();
  }

  const target = route(req.method, url.pathname);
  if (!target) {
    return send(res, 404, errorBody(404, 'Not Found', ['Cannot ' + req.method + ' ' + url.pathname]), origin);
  }
  if (target.instance !== MOCK_INSTANCE) {
    return send(res, 404, errorBody(404, 'Not Found', [`The "${target.instance}" instance does not exist`]), origin);
  }
  if (req.headers.apikey !== MOCK_API_KEY) {
    return send(res, 401, errorBody(401, 'Unauthorized', 'Unauthorized'), origin);
  }

  const body = req.method === 'POST' ? await readJson(req) : {};
  switch (`${req.method} ${target.name}`) {
    case 'POST chat/findChats':
      return send(res, 200, findChats(body), origin);
    case 'POST chat/findContacts':
      return send(res, 200, findContacts(), origin);
    case 'POST chat/findMessages':
      return send(res, 200, findMessages(body), origin);
    case 'POST chat/markMessageAsRead': {
      const ids = new Set((body.readMessages ?? []).map(key => key.id));
      for (const message of state.messages) if (ids.has(message.key.id)) message._unread = false;
      return send(res, 201, {message: 'Read messages', read: 'success'}, origin);
    }
    case 'POST message/sendText': {
      if (typeof body.text !== 'string' || body.text.trim() === '') {
        return send(res, 400, errorBody(400, 'Bad Request', ['Text is required']), origin);
      }
      const remoteJid = String(body.number).includes('@') ? String(body.number) : `${body.number}@s.whatsapp.net`;
      const message = record({remoteJid, fromMe: true, secondsAgo: 0, ...text(body.text)});
      state.messages.push(message);
      state.sent.push({number: body.number, text: body.text, quoted: body.quoted ?? null});
      const {id, MessageUpdate, _unread, ...response} = message;
      return send(res, 201, {...response, status: 'PENDING', contextInfo: {mentionedJid: [], groupMentions: []}}, origin);
    }
    case 'POST message/sendReaction': {
      const target = state.messages.find(message => message.key.id === body?.key?.id);
      if (!target || typeof body.reaction !== 'string') {
        return send(res, 400, errorBody(400, 'Bad Request', ['Message not found']), origin);
      }
      state.reactions.push({key: body.key, reaction: body.reaction});
      const reaction = record({remoteJid: target.key.remoteJid, fromMe: true, secondsAgo: 0,
        messageType: 'reactionMessage', message: {reactionMessage: {key: body.key, text: body.reaction}}});
      state.messages.push(reaction);
      const {id, MessageUpdate, _unread, ...response} = reaction;
      return send(res, 201, {...response, status: 'PENDING'}, origin);
    }
    case 'GET instance/connectionState':
      return send(res, 200, {instance: {instanceName: MOCK_INSTANCE, state: 'open'}}, origin);
    default:
      return send(res, 404, errorBody(404, 'Not Found', ['Cannot ' + req.method + ' ' + url.pathname]), origin);
  }
}

export function startMockServer(port = 8089, host = '127.0.0.1') {
  reset();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) send(res, 500, errorBody(500, 'Internal Server Error', String(error)), req.headers.origin);
    });
  });
  return new Promise(resolve => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 8089;
  await startMockServer(port);
  const base = `http://127.0.0.1:${port}`;
  const params = new URLSearchParams({
    'evolution.url': base,
    'evolution.instance': MOCK_INSTANCE,
    'evolution.apiKey': MOCK_API_KEY,
  });
  console.log(`Mock Evolution API v2 on ${base}`);
  console.log(`Open the app with: http://127.0.0.1:5173/?${params}`);
}
