// Profile pictures, loaded on demand: the URL from findChats when the server
// has one, otherwise one fetchProfilePictureUrl call per chat. A picture is
// shown only after it has loaded, so a missing or broken one keeps the
// initials. With a storage key, known URLs (and "no picture") are kept for the
// next launch; demo mode passes none.
import type {EvolutionApi} from '../evolution/client';

export type AvatarLoader = {
  /** Loaded picture URL, or null while loading / when there is none. */
  get(jid: string): string | null;
  /** Starts loading once per chat; `knownUrl` skips the server lookup. */
  request(jid: string, knownUrl?: string): void;
  dispose(): void;
};

const AVATAR_CACHE_KEY = 'lumen-whatsapp.avatars.v1';
const URL_TTL_MS = 24 * 3600 * 1000;
const NONE_TTL_MS = 6 * 3600 * 1000;
const MAX_LOOKUPS = 2;
const MAX_STORED = 100;

type Stored = {account: string; entries: Record<string, {url: string | null; at: number}>};

function readStored(account: string): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) ?? 'null') as Stored | null;
    if (stored && stored.account === account && stored.entries && typeof stored.entries === 'object') {
      return stored;
    }
  } catch {
    // Unreadable cache: start over.
  }
  return {account, entries: {}};
}

function writeStored(stored: Stored): void {
  const entries = Object.entries(stored.entries)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_STORED);
  try {
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({account: stored.account, entries: Object.fromEntries(entries)}));
  } catch {
    // Storage full or blocked: pictures are looked up again next time.
  }
}

function preload(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.decoding = 'async';
    image.src = url;
  });
}

export function createAvatarLoader(
  api: EvolutionApi,
  onChange: () => void,
  storage: {account: string} | null,
): AvatarLoader {
  const loaded = new Map<string, string | null>();
  const started = new Set<string>();
  const queue: string[] = [];
  const controller = new AbortController();
  let lookups = 0;
  const stored = storage ? readStored(storage.account) : null;

  const remember = (jid: string, url: string | null) => {
    if (stored) {
      stored.entries[jid] = {url, at: Date.now()};
      writeStored(stored);
    }
  };

  const show = async (jid: string, url: string | null) => {
    const ok = url != null && (await preload(url));
    if (controller.signal.aborted) {
      return;
    }
    loaded.set(jid, ok ? url : null);
    if (ok) {
      onChange();
    }
  };

  const pump = () => {
    while (lookups < MAX_LOOKUPS && queue.length > 0) {
      const jid = queue.shift() as string;
      lookups += 1;
      api
        .fetchProfilePictureUrl(jid, controller.signal)
        .then(
          url => {
            remember(jid, url);
            return show(jid, url);
          },
          () => {
            // Lookup failed (offline, server error): try again on the next launch.
            started.delete(jid);
          },
        )
        .finally(() => {
          lookups -= 1;
          if (!controller.signal.aborted) {
            pump();
          }
        });
    }
  };

  return {
    get: jid => loaded.get(jid) ?? null,
    request(jid, knownUrl) {
      if (started.has(jid) || controller.signal.aborted) {
        return;
      }
      started.add(jid);
      if (knownUrl) {
        void show(jid, knownUrl);
        return;
      }
      const cached = stored?.entries[jid];
      if (cached && Date.now() - cached.at < (cached.url ? URL_TTL_MS : NONE_TTL_MS)) {
        void show(jid, cached.url);
        return;
      }
      queue.push(jid);
      pump();
    },
    dispose() {
      controller.abort();
      queue.length = 0;
    },
  };
}
