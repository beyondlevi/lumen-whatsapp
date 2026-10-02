// Keyboard-only end-to-end tests against the mock Evolution API v2 server.
//
//   npm run build && npm run test:e2e              (Chromium + Firefox)
//   E2E_BROWSERS=chromium npm run test:e2e
//   E2E_SKIP_SLOW=1 npm run test:e2e               (skips the 30 s retry window test)
//   E2E_VIEWPORT=480x640 npm run test:e2e          (Rokid HUD size; default 600x600)
//
// The built app is served like the Lumen host serves a package (static files,
// SPA fallback) on 127.0.0.1:4173; the mock runs on 127.0.0.1:8089, so every
// call is a real cross-origin request with a CORS preflight. The offline
// package test unzips dist/<name>.mrbd.zip and serves that instead.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {chromium, firefox} from 'playwright';
import {MOCK_API_KEY, MOCK_INSTANCE, startMockServer} from '../../mock/server.mjs';
import {fakeAudioScript} from './fakeAudio.mjs';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const outDir = path.join(root, '.e2e-output');
const MOCK = 'http://127.0.0.1:8089';
const APP = 'http://127.0.0.1:4173';
const PACKAGE_APP = 'http://127.0.0.1:5500';
const ANA = '5511999990001@s.whatsapp.net';
const CARLA = '5511999990003@s.whatsapp.net';
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox').split(',');
const results = [];

fs.mkdirSync(outDir, {recursive: true});

function configQuery(overrides = {}) {
  return new URLSearchParams({
    'evolution.url': MOCK,
    'evolution.instance': MOCK_INSTANCE,
    'evolution.apiKey': MOCK_API_KEY,
    ...overrides,
  }).toString();
}

