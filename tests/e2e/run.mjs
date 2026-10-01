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
    console.log(`FAIL ${name}\n     ${error.stack?.split('\n').slice(0, 3).join('\n     ')}`);
  }
}

async function newPage(browser, {locale = 'en-US', initScript} = {}) {
  const [width, height] = (process.env.E2E_VIEWPORT ?? '600x600').split('x').map(Number);
  const context = await browser.newContext({viewport: {width, height}, locale});
  if (initScript) await context.addInitScript(initScript);
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
    for (const text of ['Audio', 'Combinado, até amanhã', 'Reaction 👍', 'Oi! Tudo certo para amanhã?', 'Hide tails']) {
      await waitForText(page, text);
    }
    await page.waitForTimeout(600);
    assert.equal(await page.locator('textarea').count(), 0, 'reply field only appears after Reply');
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
    assert.match(anaRow, /^Ana Souza, (Chegando em 5 min|You: Reaction)/);

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
async function demoFlow(browser, label, appUrl = APP) {
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
  try {
    await page.goto(`${appUrl}/`);
    // 1. Chat list
    await step([], 3000, '01-list', async () => {
      await waitForText(page, 'Chats');
      assert.deepEqual(
        (await rowLabels(page)).map(row => row.split(', ').slice(0, 2).join(', ')),
        [
          'Maya Chen, Can you bring the projector?',
          'Hike Crew, Leo: Photo: Trail map',
          'Sam Rivera, You: Sounds good',
          'Bike Shop, Document: Invoice_0042.pdf',
          'Jordan Lee, Location: Central Station',
          '+12025550199, Hi! Is the desk still available?',
        ],
      );
      const unread = await page.$$eval('[role="img"][aria-label$="Unread Status"]', e => e.map(x => x.getAttribute('aria-label')));
      assert.deepEqual(unread, ['Maya Chen, Unread Status', 'Hike Crew, Unread Status', '+12025550199, Unread Status']);
      assert.match(await activeLabel(page), /^div\|Maya Chen, /);
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    });
    // 2. End of the list: document, location, unknown number
    await step(['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'], 500, '02-list-end', async () => {
      assert.match(await activeLabel(page), /^div\|\+12025550199, /);
    });
    // 3. Group chat
    // On entry, focus lands on Reply or on the newest bubble; Down then Left
    // always ends on Reply.
    await step(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter'], 2000, null);
    await step(['ArrowDown', 'ArrowLeft'], 300, '03-group', async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(HIKE)));
      assert.equal(await activeLabel(page), 'div|Reply');
      for (const text of ['Hike Crew', 'Ana Ruiz', 'Priya Nair', 'Leo Park', 'Photo: Trail map', 'Count me in.']) await waitForText(page, text);
    });
    // 4. Back to the list, then the 1:1 conversation
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /^div\|Hike Crew, /);
    });
    await step(['ArrowUp', 'Enter'], 2000, null);
    await step(['ArrowDown', 'ArrowLeft'], 300, '04-thread', async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(MAYA)));
      await waitForText(page, 'Can you bring the projector?');
      await waitForText(page, "I'll share the slides before then.");
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 5. Reply field
    await step(['Enter'], 800, '05-reply-field', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
    });
    await dictate(page, 'Sure, I will bring it.');
    await step([], 300, '06-reply-draft');
    await step(['ArrowRight'], 300, '07-send-focused', async () => {
      assert.equal(await activeLabel(page), 'div|Send');
    });
    // 6. Send, toast, scripted answer
    await step(['Enter'], 800, '08-sent', async () => {
      await waitForText(page, 'Message sent', 2000);
      assert.equal(await page.locator('textarea').count(), 0);
    });
    await step([], 6500, '09-answer', async () => {
      await waitForText(page, 'Perfect, thanks! See you at 10.', 1000);
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 7. Message menu and reaction
    await step(['ArrowUp', 'Enter'], 800, '10-menu', async () => {
      assert.equal(await activeLabel(page), 'div|React with 👍');
    });
    await step(['ArrowRight', 'Enter'], 300, '11-reacted', async () => {
      await waitForText(page, 'Reacted ❤️', 2000);
    });
    // 8. Quoted reply from the menu (Back closes the field without sending)
    await step(['Enter', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    await step(['Enter'], 800, '12-quoted-reply', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
      const hint = await page.evaluate(() => [...document.querySelectorAll('*')].map(e => e.childNodes.length === 1 && e.textContent?.startsWith('Reply to “') ? e.textContent : null).filter(Boolean).concat(document.querySelector('textarea')?.placeholder ?? ''));
      assert.ok(hint.includes('Reply to “Perfect, thanks! See yo…”'), `quote hint: ${JSON.stringify(hint)}`);
    });
    await step(['Escape'], 800, null, async () => {
      assert.equal(await page.locator('textarea').count(), 0);
    });
    // 9. Back to the list: the chat is read and on top
    await step(['Escape'], 1500, '13-list-after', async () => {
      assert.match(await activeLabel(page), /^div\|Maya Chen, /);
      const unread = await page.$$eval('[role="img"][aria-label$="Unread Status"]', e => e.map(x => x.getAttribute('aria-label')));
      assert.deepEqual(unread, ['+12025550199, Unread Status']);
    });
    // A second visit may put focus on the newest bubble; Down then Left still reaches Reply.
    await step(['Enter'], 2000, null);
    await step(['ArrowDown', 'ArrowLeft'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /^div\|Maya Chen, /);
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
          const {blocked} = await demoFlow(browser, name);
          console.log(`     blocked (Toolkit font only): ${JSON.stringify(blocked)}`);
        });

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
