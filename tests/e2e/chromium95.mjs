// Keyboard smoke test on a real Chromium 95 (the Android System WebView
// version on the Rokid glasses). Playwright cannot drive a browser that old,
// so this uses puppeteer-core 11 (not a project dependency):
//
//   npm i --no-save puppeteer-core@11
//   curl -sSLo chrome95.zip https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/920005/chrome-linux.zip
//   unzip chrome95.zip -d /tmp/chrome95
//   CHROME95=/tmp/chrome95/chrome-linux/chrome npm run package && node tests/e2e/chromium95.mjs
//
// It runs the unzipped .mrbd.zip from 127.0.0.1 against the mock server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {MOCK_API_KEY, MOCK_INSTANCE, startMockServer} from '../../mock/server.mjs';
import {startStaticServer} from './static-server.mjs';

const puppeteer = (await import('puppeteer-core')).default;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const outDir = path.join(root, '.e2e-output');
const executablePath = process.env.CHROME95;
if (!executablePath) throw new Error('Set CHROME95 to the Chromium 95 binary');
fs.mkdirSync(outDir, {recursive: true});

const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-whatsapp-c95-'));
const zip = unzipSync(fs.readFileSync(path.join(root, 'dist', 'lumen-whatsapp.mrbd.zip')));
for (const [name, data] of Object.entries(zip)) {
  fs.mkdirSync(path.dirname(path.join(packageDir, name)), {recursive: true});
  fs.writeFileSync(path.join(packageDir, name), data);
}

const mock = await startMockServer(8089);
const app = await startStaticServer(packageDir, 5501);
const browser = await puppeteer.launch({executablePath, args: ['--no-sandbox'], defaultViewport: {width: 600, height: 600}});
const problems = [];
try {
  const page = await browser.newPage();
  console.log('browser', await browser.version());
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|fonts\.g/.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  const active = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      return `${element.tagName.toLowerCase()}|${element.getAttribute('aria-label') ?? element.textContent.trim()}`;
    });
  const press = async (key, times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
    }
  };
  const pressUntil = async (key, pattern, max = 8) => {
    for (let i = 0; i < max; i += 1) {
      await press(key);
      if (pattern.test(await active())) return;
    }
    throw new Error(`focus never matched ${pattern}; last: ${await active()}`);
  };
  const waitText = text =>
    page.waitForFunction(value => document.body.innerText.includes(value), {timeout: 10000}, text);

  const query = new URLSearchParams({
    'evolution.url': 'http://127.0.0.1:8089',
    'evolution.instance': MOCK_INSTANCE,
    'evolution.apiKey': MOCK_API_KEY,
  });
  await page.goto(`http://127.0.0.1:5501/?${query}`);
  await waitText('Carla Dias');
  await page.waitForTimeout(800);
  assert.match(await active(), /Ana Souza/);
  await page.screenshot({path: path.join(outDir, 'chromium95-list.png')});

  await pressUntil('ArrowDown', /Carla Dias/);
  await press('Enter');
  await waitText('Me manda o endereço?');
  await page.waitForTimeout(800);
  await pressUntil('ArrowDown', /^div\|Reply$/);
  await press('Enter');
  assert.equal(await active(), 'textarea|Reply to Carla Dias');

  await page.evaluate(() => {
    const field = document.activeElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, 'Rua das Flores 10');
    field.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText'}));
    field.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await press('Enter');
  await waitText('Message sent');
  const sent = await fetch('http://127.0.0.1:8089/__mock/sent').then(response => response.json());
  assert.equal(sent.at(-1).text, 'Rua das Flores 10');
  await page.screenshot({path: path.join(outDir, 'chromium95-thread.png')});

  // Bubble menu: reaction
  await page.waitForTimeout(600);
  await pressUntil('ArrowUp', /Me manda o endereço\?/);
  await press('Enter');
  assert.equal(await active(), 'div|React with 👍');
  await page.screenshot({path: path.join(outDir, 'chromium95-menu.png')});
  await pressUntil('ArrowRight', /React with 😂/);
  await press('Enter');
  await waitText('Reacted 😂');
  const reactions = await fetch('http://127.0.0.1:8089/__mock/reactions').then(response => response.json());
  assert.equal(reactions.at(-1).reaction, '😂');

  await press('Escape');
  await waitText('Chats');
  assert.equal(new URL(page.url()).pathname, '/');
  await page.waitForTimeout(800);
  assert.match(await active(), /Carla Dias/, 'focus returns to the chat that was open');
  // The next refresh moves Carla (latest message) to the top; focus moves with it.
  await page.waitForFunction(
    () => document.querySelector('[role="button"][aria-label]')?.getAttribute('aria-label')?.startsWith('Carla Dias, You:'),
    {timeout: 8000},
  );
  assert.match(await active(), /Carla Dias/);
  assert.deepEqual(problems, []);
  console.log('ok   [chromium 95] offline package: list, Reply field, dictated reply, bubble menu reaction, Back');
} catch (error) {
  console.log(`FAIL [chromium 95] ${error.message}\n${problems.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  mock.close();
  app.close();
}
