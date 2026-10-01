// Photo and voice-message media, downloaded only when opened or played and
// kept in memory for the session (a few items; never stored).
import {EvolutionError, type EvolutionApi, type MediaPayload} from '../evolution/client';
import type {ChatMessage} from '../evolution/parse';

export type LoadedMedia = {src: string; mimetype: string};

export type MediaLoader = {
  load(message: ChatMessage): Promise<LoadedMedia>;
  dispose(): void;
};

const MAX_ITEMS = 6;

/**
 * Turns the payload into an object URL typed with the message's mimetype, so
 * playback does not depend on how the host labels files (demo media is read
 * from the package itself).
 */
async function toObjectUrl(payload: MediaPayload): Promise<string> {
  const type = payload.mimetype.split(';')[0];
  if (payload.url) {
    const response = await fetch(payload.url);
    if (!response.ok) {
      throw new EvolutionError('server', response.status, `HTTP ${response.status}`);
    }
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], {type}));
  }
  const binary = atob(payload.base64 ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], {type}));
}

/** True when this browser's <audio> can decode the type (e.g. OGG/Opus voice notes). */
export function canPlayAudio(mimetype: string): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  return document.createElement('audio').canPlayType(mimetype) !== '';
}

export function createMediaLoader(api: EvolutionApi): MediaLoader {
  const items = new Map<string, Promise<LoadedMedia>>();
  const objectUrls = new Map<string, string>();

  const fetchMedia = async (message: ChatMessage): Promise<LoadedMedia> => {
    const key = {id: message.id, fromMe: message.fromMe, remoteJid: message.remoteJid};
    let payload = await api.getMediaMessage(key);
    // Voice notes are OGG/Opus; if this engine cannot play that, ask the server for MP4.
    if (message.content.kind === 'audio' && !canPlayAudio(payload.mimetype)) {
      payload = await api.getMediaMessage(key, {convertToMp4: true});
      if (!canPlayAudio(payload.mimetype)) {
        throw new EvolutionError('rejected', null, `Cannot play ${payload.mimetype}`);
      }
    }
    const src = await toObjectUrl(payload);
    objectUrls.set(message.id, src);
    return {src, mimetype: payload.mimetype};
  };

  return {
    load(message) {
      const existing = items.get(message.id);
      if (existing) {
        // Most recently used goes last.
        items.delete(message.id);
        items.set(message.id, existing);
        return existing;
      }
      const pending = fetchMedia(message);
      items.set(message.id, pending);
      pending.catch(() => items.delete(message.id));
      while (items.size > MAX_ITEMS) {
        const oldest = items.keys().next().value as string;
        items.delete(oldest);
        const url = objectUrls.get(oldest);
        if (url) {
          URL.revokeObjectURL(url);
          objectUrls.delete(oldest);
        }
      }
      return pending;
    },
    dispose() {
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      items.clear();
    },
  };
}