async function mockPost(pathname, body = {}) {
  const response = await fetch(`${MOCK}${pathname}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', apikey: MOCK_API_KEY},
    body: JSON.stringify(body),
  });
  return response.json();
}

const mockChats = () => mockPost(`/chat/findChats/${encodeURIComponent(MOCK_INSTANCE)}`, {});
const mockSent = () => fetch(`${MOCK}/__mock/sent`).then(response => response.json());

async function activeLabel(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '(body)';
    const name = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
    return `${element.tagName.toLowerCase()}|${name}`;
  });
}

async function press(page, key, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
}

async function pressUntil(page, key, pattern, max = 8) {
  for (let i = 0; i < max; i += 1) {
    await press(page, key);
    if (pattern.test(await activeLabel(page))) return;
  }
  throw new Error(`focus never matched ${pattern}; last: ${await activeLabel(page)}`);
}

async function waitForText(page, text, timeout = 10000) {
  await page.getByText(text, {exact: false}).first().waitFor({state: 'visible', timeout});
}

async function bubbleLabels(page) {
  return page.$$eval('.message-stack [aria-label]', elements =>
    elements.map(element => element.getAttribute('aria-label')),
  );
}

async function rowLabels(page) {
  return page.$$eval('[role="button"][aria-label]', elements =>
    elements.map(element => element.getAttribute('aria-label')),
  );
}

/** Simulates the platform dictation composer: `input` events, then `change`. */
async function dictate(page, text) {
  await page.evaluate(value => {
    const field = document.activeElement;
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('reply field is not focused');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let current = '';
    for (const word of value.split(' ')) {
      current = current ? `${current} ${word}` : word;
      setter.call(field, current);
      field.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: word}));
    }
    field.dispatchEvent(new Event('change', {bubbles: true}));
  }, text);
  await page.waitForTimeout(200);
}

/** True when the app left Escape unhandled (so the host can close the app). */
async function escapeReachesHost(page) {
  await page.evaluate(() => {
    window.__escapePrevented = null;
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.__escapePrevented = event.defaultPrevented;
    }, {once: true});
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return page.evaluate(() => window.__escapePrevented === false);
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({name, ok: true, ms: Date.now() - started});
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({name, ok: false, error: error.message});
    console.log(`FAIL ${name}\n     ${error.stack?.split('\n').slice(0, 8).join('\n     ')}`);
  }
}

async function newPage(browser, {locale = 'en-US', initScript, audio = false} = {}) {
  const [width, height] = (process.env.E2E_VIEWPORT ?? '600x600').split('x').map(Number);
  const context = await browser.newContext({viewport: {width, height}, locale});
  if (initScript) await context.addInitScript(initScript);
  // The Lumen host's microphone/dictation API, scripted (see fakeAudio.mjs).
  if (audio) await context.addInitScript(fakeAudioScript(`${MOCK}/__mock/files/voice-note.ogg`));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|ERR_|NetworkError|CORS|fonts\.g/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return {context, page, problems};
}

async function mainFlow(browser, label, appUrl = APP) {
  await mockPost('/__mock/reset');
  const {context, page, problems} = await newPage(browser);
  try {
    // Chat list
    await page.goto(`${appUrl}/?${configQuery()}`);
    await waitForText(page, 'Chats');
    await waitForText(page, 'Carla Dias'); // name resolved through findContacts
    assert.equal(new URL(page.url()).search, '', 'config parameters are removed from the URL');
    const rows = await rowLabels(page);
    assert.deepEqual(
      rows.map(row => row.split(', ').slice(0, 2).join(', ')),
      [
        'Ana Souza, Levo o projetor',
        'Unknown contact, Sticker',
        'Família, Bruno: Photo: Olha isso',
        'Carla Dias, You: Audio',
        'Diego Alves, Document',
      ],
      `chat rows (status@broadcast hidden): ${JSON.stringify(rows)}`,
    );
    const unread = await page.$$eval('[role="img"][aria-label$="Unread Status"]', e => e.map(x => x.getAttribute('aria-label')));
    assert.deepEqual(unread, ['Ana Souza, Unread Status', 'Unknown contact, Unread Status']);
    assert.match(await activeLabel(page), /^div\|Ana Souza, /, 'first chat has initial focus');
    await page.screenshot({path: path.join(outDir, `${label}-1-list.png`)});

    // Open the conversation with Enter: actions rail, no reply field yet
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await waitForText(page, 'Levo o projetor');
    for (const text of ['0:07', 'Combinado, até amanhã', 'Oi! Tudo certo para amanhã?', 'Reply']) {
      await waitForText(page, text);
    }
    await page.waitForTimeout(600);
    // Ana's 👍 is a badge on the message it reacts to, never a bubble; the rail has no tails toggle.
    assert.ok((await bubbleLabels(page)).some(label => /Combinado, até amanhã, .*reactions 👍 1$/.test(label)), 'reaction badge');
    assert.equal(await page.getByText('Reaction 👍').count(), 0, 'no reaction bubble');
    assert.equal(await page.getByText(/tails/i).count(), 0, 'no Hide tails button');
    assert.equal(await page.locator('textarea').count(), 0, 'reply field only appears after Reply');
    assert.ok(
      await page.evaluate(() => [...document.querySelectorAll('[aria-disabled="true"], [disabled]')].some(element => /Voice/.test(element.textContent ?? '') || /Voice/.test(element.getAttribute('aria-label') ?? ''))),
      'Voice is disabled when the host has no window.lumen.audio',
    );
    assert.notEqual(await activeLabel(page), '(body)', 'something visible has focus on entry');
    const anaAfterOpen = (await mockChats()).find(chat => chat.remoteJid === ANA);
    assert.equal(anaAfterOpen.unreadCount, 0, 'opening the chat marks its messages as read');
    await page.screenshot({path: path.join(outDir, `${label}-2-thread.png`)});

    // Reply → field → dictation → Enter sends and closes the field
    await pressUntil(page, 'ArrowDown', /^div\|Reply$/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'textarea|Reply to Ana Souza', 'Reply opens the focused field');
    await dictate(page, 'Pode deixar, obrigado');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await waitForText(page, 'Pode deixar, obrigado');
    let sent = await mockSent();
    assert.deepEqual(sent.at(-1), {number: ANA, text: 'Pode deixar, obrigado', quoted: null});
    await page.waitForTimeout(500);
    assert.equal(await page.locator('textarea').count(), 0, 'field closes after sending');
    assert.equal(await activeLabel(page), 'div|Reply', 'focus returns to Reply');

    // Reply, then Back closes only the field
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'textarea|Reply to Ana Souza');
    await press(page, 'Escape');
    assert.equal(await page.locator('textarea').count(), 0);
    assert.match(page.url(), /\/chat\//, 'Back from the field stays in the conversation');

    // Bubble menu → Reply: quoted reply, sent with the Send button
    await pressUntil(page, 'ArrowUp', /Oi! Tudo certo para amanhã\?/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|React with 👍', 'the menu opens on the first reaction');
    await page.screenshot({path: path.join(outDir, `${label}-3-menu.png`)});
    await pressUntil(page, 'ArrowRight', /^div\|Reply$/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'textarea|Reply to Ana Souza');
    await page.waitForFunction(
      () => document.body.innerHTML.includes('Reply to “Oi! Tudo certo para ama…”'),
      null,
      {timeout: 3000},
    );
    await dictate(page, 'Sim, tudo certo');
    await press(page, 'ArrowRight');
    assert.match(await activeLabel(page), /Send/, 'ArrowRight reaches the Send action');
    await page.screenshot({path: path.join(outDir, `${label}-4-quote.png`)});
    await press(page, 'Enter');
    await waitForText(page, 'Sim, tudo certo');
    sent = await mockSent();
    assert.equal(sent.at(-1).text, 'Sim, tudo certo');
    assert.equal(sent.at(-1).quoted.message.conversation, 'Oi! Tudo certo para amanhã?');
    assert.equal(sent.at(-1).quoted.key.remoteJid, ANA);

    // Bubble menu → reaction
    await pressUntil(page, 'ArrowUp', /Levo o projetor/);
    await press(page, 'Enter');
    await pressUntil(page, 'ArrowRight', /React with ❤️/);
    await press(page, 'Enter');
    await waitForText(page, 'Reacted ❤️');
    const reactions = await fetch(`${MOCK}/__mock/reactions`).then(response => response.json());
    assert.equal(reactions.at(-1).reaction, '❤️');
    assert.equal(reactions.at(-1).key.remoteJid, ANA);
    assert.equal(reactions.at(-1).key.fromMe, false);
    await page.waitForTimeout(300);
    assert.match(await activeLabel(page), /Levo o projetor/, 'focus returns to the bubble');
    assert.match(await activeLabel(page), /reactions ❤️ 1$/, 'the badge shows at once');
    await page.waitForTimeout(3500);
    assert.ok((await bubbleLabels(page)).some(label => /Levo o projetor, .*reactions ❤️ 1$/.test(label)), 'badge kept after the poll');
    assert.equal(await page.getByText('Reaction ❤️').count(), 0, 'no reaction bubble after the poll');

    // The list previews the last real message, not your reaction
    await press(page, 'Escape');
    await page.waitForURL(`${appUrl}/`);
    await page.waitForTimeout(600);
    assert.match((await rowLabels(page))[0], /^Ana Souza, You: Sim, tudo certo, /);
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(800);

    // New incoming message shows up by polling
    await mockPost('/__mock/incoming', {remoteJid: ANA, text: 'Chegando em 5 min', pushName: 'Ana Souza'});
    await waitForText(page, 'Chegando em 5 min', 8000);
    await page.screenshot({path: path.join(outDir, `${label}-5-thread-new.png`)});

    // Escape returns to the list with focus on the same chat
    await press(page, 'Escape');
    await page.waitForURL(`${appUrl}/`);
    await waitForText(page, 'Chats');
    await page.waitForTimeout(600);
    assert.match(await activeLabel(page), /^div\|Ana Souza, /, 'focus returns to the opened chat');
    const anaRow = (await rowLabels(page))[0];
    assert.match(anaRow, /^Ana Souza, Chegando em 5 min/);

    // Another chat receives a message while the list is open
    await mockPost('/__mock/incoming', {remoteJid: CARLA, text: 'Cheguei', pushName: 'Carla Dias'});
    await page.waitForFunction(
      () => document.querySelector('[role="button"][aria-label]')?.getAttribute('aria-label')?.startsWith('Carla Dias, Cheguei'),
      null,
      {timeout: 8000},
    );
    const unreadNow = await page.$$eval('[role="img"][aria-label$="Unread Status"]', e => e.map(x => x.getAttribute('aria-label')));
    assert.ok(unreadNow.includes('Carla Dias, Unread Status'), 'new message is highlighted as unread');
    assert.ok(!unreadNow.includes('Ana Souza, Unread Status'), 'read chat is not highlighted');
    await page.screenshot({path: path.join(outDir, `${label}-6-list-new.png`)});

    // Replying to a chat further down moves it to the top; Back still lands on it
    await pressUntil(page, 'ArrowDown', /^div\|Diego Alves, /);
    await press(page, 'Enter');
    await waitForText(page, 'Document');
    await page.waitForTimeout(600);
    await pressUntil(page, 'ArrowDown', /^div\|Reply$/);
    await press(page, 'Enter');
    await dictate(page, 'Recebi, obrigado');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await page.waitForTimeout(400);
    await press(page, 'Escape');
    await page.waitForURL(`${appUrl}/`);
    await page.waitForTimeout(800);
    assert.match(await activeLabel(page), /^div\|Diego Alves, /, 'focus returns to the replied chat');
    await page.waitForFunction(
      () => document.querySelector('[role="button"][aria-label]')?.getAttribute('aria-label')?.startsWith('Diego Alves, You: Recebi'),
      null,
      {timeout: 8000},
    );
    assert.match(await activeLabel(page), /^div\|Diego Alves, /, 'focus follows the chat when the list re-sorts');

    // Escape on the list is left to the platform (closes the app)
    assert.equal(await escapeReachesHost(page), true, 'Escape on the list is not consumed');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

// Demo mode. Storage holds sentinel "real" data under the app's keys; none of
// it may appear on screen, nothing may be written, and every request outside
// the app's own origin is blocked and recorded.
const SENTINEL = 'REAL-DATA-SENTINEL';
const realStorage = {
  'lumen-whatsapp.chat-cache.v1': JSON.stringify({
    account: `${MOCK}\nLumen Test`,
    savedAt: 1790000000000,
    chats: [{
      jid: '5511999990001@s.whatsapp.net', name: `${SENTINEL} Person`, isGroup: false, unreadCount: 3,
      lastMessage: {id: 'real-1', remoteJid: '5511999990001@s.whatsapp.net', fromMe: false, senderName: `${SENTINEL} Person`,
        timestamp: 4102444800000, content: {kind: 'text', text: `${SENTINEL} message`}},
      timestamp: 4102444800000,
    }],
    threads: {},
  }),
  'lumen-whatsapp.read-marks': JSON.stringify({'5511999990001@s.whatsapp.net': 1}),
  'lumen-whatsapp.dev-config': JSON.stringify({'evolution.url': MOCK, 'evolution.instance': 'Lumen Test', 'evolution.apiKey': 'mock-api-key'}),
};

function lumenInitScript(values) {
  return `
    (() => {
      const seed = ${JSON.stringify(realStorage)};
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      let values = ${JSON.stringify(values)};
      const listeners = [];
      window.__lumenSet = next => { values = next; listeners.forEach(cb => cb({...values})); };
      window.lumen = {config: {
        get: async () => ({...values}),
        onChange: cb => { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
      }};
    })();`;
}

const SERVER_CONFIG = {'evolution.url': MOCK, 'evolution.instance': MOCK_INSTANCE, 'evolution.apiKey': MOCK_API_KEY};
const DEMO_CONFIG = {...SERVER_CONFIG, demo: 'demo-captures'};
const MAYA = '12025550101@s.whatsapp.net';
const HIKE = '120363000000000042@g.us';

async function demoPage(browser, appUrl, values, blocked) {
  // pt-PT device: demo mode must still be in English.
  const opened = await newPage(browser, {locale: 'pt-PT', initScript: lumenInitScript(values)});
  await opened.context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(appUrl)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  return opened;
}

async function assertNoRealData(page) {
  const html = await page.content();
  assert.ok(!html.includes(SENTINEL), 'no cached real data on screen');
  for (const word of ['Ana Souza', 'Carla Dias', 'Conversas', 'Ontem', 'Você']) {
    assert.ok(!html.includes(word), `"${word}" is not on screen`);
  }
}

/** Replays the capture script from the delivery notes, key by key, with its waits. */
async function demoFlow(browser, label, appUrl = APP, {audioOutput = true} = {}) {
  const blocked = [];
  const {context, page, problems} = await demoPage(browser, appUrl, DEMO_CONFIG, blocked);
  const shots = [];
  const step = async (keys, wait, name, check) => {
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
      if (process.env.E2E_TRACE) console.log(`     ${key} -> ${await activeLabel(page)}`);
    }
    await page.waitForTimeout(wait);
    if (check) await check();
    await assertNoRealData(page);
    if (name) {
      await page.screenshot({path: path.join(outDir, `${label}-demo-${name}.png`)});
      shots.push(name);
    }
  };
  const unreadRows = () => page.$$eval('[role="img"][aria-label$="Unread Status"]', e => e.map(x => x.getAttribute('aria-label')));
  // On entry, focus lands on Reply or on the newest bubble; Down then Left
  // always ends on Reply.
  const toReply = ['ArrowDown', 'ArrowLeft'];
  try {
    await page.goto(`${appUrl}/`);
    // 1. Chat list: pictures, unread, a reaction preview
    await step([], 3000, '01-list', async () => {
      await waitForText(page, 'Chats');
      assert.deepEqual(
        (await rowLabels(page)).map(row => row.split(', ').slice(0, 2).join(', ')),
        [
          'Maya Chen, Can you bring the projector?',
          'Hike Crew, Leo: Photo: Trail map',
          'Sam Rivera, Reacted ❤️',
          'Bike Shop, Document: Invoice_0042.pdf',
          'Jordan Lee, Location: Central Station',
          '+12025550199, Hi! Is the desk still available?',
        ],
      );
      assert.deepEqual(await unreadRows(), ['Maya Chen, Unread Status', 'Hike Crew, Unread Status', '+12025550199, Unread Status']);
      assert.match(await activeLabel(page), /^div\|Maya Chen, /);
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
      const pictures = await avatarSources(page);
      for (const name of ['maya', 'hike', 'sam', 'bikes']) {
        assert.ok(pictures.some(src => src.includes(`avatar-${name}`) || src.startsWith('data:image/webp')), `${name} picture`);
      }
      assert.ok(pictures.length >= 4, `four pictures: ${pictures.length}`);
      assert.ok(await page.getByText('JL', {exact: true}).count() >= 1, 'Jordan keeps initials');
    });
    // 2. End of the list: document, location, unknown number
    await step(['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'], 500, '02-list-end', async () => {
      assert.match(await activeLabel(page), /^div\|\+12025550199, /);
    });
    // 3. Group chat, then its stacked reactions
    await step(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter'], 2000, null);
    await step(toReply, 300, '03-group', async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(HIKE)));
      assert.equal(await activeLabel(page), 'div|Reply');
      for (const text of ['Hike Crew', 'Priya Nair', 'Leo Park', 'Photo: Trail map', 'Count me in.']) await waitForText(page, text);
    });
    await step(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp'], 500, '04-group-reactions', async () => {
      assert.match(await activeLabel(page), /Me! Leaving at 7\., .*reactions 👍 2, ❤️ 1$/);
      assert.ok(await page.getByText('👍❤️', {exact: true}).count() >= 1, 'stacked badge');
      assert.equal(await page.getByText(/^Reaction /).count(), 0, 'no reaction bubbles');
    });
    // 4. Back to the list, then the 1:1 conversation
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /^div\|Hike Crew, /);
    });
    await step(['ArrowUp', 'Enter'], 2000, null);
    await step(toReply, 300, '05-thread', async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(MAYA)));
      await waitForText(page, 'Can you bring the projector?');
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 5. Reply
    await step(['Enter'], 800, '06-reply-field', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
    });
    await dictate(page, 'Sure, I will bring it.');
    await step([], 300, '07-reply-draft');
    await step(['ArrowRight'], 300, '08-send-focused', async () => {
      assert.equal(await activeLabel(page), 'div|Send');
    });
    await step(['Enter'], 800, '09-sent', async () => {
      await waitForText(page, 'Message sent', 2000);
      assert.equal(await page.locator('textarea').count(), 0);
    });
    await step([], 6500, '10-answer', async () => {
      await waitForText(page, 'Perfect, thanks! See you at 10.', 1000);
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 6. Message menu and reaction: a badge on that bubble
    await step(['ArrowUp', 'Enter'], 800, '11-menu', async () => {
      assert.equal(await activeLabel(page), 'div|React with 👍');
    });
    await step(['ArrowRight', 'Enter'], 600, '12-reacted', async () => {
      await waitForText(page, 'Reacted ❤️', 2000);
      assert.match(await activeLabel(page), /Perfect, thanks! See you at 10\., .*reactions ❤️ 1$/);
    });
    // 7. Quoted reply from the menu (Back closes the field without sending)
    await step(['Enter', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    await step(['Enter'], 800, '13-quoted-reply', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
      const hint = await page.evaluate(() => [...document.querySelectorAll('*')].map(e => e.childNodes.length === 1 && e.textContent?.startsWith('Reply to “') ? e.textContent : null).filter(Boolean).concat(document.querySelector('textarea')?.placeholder ?? ''));
      assert.ok(hint.includes('Reply to “Perfect, thanks! See yo…”'), `quote hint: ${JSON.stringify(hint)}`);
    });
    await step(['Escape'], 800, null, async () => {
      assert.equal(await page.locator('textarea').count(), 0);
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 8. Record and send a voice note (simulated microphone in demo mode)
    await step(['ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Voice');
    });
    await step(['Enter'], 3000, '14-recording', async () => {
      assert.match(page.url(), /\/record$/);
      assert.equal(await activeLabel(page), 'div|Send');
      await waitForText(page, '0:02', 1000);
    });
    // The demo microphone takes 1 s to start and the audio 2 s to arrive after Send.
    await step(['Enter'], 300, null, async () => {
      await waitForText(page, 'Finishing…', 1000);
      assert.equal(await activeLabel(page), 'div|Send');
    });
    await step([], 2200, '15-voice-sent', async () => {
      await waitForText(page, 'Voice message sent', 2000);
      assert.doesNotMatch(page.url(), /\/record$/);
      assert.equal(await activeLabel(page), 'div|Voice');
      assert.ok((await bubbleLabels(page)).some(label => /You: Voice message, 0:0[234]/.test(label)), 'sent voice note');
    });
    // 9. Voice message menu: Listen, Pause, Transcribe
    await step(['ArrowLeft', ...Array(5).fill('ArrowUp')], 300, null, async () => {
      assert.match(await activeLabel(page), /Maya Chen: Voice message, 0:06/);
    });
    await step(['Enter'], 800, '16-audio-menu', async () => {
      assert.equal(await activeLabel(page), 'div|Listen');
      assert.ok(await page.getByText('Transcribe', {exact: true}).count() >= 1);
    });
    await step(['Enter'], 2000, audioOutput ? '17-audio-playing' : null, async () => {
      if (audioOutput) assert.match(await activeLabel(page), /Playing, 0:0[1-5] of 0:06/);
    });
    await step(['Enter'], 600, null, async () => {
      if (audioOutput) assert.equal(await activeLabel(page), 'div|Pause');
    });
    await step(['Enter'], 300, audioOutput ? '18-audio-paused' : null, async () => {
      if (audioOutput) assert.match(await activeLabel(page), /Paused, 0:0[1-5] of 0:06/);
    });
    await step(['Enter', 'ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Transcribe');
    });
    await step(['Enter'], 1500, '19-transcribing', async () => {
      assert.match(page.url(), /\/transcript\//);
      await waitForText(page, 'Transcribing', 1000);
      await waitForText(page, 'Morning! Quick update', 1000);
    });
    await step([], 4000, '20-transcript', async () => {
      await waitForText(page, 'Save me a seat, see you soon.', 1000);
      assert.equal(await page.getByText('Transcribing').count(), 0);
    });
    await step(['Escape'], 1500, '21-transcript-in-bubble', async () => {
      assert.match(await activeLabel(page), /Maya Chen: Voice message, 0:06/);
      await waitForText(page, "Morning! Quick update: I'm on my way", 1000);
    });
    // 9. Photo: View is the first menu item; Back returns to the same bubble
    await step(['ArrowUp'], 300, null, async () => {
      assert.match(await activeLabel(page), /Photo: Sketch from Monday/);
    });
    await step(['Enter'], 800, '22-photo-menu', async () => {
      assert.equal(await activeLabel(page), 'div|View');
    });
    await step(['Enter'], 2000, '23-photo-view', async () => {
      assert.match(page.url(), /\/photo\//);
      assert.ok(await page.evaluate(() => document.querySelector('.photo-image')?.naturalWidth > 0), 'photo shown');
    });
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /Photo: Sketch from Monday/);
    });
    // 10. Your own message with Maya's 👍
    await step(['ArrowUp', 'ArrowUp'], 500, '24-reaction-badge', async () => {
      assert.match(await activeLabel(page), /Yes, 10:00 in Room 3\., .*reactions 👍 1$/);
    });
    // 11. Back to the list: read, on top, previewing the last real message
    await step(['Escape'], 1500, '25-list-after', async () => {
      assert.match(await activeLabel(page), /^div\|Maya Chen, You: Audio, /);
      assert.deepEqual(await unreadRows(), ['+12025550199, Unread Status']);
    });
    assert.equal(await escapeReachesHost(page), true, 'Escape on the list is left to the platform');

    const fonts = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
    assert.deepEqual(blocked.filter(url => !fonts.test(url)), [], 'no request outside the app origin');
    assert.deepEqual(
      await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))),
      Object.fromEntries(Object.keys(realStorage).sort().map(key => [key, realStorage[key]])),
      'storage is left exactly as it was',
    );
    assert.deepEqual(problems, []);
    return {shots, blocked};
  } finally {
    await context.close();
  }
}

const FAMILY = '120363000000000001@g.us';

/** Waits until the focused element's label matches. */
async function waitForFocus(page, pattern, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (pattern.test(await activeLabel(page))) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`focus never matched ${pattern}; last: ${await activeLabel(page)}`);
}

/** Avatar <img> sources currently in the document. */
async function avatarSources(page) {
  return page.$$eval('img', images => images.filter(image => image.complete && image.naturalWidth > 0).map(image => image.src));
}

/** Profile pictures, full-screen photo (and its failure), and voice playback against the mock. */
async function mediaFlow(browser, {audioOutput}) {
  await mockPost('/__mock/reset');
  const {context, page, problems} = await newPage(browser);
  try {
    await page.goto(`${APP}/?${configQuery()}`);
    await waitForText(page, 'Carla Dias');
    await page.waitForTimeout(1500);
    // Ana's picture comes with findChats; Família's from fetchProfilePictureUrl;
    // Carla's URL is broken and keeps the initials.
    const sources = await avatarSources(page);
    assert.ok(sources.some(src => src.endsWith('/avatar-maya.webp')), `Ana picture: ${sources}`);
    assert.ok(sources.some(src => src.endsWith('/avatar-hike.webp')), `Família picture: ${sources}`);
    assert.ok(!sources.some(src => src.includes('missing')), 'broken picture not shown');
    assert.ok(await page.getByText('CD', {exact: true}).count() >= 1, 'Carla keeps her initials');
    const requested = await fetch(`${MOCK}/__mock/picture-requests`).then(response => response.json());
    assert.ok(requested.includes(FAMILY) && requested.includes(CARLA) && !requested.includes(ANA), `lookups: ${requested}`);
    await page.screenshot({path: path.join(outDir, 'media-1-avatars.png')});

    // Next launch: pictures known from the cache, no new lookups
    await mockPost('/__mock/reset');
    await page.reload();
    await waitForText(page, 'Carla Dias');
    await page.waitForTimeout(1500);
    assert.deepEqual(await fetch(`${MOCK}/__mock/picture-requests`).then(response => response.json()), [], 'cached lookups');

    // Família: photo → menu with View first → full screen → Back to the same bubble
    await pressUntil(page, 'ArrowDown', /^div\|Família, /);
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(FAMILY)}`);
    await waitForText(page, 'Photo: Olha isso');
    await page.waitForTimeout(800);
    assert.ok((await avatarSources(page)).some(src => src.endsWith('/avatar-hike.webp')), 'header picture');
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Photo: Olha isso/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|View', 'View is the first menu item for a photo');
    await page.screenshot({path: path.join(outDir, 'media-2-photo-menu.png')});
    await press(page, 'Enter');
    await page.waitForURL(/\/photo\//);
    await page.waitForFunction(() => document.querySelector('.photo-image')?.naturalWidth > 0, null, {timeout: 8000});
    const requests = await fetch(`${MOCK}/__mock/media-requests`).then(response => response.json());
    assert.equal(requests.length, 1, 'media downloaded once, on open');
    assert.equal(requests[0].key.remoteJid, FAMILY);
    await page.screenshot({path: path.join(outDir, 'media-3-photo.png')});
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(FAMILY)}`);
    await waitForFocus(page, /Photo: Olha isso/);

    // Download failure: error copy and Try again
    await mockPost('/__mock/reset', {mediaFails: true});
    // Reloading drops the in-memory copy of the photo already opened.
    await page.reload();
    await waitForText(page, 'Photo: Olha isso');
    await page.waitForTimeout(800);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Photo: Olha isso/);
    await press(page, 'Enter');
    await press(page, 'Enter');
    await waitForText(page, "Couldn't load the photo");
    await waitForText(page, 'rejected by the server');
    await page.screenshot({path: path.join(outDir, 'media-4-photo-error.png')});
    await pressUntil(page, 'ArrowDown', /Try again/);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(FAMILY)}`);

    // Ana's voice message: Enter plays and pauses
    await mockPost('/__mock/reset');
    await page.goto(`${APP}/chat/${encodeURIComponent(ANA)}`);
    await waitForText(page, '0:07');
    await page.waitForTimeout(800);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Voice message/, 10);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|Listen', 'the voice message menu starts with Listen');
    assert.ok(await page.getByText('Transcribe (not available on this device)').count() + (await page.$$('[aria-label="Transcribe (not available on this device)"]')).length >= 1, 'Transcribe is off without the host API');
    await press(page, 'Enter');
    if (audioOutput) {
      await waitForFocus(page, /Playing, 0:0[1-6] of 0:0[67]/, 6000);
      await page.screenshot({path: path.join(outDir, 'media-5-audio-playing.png')});
      await press(page, 'Enter');
      assert.equal(await activeLabel(page), 'div|Pause', 'Listen reads Pause while playing');
      await press(page, 'Enter');
      await waitForFocus(page, /Paused, /);
    }
    const audioRequest = (await fetch(`${MOCK}/__mock/media-requests`).then(response => response.json())).at(-1);
    assert.equal(audioRequest.convertToMp4, false, 'OGG/Opus plays as is');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

