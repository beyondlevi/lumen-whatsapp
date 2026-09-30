import {describe, expect, it, vi} from 'vitest';
import {
  captureDevConfigFromUrl,
  DEV_STORAGE_KEY,
  getConfigSource,
  parseConfig,
  type HostWindow,
} from '../../src/config/lumenConfig';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

function fakeWindow(href: string, extra: Pick<HostWindow, 'lumen'> = {}) {
  const listeners = new Map<string, (event: StorageEvent) => void>();
  const win = {
    location: new URL(href),
    localStorage: memoryStorage(),
    history: {
      state: {idx: 0},
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        win.location = new URL(url, win.location.href);
      }),
    },
    addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    listeners,
    ...extra,
  };
  return win;
}

describe('parseConfig', () => {
  it('lists missing keys', () => {
    expect(parseConfig({})).toEqual({status: 'missing', missing: ['url', 'instance', 'apiKey']});
    expect(parseConfig({'evolution.url': 'https://x', 'evolution.instance': ' '})).toEqual({
      status: 'missing',
      missing: ['instance', 'apiKey'],
    });
  });

  it('rejects non-http URLs', () => {
    const values = {'evolution.url': 'evo.example.com', 'evolution.instance': 'a', 'evolution.apiKey': 'k'};
    expect(parseConfig(values)).toEqual({status: 'invalid'});
    expect(parseConfig({...values, 'evolution.url': 'ftp://evo'})).toEqual({status: 'invalid'});
  });

  it('normalizes the base URL and trims values', () => {
    expect(
      parseConfig({
        'evolution.url': ' https://evo.example.com/api/ ',
        'evolution.instance': ' My Phone ',
        'evolution.apiKey': ' k ',
      }),
    ).toEqual({
      status: 'ready',
      config: {url: 'https://evo.example.com/api', instance: 'My Phone', apiKey: 'k'},
    });
  });
});

describe('development fallback', () => {
  const query =
    '?evolution.url=http%3A%2F%2F127.0.0.1%3A8089&evolution.instance=Lumen%20Test&evolution.apiKey=k1&keep=1';

  it('stores URL parameters and strips them from the address bar', async () => {
    const win = fakeWindow(`http://localhost:5173/chat/x${query}#h`);
    captureDevConfigFromUrl(true, win);
    expect(JSON.parse(win.localStorage.getItem(DEV_STORAGE_KEY) ?? '')).toEqual({
      'evolution.url': 'http://127.0.0.1:8089',
      'evolution.instance': 'Lumen Test',
      'evolution.apiKey': 'k1',
    });
    expect(win.history.replaceState).toHaveBeenCalledWith({idx: 0}, '', '/chat/x?keep=1#h');

    const source = getConfigSource(win);
    expect(source.kind).toBe('dev');
    await expect(source.get()).resolves.toMatchObject({'evolution.apiKey': 'k1'});
  });

  it('an empty parameter clears the stored key', () => {
    const win = fakeWindow(`http://localhost/${query}`);
    captureDevConfigFromUrl(true, win);
    win.location = new URL('http://localhost/?evolution.apiKey=');
    captureDevConfigFromUrl(true, win);
    expect(JSON.parse(win.localStorage.getItem(DEV_STORAGE_KEY) ?? '')).not.toHaveProperty('evolution.apiKey');
  });

  it('never stores parameters when the platform config exists, but still strips them', () => {
    const win = fakeWindow(`http://127.0.0.1:4000/${query}`);
    captureDevConfigFromUrl(false, win);
    expect(win.localStorage.getItem(DEV_STORAGE_KEY)).toBeNull();
    expect(win.history.replaceState).toHaveBeenCalledWith({idx: 0}, '', '/?keep=1');
  });
});

describe('window.lumen.config', () => {
  it('uses the platform API and its onChange callback', async () => {
    let changeCallback: ((values?: Record<string, string>) => void) | undefined;
    const unsubscribe = vi.fn();
    const lumen = {
      config: {
        get: vi.fn(async () => ({'evolution.url': 'https://evo'})),
        onChange: vi.fn((callback: (values?: Record<string, string>) => void) => {
          changeCallback = callback;
          return unsubscribe;
        }),
      },
    };
    const win = fakeWindow('http://127.0.0.1:4000/', {lumen});
    win.localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify({'evolution.apiKey': 'dev-only'}));

    const source = getConfigSource(win);
    expect(source.kind).toBe('lumen');
    await expect(source.get()).resolves.toEqual({'evolution.url': 'https://evo'});

    const seen: Array<Record<string, string> | undefined> = [];
    const stop = source.subscribe(values => seen.push(values));
    changeCallback?.({'evolution.url': 'https://new'});
    changeCallback?.();
    expect(seen).toEqual([{'evolution.url': 'https://new'}, undefined]);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('tolerates onChange without an unsubscribe function', () => {
    const lumen = {config: {get: async () => ({}), onChange: () => undefined}};
    const win = fakeWindow('http://127.0.0.1:4000/', {lumen});
    const stop = getConfigSource(win).subscribe(() => {});
    expect(() => stop()).not.toThrow();
  });
});
