// Keyboard-only end-to-end tests against the mock Evolution API v2 server.
//
//   npm run build && npm run test:e2e              (Chromium + Firefox)
//   E2E_BROWSERS=chromium npm run test:e2e
//   E2E_SKIP_SLOW=1 npm run test:e2e               (skips the 30 s retry window test)
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
  const context = await browser.newContext({viewport: {width: 600, height: 600}, locale});
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

    // Open the conversation with Enter
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${encodeURIComponent(ANA)}`);
    await waitForText(page, 'Levo o projetor');
    for (const text of ['Audio', 'Combinado, até amanhã', 'Reaction 👍', 'Oi! Tudo certo para amanhã?']) {
      await waitForText(page, text);
    }
    await page.waitForTimeout(600);
    assert.equal(await activeLabel(page), 'textarea|Reply to Ana Souza', 'reply field has initial focus');
    const anaAfterOpen = (await mockChats()).find(chat => chat.remoteJid === ANA);
    assert.equal(anaAfterOpen.unreadCount, 0, 'opening the chat marks its messages as read');
    await page.screenshot({path: path.join(outDir, `${label}-2-thread.png`)});

    // Reply by dictation, sent with Enter in the field
    await dictate(page, 'Pode deixar, obrigado');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await waitForText(page, 'Pode deixar, obrigado');
    let sent = await mockSent();
    assert.deepEqual(sent.at(-1), {number: ANA, text: 'Pode deixar, obrigado', quoted: null});
    assert.equal(await page.inputValue('textarea'), '', 'field is cleared after sending');

    // Quoted reply: pick a bubble with Enter, dictate, send with the Send button
    await pressUntil(page, 'ArrowUp', /Oi! Tudo certo para amanhã\?/);
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
    await page.screenshot({path: path.join(outDir, `${label}-3-quote.png`)});
    await press(page, 'Enter');
    await waitForText(page, 'Sim, tudo certo');
    sent = await mockSent();
    assert.equal(sent.at(-1).text, 'Sim, tudo certo');
    assert.equal(sent.at(-1).quoted.message.conversation, 'Oi! Tudo certo para amanhã?');
    assert.equal(sent.at(-1).quoted.key.remoteJid, ANA);

    // New incoming message shows up by polling
    await mockPost('/__mock/incoming', {remoteJid: ANA, text: 'Chegando em 5 min', pushName: 'Ana Souza'});
    await waitForText(page, 'Chegando em 5 min', 8000);
    await page.screenshot({path: path.join(outDir, `${label}-4-thread-new.png`)});

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
    await page.screenshot({path: path.join(outDir, `${label}-5-list-new.png`)});

    // Replying to a chat further down moves it to the top; Back still lands on it
    await pressUntil(page, 'ArrowDown', /^div\|Diego Alves, /);
    await press(page, 'Enter');
    await waitForText(page, 'Document');
    await page.waitForTimeout(600);
    await dictate(page, 'Recebi, obrigado');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
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
        await test(`[${name}] list, thread, dictated reply, quoted reply, polling, Back`, () => mainFlow(browser, name));

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

      await test('[chromium] Connecting… while the internet comes up, then the list', async () => {
        await mockPost('/__mock/reset', {downForMs: 7000});
        const {context, page} = await newPage(browser);
        try {
          const started = Date.now();
          await page.goto(`${APP}/?${configQuery()}`);
          await waitForText(page, 'Connecting…', 3000);
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
            await waitForText(page, 'Connecting…', 3000);
            await page.waitForTimeout(20000);
            assert.equal(await page.getByText('Connecting…').count(), 1, 'still retrying at 20 s');
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

      if (packageServer) {
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