/** Voice notes through the scripted window.lumen.audio, against the mock: record, send, discard, limit, errors, transcribe. */
async function voiceFlow(browser) {
  await mockPost('/__mock/reset');
  const {context, page, problems} = await newPage(browser, {audio: true});
  const audioLog = () => page.evaluate(() => window.__audioLog);
  const voiceSent = () => fetch(`${MOCK}/__mock/voice`).then(response => response.json());
  const control = value => page.evaluate(next => Object.assign(window.__audioControl, next), value);
  const toVoice = async () => {
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Voice');
  };
  try {
    await page.goto(`${APP}/?${configQuery()}`);
    await waitForText(page, 'Carla Dias');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await waitForText(page, 'Levo o projetor');
    await page.waitForTimeout(800);
    await toVoice();

    // Record and send
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Recording');
    assert.equal(await activeLabel(page), 'div|Send', 'Send has the initial focus');
    await waitForText(page, '0:01', 3000);
    await page.screenshot({path: path.join(outDir, 'voice-1-recording.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    let sent = await voiceSent();
    assert.equal(sent.length, 1);
    assert.deepEqual({number: sent[0].number, head: sent[0].head, encoding: sent[0].encoding}, {number: ANA, head: 'OggS', encoding: true});
    assert.equal((await audioLog()).stops, 1);
    await page.waitForTimeout(500);
    assert.ok((await bubbleLabels(page)).some(label => /You: Voice message, 0:0\d/.test(label)), 'the sent voice note shows');
    { const label = await activeLabel(page); assert.equal(label, 'div|Voice', `focus returns to Voice, got ${label}`); }

    // Discard, then Back: nothing sent, recordings cancelled
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await page.waitForTimeout(600);
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Discard');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(500);
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await page.waitForTimeout(600);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(500);
    assert.equal((await audioLog()).cancels, 2, 'Discard and Back cancel the recording');
    assert.equal((await voiceSent()).length, 1, 'nothing more was sent');

    // The 2-minute limit: the host ends the recording, the app asks Send / Discard
    await control({endAfterMs: 1200});
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Reached the 2:00 limit', 4000);
    assert.equal(await activeLabel(page), 'div|Send');
    assert.equal((await audioLog()).records.at(-1).maxMs, 120000, 'records with the 2-minute limit');
    await page.screenshot({path: path.join(outDir, 'voice-2-limit.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    assert.equal((await voiceSent()).length, 2);
    await control({endAfterMs: null});
    await page.waitForTimeout(500);

    // A host as slow as the glasses: "Starting…" until record() resolves, then
    // "Finishing…" until stop() resolves; Send is disabled in both and keeps the focus.
    const sendDisabled = () =>
      page.evaluate(() => [...document.querySelectorAll('[aria-disabled="true"], [disabled]')].some(element => /^Send$/.test((element.textContent ?? '').trim()) || element.getAttribute('aria-label') === 'Send'));
    // The thread behind may show "0:01" too: read the time in the recording panel only.
    const panelShows = text => page.locator('.record-panel').getByText(text, {exact: true}).waitFor({timeout: 4000});
    await control({startDelayMs: 1500, stopDelayMs: 2000});
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Starting…', 1000);
    assert.equal(await activeLabel(page), 'div|Send', 'Send has the focus while the microphone starts');
    await page.waitForTimeout(600); // let the route transition finish (the microphone takes 1.5 s here)
    await page.getByText('Starting…').first().waitFor({timeout: 500});
    await page.screenshot({path: path.join(outDir, 'voice-5-starting.png')});
    const stopsBefore = (await audioLog()).stops;
    await press(page, 'Enter');
    await page.waitForTimeout(200);
    assert.equal((await audioLog()).stops, stopsBefore, 'Send does nothing until the microphone has started');
    await panelShows('0:01');
    assert.equal(await sendDisabled(), false, 'Send is enabled while recording');
    assert.equal(await activeLabel(page), 'div|Send');
    await press(page, 'Enter');
    await waitForText(page, 'Finishing…', 1000);
    assert.equal(await sendDisabled(), true, 'Send is disabled while the audio arrives');
    assert.equal(await activeLabel(page), 'div|Send', 'Send keeps the focus while finishing');
    await page.screenshot({path: path.join(outDir, 'voice-6-finishing.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    assert.equal((await audioLog()).stops, stopsBefore + 1, 'Enter while finishing does nothing');
    assert.equal((await voiceSent()).length, 3);
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(500);
    // Back while finishing drops the recording: nothing is sent when stop() resolves
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await panelShows('0:01');
    await press(page, 'Enter');
    await waitForText(page, 'Finishing…', 1000);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(2500);
    assert.equal((await voiceSent()).length, 3, 'Back while finishing sends nothing');
    await control({startDelayMs: 0, stopDelayMs: 0});
    await page.waitForTimeout(500);

    // Host errors: busy (then Try again works), no-phone
    await control({recordError: 'busy'});
    await press(page, 'Enter');
    await waitForText(page, "Couldn't record");
    await waitForText(page, 'busy with another recording or dictation');
    assert.equal(await activeLabel(page), 'div|Try again');
    await page.screenshot({path: path.join(outDir, 'voice-3-busy.png')});
    await press(page, 'Enter');
    await waitForText(page, '0:01', 3000);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(500);
    await control({recordError: 'no-phone'});
    await press(page, 'Enter');
    await waitForText(page, 'not connected to the phone');
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await page.waitForTimeout(500);

    // Transcribe Ana's voice note: partials, then the text; kept for the session
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Ana Souza: Voice message/, 12);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|Listen');
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Transcribe');
    await press(page, 'Enter');
    await page.waitForURL(/\/transcript\//);
    await waitForText(page, 'Transcribing');
    await page.waitForFunction(() => window.__audioLog.partials >= 2, null, {timeout: 3000});
    await waitForText(page, 'This is a fake transcript of the voice message.', 5000);
    await page.screenshot({path: path.join(outDir, 'voice-4-transcript.png')});
    await press(page, 'Escape');
    await waitForFocus(page, /Ana Souza: Voice message/);
    await waitForText(page, 'This is a fake transcript');
    await press(page, 'Enter');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, 'This is a fake transcript of the voice message.', 1000);
    assert.equal((await audioLog()).transcribes, 1, 'the second opening uses the kept transcript');
    await press(page, 'Escape');
    await waitForFocus(page, /Ana Souza: Voice message/);

    // Engine error, then Try again
    await control({transcribeError: 'engine', transcript: 'Second try worked.'});
    await pressUntil(page, 'ArrowDown', /You: Voice message/, 12);
    await press(page, 'Enter');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, "Couldn't transcribe");
    await waitForText(page, 'The transcription engine failed: Model not downloaded');
    await pressUntil(page, 'ArrowDown', /Try again/);
    await press(page, 'Enter');
    await waitForText(page, 'Second try worked.', 5000);
    await press(page, 'Escape');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

async function run() {
  const mockServer = await startMockServer(8089);
  const appServer = await startStaticServer(path.join(root, 'dist'), 4173);
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-whatsapp-package-'));
  const zipPath = path.join(root, 'dist', 'lumen-whatsapp.mrbd.zip');
  let packageServer = null;
  if (fs.existsSync(zipPath)) {
    for (const [name, data] of Object.entries(unzipSync(fs.readFileSync(zipPath)))) {
      const target = path.join(packageDir, name);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, data);
    }
    packageServer = await startStaticServer(packageDir, 5500);
  }

  try {
    for (const name of browsers) {
      const browser = await (name === 'firefox' ? firefox : chromium).launch();
      try {
        await test(`[${name}] list, thread actions, Reply field, bubble menu (reaction + quoted reply), polling, Back`, () => mainFlow(browser, name));

        await test(`[${name}] demo mode: capture script, fictional chats only, no requests, storage untouched`, async () => {
          // The sandbox has no audio output for Firefox; it decodes but cannot play (see the Opus test).
          const {blocked} = await demoFlow(browser, name, APP, {audioOutput: name !== 'firefox'});
          console.log(`     blocked (Toolkit font only): ${JSON.stringify(blocked)}`);
        });

        await test(`[${name}] voice notes: record, send, discard, Back, 2-minute limit, busy/no-phone, transcribe (partials, kept, engine error)`, () => voiceFlow(browser));

        await test(`[${name}] setup screen without configuration`, async () => {
          const {context, page, problems} = await newPage(browser);
          try {
            await page.goto(`${APP}/`);
            await waitForText(page, 'Connect WhatsApp');
            await waitForText(page, 'Server URL, Instance, and API key');
            await page.screenshot({path: path.join(outDir, `${name}-setup.png`)});
            await press(page, 'ArrowDown', 2);
            assert.match(await activeLabel(page), /Check again/);
            await press(page, 'Enter');
            await waitForText(page, 'Still not configured');
            assert.equal(await escapeReachesHost(page), true);
            assert.deepEqual(problems, []);
          } finally {
            await context.close();
          }
        });

        await test(`[${name}] pt locale (pt-PT glasses)`, async () => {
          await mockPost('/__mock/reset');
          const {context, page} = await newPage(browser, {locale: 'pt-PT'});
          try {
            await page.goto(`${APP}/?${configQuery()}`);
            await waitForText(page, 'Conversas');
            await waitForText(page, 'Bruno: Foto: Olha isso');
            await waitForText(page, 'Você: Áudio');
            await waitForText(page, 'Contato desconhecido');
            await page.screenshot({path: path.join(outDir, `${name}-pt-list.png`)});
          } finally {
            await context.close();
          }
        });
      } finally {
        await browser.close();
      }
    }

    const browser = await chromium.launch();
    try {
      const errorCase = (name, overrides, texts) =>
        test(`[chromium] ${name}`, async () => {
          const {context, page, problems} = await newPage(browser);
          try {
            await page.goto(`${APP}/?${configQuery(overrides)}`);
            for (const text of texts) await waitForText(page, text);
            await page.screenshot({path: path.join(outDir, `error-${name.replace(/\W+/g, '-')}.png`)});
            if (!overrides['evolution.url']) {
              await press(page, 'ArrowDown', 2);
              assert.match(await activeLabel(page), /Try again/);
              await press(page, 'Enter');
              await waitForText(page, texts[0]);
            }
            assert.deepEqual(problems, []);
          } finally {
            await context.close();
          }
        });

      await errorCase('401 API key rejected', {'evolution.apiKey': 'wrong-key'}, ['API key rejected', 'HTTP 401']);
      await errorCase('404 instance not found', {'evolution.instance': 'Other Phone'}, ['Instance not found', '“Other Phone”', 'HTTP 404']);
      await errorCase('invalid server URL', {'evolution.url': 'evo.example.com'}, ['Invalid server URL']);

      await test('[chromium] header spinner while the internet comes up, then the list', async () => {
        await mockPost('/__mock/reset', {downForMs: 7000});
        const {context, page} = await newPage(browser);
        try {
          const started = Date.now();
          await page.goto(`${APP}/?${configQuery()}`);
          await waitForText(page, 'Loading…', 3000);
          await page.screenshot({path: path.join(outDir, 'connecting.png')});
          await waitForText(page, 'Ana Souza', 15000);
          assert.ok(Date.now() - started >= 6000, 'list appears only after the mock is reachable');
        } finally {
          await context.close();
        }
      });

      if (!process.env.E2E_SKIP_SLOW) {
        await test('[chromium] network error after 30 s of retries', async () => {
          const {context, page} = await newPage(browser);
          try {
            await page.goto(`${APP}/?${configQuery({'evolution.url': 'http://127.0.0.1:8099'})}`);
            await waitForText(page, 'Loading…', 3000);
            await page.waitForTimeout(20000);
            assert.equal(await page.getByText('Loading…').count(), 1, 'still retrying at 20 s');
            await waitForText(page, "Can't reach the server", 20000);
            await page.screenshot({path: path.join(outDir, 'error-network.png')});
          } finally {
            await context.close();
          }
        });
      }

      await test('[chromium] window.lumen.config contract (get + onChange), URL fallback ignored', async () => {
        await mockPost('/__mock/reset');
        const initScript = `
          (() => {
            let values = ${JSON.stringify({
              'evolution.url': MOCK,
              'evolution.instance': MOCK_INSTANCE,
              'evolution.apiKey': MOCK_API_KEY,
            })};
            const listeners = [];
            window.__lumenSet = next => { values = next; listeners.forEach(cb => cb({...values})); };
            window.__lumenGetCalls = 0;
            window.lumen = {config: {
              get: async () => { window.__lumenGetCalls += 1; return {...values}; },
              onChange: cb => { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
            }};
          })();`;
        const {context, page, problems} = await newPage(browser, {initScript});
        try {
          await page.goto(`${APP}/?${configQuery({'evolution.apiKey': 'from-url'})}`);
          await waitForText(page, 'Ana Souza');
          assert.equal(new URL(page.url()).search, '', 'URL parameters are stripped');
          assert.equal(
            await page.evaluate(() => localStorage.getItem('lumen-whatsapp.dev-config')),
            null,
            'URL parameters are not stored when window.lumen exists',
          );
          assert.ok((await page.evaluate(() => window.__lumenGetCalls)) >= 1);
          await page.evaluate(key => window.__lumenSet({...{'evolution.url': 'http://127.0.0.1:8089', 'evolution.instance': 'Lumen Test'}, 'evolution.apiKey': key}), 'changed-on-phone');
          await waitForText(page, 'API key rejected');
          await page.evaluate(key => window.__lumenSet({'evolution.url': 'http://127.0.0.1:8089', 'evolution.instance': 'Lumen Test', 'evolution.apiKey': key}), MOCK_API_KEY);
          await waitForText(page, 'Ana Souza');
          await page.evaluate(() => window.__lumenSet({'evolution.url': 'http://127.0.0.1:8089'}));
          await waitForText(page, 'Connect WhatsApp');
          await waitForText(page, 'Instance and API key');
          assert.deepEqual(problems, []);
        } finally {
          await context.close();
        }
      });

      await test('[chromium] cached chats show at once on the next launch, header spins until refreshed', async () => {
        await mockPost('/__mock/reset');
        const {context, page} = await newPage(browser);
        try {
          await page.goto(`${APP}/?${configQuery()}`);
          await waitForText(page, 'Carla Dias');
          await page.waitForTimeout(1200);
          await mockPost('/__mock/reset', {downForMs: 6000});
          const started = Date.now();
          await page.reload();
          await waitForText(page, 'Ana Souza', 1500);
          assert.ok(Date.now() - started < 1500, 'list comes from the cache');
          await waitForText(page, 'Loading…', 1000);
          assert.equal(await page.getByText('Chats', {exact: true}).count(), 0, 'header shows the spinner');
          await page.screenshot({path: path.join(outDir, 'cached-launch.png')});
          await waitForText(page, 'Chats', 15000);
          assert.equal(await page.getByText('Loading…').count(), 0);
          assert.ok(
            !(await page.evaluate(() => localStorage.getItem('lumen-whatsapp.chat-cache.v1') ?? '')).includes('mock-api-key'),
            'the API key is not in the chat cache',
          );
        } finally {
          await context.close();
        }
      });

      await test('[chromium] profile pictures, full-screen photo (View, Back, failure) and voice playback', () =>
        mediaFlow(browser, {audioOutput: true}));

      await test('[firefox] OGG/Opus voice note decodes (no audio output in this sandbox)', async () => {
        const gecko = await firefox.launch();
        try {
          const page = await gecko.newPage();
          await page.goto(`${MOCK}/__mock/files/voice-note.ogg`).catch(() => {});
          const result = await page.evaluate(async url => {
            const blob = new Blob([await (await fetch(url)).arrayBuffer()], {type: 'audio/ogg'});
            const audio = new Audio(URL.createObjectURL(blob));
            await new Promise((resolve, reject) => {
              audio.addEventListener('loadedmetadata', resolve);
              audio.addEventListener('error', () => reject(new Error(`media error ${audio.error?.code}`)));
            });
            return {duration: audio.duration, canPlay: audio.canPlayType('audio/ogg; codecs=opus')};
          }, `${MOCK}/__mock/files/voice-note.ogg`);
          assert.equal(result.canPlay, 'probably');
          assert.ok(Math.abs(result.duration - 6) < 0.1, `duration ${result.duration}`);
        } finally {
          await gecko.close();
        }
      });

      await test('[chromium] control: without demo, the seeded cache is what the list shows', async () => {
        const blocked = [];
        const {context, page} = await demoPage(browser, APP, SERVER_CONFIG, blocked);
        try {
          await page.goto(`${APP}/`);
          await waitForText(page, `${SENTINEL} Person`, 3000);
        } finally {
          await context.close();
        }
      });

      await test('[chromium] demo mode switched on and off from the phone while the app is open', async () => {
        await mockPost('/__mock/reset');
        const {context, page, problems} = await newPage(browser, {initScript: lumenInitScript(SERVER_CONFIG)});
        try {
          await page.goto(`${APP}/`);
          await waitForText(page, 'Carla Dias');
          await page.waitForTimeout(800);
          await page.evaluate(values => window.__lumenSet(values), {...SERVER_CONFIG, demo: 'yes'});
          await page.waitForTimeout(800);
          assert.ok((await page.content()).includes('Carla Dias'), 'any other value keeps the server');
          await page.evaluate(values => window.__lumenSet(values), DEMO_CONFIG);
          await waitForText(page, 'Maya Chen');
          await page.waitForTimeout(500);
          await assertNoRealData(page);
          const before = await page.evaluate(() => localStorage.getItem('lumen-whatsapp.chat-cache.v1'));
          await press(page, 'Enter');
          await waitForText(page, 'Can you bring the projector?');
          await page.waitForTimeout(1500);
          await press(page, 'Escape');
          await page.waitForTimeout(800);
          assert.equal(await page.evaluate(() => localStorage.getItem('lumen-whatsapp.chat-cache.v1')), before, 'demo does not write the cache');
          await page.evaluate(values => window.__lumenSet(values), {...SERVER_CONFIG, demo: ''});
          await waitForText(page, 'Ana Souza');
          await waitForText(page, 'Chats');
          await page.waitForTimeout(1000);
          const html = await page.content();
          assert.ok(!html.includes('Maya Chen'), 'no demo chats after leaving demo mode');
          const cache = await page.evaluate(() => localStorage.getItem('lumen-whatsapp.chat-cache.v1') ?? '');
          assert.ok(cache.includes('Ana Souza') && !cache.includes('Maya Chen'), 'cache holds only server chats');
          const marks = await page.evaluate(() => localStorage.getItem('lumen-whatsapp.read-marks') ?? '');
          assert.ok(!marks.includes('12025550'), 'no demo read marks stored');
          assert.deepEqual(problems, []);
        } finally {
          await context.close();
        }
      });

      if (packageServer) {
        await test('[chromium] offline package (.mrbd.zip) in demo mode: capture script with every outside request blocked', async () => {
          const pkg = await chromium.launch();
          try {
            await demoFlow(pkg, 'package', PACKAGE_APP);
          } finally {
            await pkg.close();
          }
        });

        await test('[chromium] offline package (.mrbd.zip) served from 127.0.0.1, only the Evolution server reachable', async () => {
          const blocked = [];
          const pkg = await chromium.launch();
          try {
            await mainFlowWithRoutes(pkg, blocked);
          } finally {
            await pkg.close();
          }
          const unexpected = blocked.filter(url => !url.includes('fonts.googleapis.com') && !url.includes('fonts.gstatic.com'));
          assert.deepEqual(unexpected, [], 'no other external requests');
        });
      }
    } finally {
      await browser.close();
    }
  } finally {
    mockServer.close();
    appServer.close();
    packageServer?.close();
  }

  const failed = results.filter(result => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

/** The main flow against the unzipped package, with outside requests blocked. */
async function mainFlowWithRoutes(browser, blocked) {
  const original = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await original(options);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(PACKAGE_APP) || url.startsWith(MOCK)) return route.continue();
      blocked.push(url);
      return route.abort();
    });
    return context;
  };
  await mainFlow(browser, 'package', PACKAGE_APP);
}

await run();
