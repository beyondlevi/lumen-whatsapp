// Configuration contract with the Lumen platform.
//
// On the glasses the platform injects `window.lumen.config`, backed by the
// fields declared under `lumen_config` in manifest.webmanifest and filled in on
// the phone companion. Credentials are never bundled or typed in the app.
//
// In a regular browser (development only) `window.lumen` does not exist, so the
// values come from `?evolution.url=…&evolution.instance=…&evolution.apiKey=…`
// and are kept in localStorage. The parameters are removed from the address bar
// right after they are read.
//
// Demo mode: the optional `demo` field set to exactly `demo-captures` replaces
// the Evolution server with built-in fictional chats (src/demo). Any other
// value, or an empty field, is ignored.

export const CONFIG_KEYS = {
  url: 'evolution.url',
  instance: 'evolution.instance',
  apiKey: 'evolution.apiKey',
} as const;

/** Optional `lumen_config` field that turns on demo mode. */
export const DEMO_KEY = 'demo';
/** The only value of DEMO_KEY that turns on demo mode. */
export const DEMO_ACTIVATION = 'demo-captures';

/** Keys accepted from the URL by the development fallback. */
const URL_KEYS: readonly string[] = [...Object.values(CONFIG_KEYS), DEMO_KEY];

export type ConfigField = keyof typeof CONFIG_KEYS;
export const CONFIG_FIELDS: readonly ConfigField[] = ['url', 'instance', 'apiKey'];

export type ConfigValues = Record<string, string>;

export type EvolutionConfig = {
  /** Base URL without trailing slash, e.g. `https://evo.example.com`. */
  url: string;
  instance: string;
  apiKey: string;
};

export type ConfigState =
  | {status: 'loading'}
  | {status: 'missing'; missing: ConfigField[]}
  | {status: 'invalid'}
  | {status: 'ready'; config: EvolutionConfig}
  | {status: 'demo'};

type LumenConfigApi = {
  get(): Promise<ConfigValues>;
  onChange(callback: (values?: ConfigValues) => void): unknown;
};

declare global {
  /** What the Lumen host injects; other modules add their parts (e.g. `audio`). */
  interface LumenHost {
    config?: LumenConfigApi;
  }
  interface Window {
    lumen?: LumenHost;
  }
}

export type ConfigSource = {
  kind: 'lumen' | 'dev';
  get(): Promise<ConfigValues>;
  /** Calls back with the new values when known, or with nothing (caller re-reads). */
  subscribe(callback: (values?: ConfigValues) => void): () => void;
};

export const DEV_STORAGE_KEY = 'lumen-whatsapp.dev-config';

/** The parts of `window` this module uses (lets tests pass a plain object). */
export type HostWindow = {
  location: {href: string};
  localStorage: Storage;
  history: {state: unknown; replaceState(state: unknown, unused: string, url: string): void};
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  lumen?: {config?: LumenConfigApi};
};

function readDevConfig(storage: Storage): ConfigValues {
  try {
    const raw = storage.getItem(DEV_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed == null || typeof parsed !== 'object') {
      return {};
    }
    const values: ConfigValues = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        values[key] = value;
      }
    }
    return values;
  } catch {
    return {};
  }
}

/**
 * Development fallback: moves `evolution.*` (and `demo`) URL parameters into localStorage
 * and strips them from the address bar so the API key does not linger in the
 * URL or in history. An empty parameter value removes the stored key.
 * Always strips the parameters; only stores them when `store` is true.
 */
export function captureDevConfigFromUrl(
  store: boolean,
  win: HostWindow = window,
): void {
  const url = new URL(win.location.href);
  const keys = URL_KEYS.filter(key => url.searchParams.has(key));
  if (keys.length === 0) {
    return;
  }
  if (store) {
    const values = readDevConfig(win.localStorage);
    for (const key of keys) {
      const value = (url.searchParams.get(key) ?? '').trim();
      if (value) {
        values[key] = value;
      } else {
        delete values[key];
      }
    }
    try {
      win.localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(values));
    } catch {
      // Storage full or blocked: the values stay unavailable, which shows Setup.
    }
  }
  for (const key of keys) {
    url.searchParams.delete(key);
  }
  win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
}

export function getConfigSource(win: HostWindow = window): ConfigSource {
  const lumenConfig = win.lumen?.config;
  if (lumenConfig != null && typeof lumenConfig.get === 'function') {
    return {
      kind: 'lumen',
      get: () => lumenConfig.get(),
      subscribe(callback) {
        if (typeof lumenConfig.onChange !== 'function') {
          return () => {};
        }
        const unsubscribe = lumenConfig.onChange(values =>
          callback(values != null && typeof values === 'object' ? values : undefined),
        );
        return typeof unsubscribe === 'function' ? () => unsubscribe() : () => {};
      },
    };
  }

  return {
    kind: 'dev',
    get: () => Promise.resolve(readDevConfig(win.localStorage)),
    subscribe(callback) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === DEV_STORAGE_KEY) {
          callback();
        }
      };
      win.addEventListener('storage', onStorage);
      return () => win.removeEventListener('storage', onStorage);
    },
  };
}

export function isDemoActivation(values: ConfigValues | null | undefined): boolean {
  const value = values?.[DEMO_KEY];
  return typeof value === 'string' && value.trim() === DEMO_ACTIVATION;
}

export function parseConfig(values: ConfigValues | null | undefined): ConfigState {
  if (isDemoActivation(values)) {
    return {status: 'demo'};
  }
  const read = (field: ConfigField) => {
    const value = values?.[CONFIG_KEYS[field]];
    return typeof value === 'string' ? value.trim() : '';
  };
  const missing = CONFIG_FIELDS.filter(field => read(field) === '');
  if (missing.length > 0) {
    return {status: 'missing', missing};
  }

  let base: URL;
  try {
    base = new URL(read('url'));
  } catch {
    return {status: 'invalid'};
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return {status: 'invalid'};
  }
  const path = base.pathname.replace(/\/+$/, '');
  return {
    status: 'ready',
    config: {
      url: `${base.origin}${path}`,
      instance: read('instance'),
      apiKey: read('apiKey'),
    },
  };
}

export function sameConfig(a: ConfigState, b: ConfigState): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === 'ready' && b.status === 'ready') {
    return (
      a.config.url === b.config.url &&
      a.config.instance === b.config.instance &&
      a.config.apiKey === b.config.apiKey
    );
  }
  if (a.status === 'missing' && b.status === 'missing') {
    return a.missing.join() === b.missing.join();
  }
  return true;
}
