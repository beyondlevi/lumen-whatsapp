import {describe, expect, it, vi} from 'vitest';
import {EvolutionClient, EvolutionError} from '../../src/evolution/client';

const config = {url: 'https://evo.example.test', instance: 'My Phone+1', apiKey: 'test-key'};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function clientReturning(response: Response | Error) {
  const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  return {client: new EvolutionClient(config, fetchMock), fetchMock};
}

async function captureError(promise: Promise<unknown>): Promise<EvolutionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EvolutionError);
    return error as EvolutionError;
  }
  throw new Error('expected a rejection');
}

describe('EvolutionClient requests', () => {
  it('URL-encodes the instance and sends the apikey header', async () => {
    const {client, fetchMock} = clientReturning(jsonResponse(200, []));
    await client.findChats(40);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.example.test/chat/findChats/My%20Phone%2B1');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).apikey).toBe('test-key');
    expect(JSON.parse(String(init.body))).toEqual({take: 40});
  });

  it('builds the v2 bodies', async () => {
    const calls: Array<[string, unknown]> = [];
    const client = new EvolutionClient(config, async (url, init) => {
      calls.push([url.replace(/^.*\.test\//, ''), JSON.parse(String(init.body))]);
      return jsonResponse(200, {});
    });
    await client.findContacts();
    await client.findMessages('5511999990001@s.whatsapp.net', 30);
    await client.sendText('5511999990001@s.whatsapp.net', 'Olá');
    await client.markMessagesAsRead([{id: 'A1', fromMe: false, remoteJid: '5511999990001@s.whatsapp.net'}]);
    expect(calls).toEqual([
      ['chat/findContacts/My%20Phone%2B1', {where: {}}],
      ['chat/findMessages/My%20Phone%2B1', {where: {key: {remoteJid: '5511999990001@s.whatsapp.net'}}, page: 1, offset: 30}],
      ['message/sendText/My%20Phone%2B1', {number: '5511999990001@s.whatsapp.net', text: 'Olá'}],
      ['chat/markMessageAsRead/My%20Phone%2B1', {readMessages: [{id: 'A1', fromMe: false, remoteJid: '5511999990001@s.whatsapp.net'}]}],
    ]);
  });
});

describe('EvolutionClient errors', () => {
  it('maps a failed fetch (offline, DNS, CORS) to network', async () => {
    const {client} = clientReturning(new TypeError('Failed to fetch'));
    const error = await captureError(client.findChats(40));
    expect(error.kind).toBe('network');
    expect(error.status).toBeNull();
  });

  it.each([
    [401, {status: 401, error: 'Unauthorized', response: {message: 'Unauthorized'}}, 'auth', 'Unauthorized'],
    [403, {status: 403, error: 'Forbidden', response: {message: ['Missing global api key']}}, 'auth', 'Missing global api key'],
    [404, {status: 404, error: 'Not Found', response: {message: ['The "x" instance does not exist']}}, 'instance', 'The "x" instance does not exist'],
    [400, {status: 400, error: 'Bad Request', response: {message: [{jid: '1@s.whatsapp.net', exists: false, number: '1'}]}}, 'rejected', '{"jid":"1@s.whatsapp.net","exists":false,"number":"1"}'],
    [503, {error: 'service not activated', code: 'LICENSE_REQUIRED'}, 'server', 'HTTP 503'],
  ])('maps HTTP %i to %s', async (status, body, kind, message) => {
    const {client} = clientReturning(jsonResponse(status, body));
    const error = await captureError(client.findChats(40));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it('rejects unreadable 200 bodies as server errors', async () => {
    const {client} = clientReturning(new Response('<html>', {status: 200}));
    const error = await captureError(client.findChats(40));
    expect(error.kind).toBe('server');
  });

  it('passes caller aborts through untouched', async () => {
    const controller = new AbortController();
    const client = new EvolutionClient(config, (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const abort = new Error('aborted');
          abort.name = 'AbortError';
          reject(abort);
        });
      }),
    );
    const pending = client.findChats(40, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  });
});
