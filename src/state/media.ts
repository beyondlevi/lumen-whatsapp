// Photo and voice-message media, downloaded only when opened or played and
// kept in memory for the session (a few items; never stored). A photo opened
// in full is decoded smaller (VIEW_SIDE) and released by the screen showing it.
import {EvolutionError, type EvolutionApi, type MediaPayload} from '../evolution/client';
import type {ChatMessage} from '../evolution/parse';
import {reduceImage, VIEW_SIDE} from '../photo/capturedPhoto';

export type LoadedMedia = {src: string; mimetype: string};

/** A photo decoded for the screen; `release()` frees it. */
export type LoadedPhoto = {src: string; width: number; height: number; release(): void};

export type MediaLoader = {
  load(message: ChatMessage): Promise<LoadedMedia>;
  /** A photo in full, at most VIEW_SIDE on its longest side; never kept here. */
  loadPhoto(message: ChatMessage): Promise<LoadedPhoto>;
  /** A photo's bytes, as downloaded (for a thumbnail made here). */
  photoBlob(message: ChatMessage): Promise<Blob>;
  /** Keeps audio you just recorded, so playing your own voice note needs no download. */
  prime(messageId: string, blob: Blob, mimetype: string): void;
  dispose(): void;
};

const MAX_ITEMS = 6;

/**
 * Turns the payload into an object URL typed with the message's mimetype, so
 * playback does not depend on how the host labels files (demo media is read
 * from the package itself).
 */
async function toBlob(payload: MediaPayload): Promise<Blob> {
  const type = payload.mimetype.split(';')[0];
  if (payload.url) {
    const response = await fetch(payload.url);
    if (!response.ok) {
      throw new EvolutionError('server', response.status, `HTTP ${response.status}`);
    }
    return new Blob([await response.arrayBuffer()], {type});
  }
  const binary = atob(payload.base64 ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], {type});
}

async function toObjectUrl(payload: MediaPayload): Promise<string> {
  return URL.createObjectURL(await toBlob(payload));
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

  // A photo you sent this session is kept as you took it (see prime); others are downloaded.
  const photoBlob = async (message: ChatMessage): Promise<Blob> => {
    const primed = objectUrls.get(message.id);
    if (primed != null && items.has(message.id)) {
      return (await fetch(primed)).blob();
    }
    return toBlob(await api.getMediaMessage({id: message.id, fromMe: message.fromMe, remoteJid: message.remoteJid}));
  };

  return {
    photoBlob,
    async loadPhoto(message) {
      const photo = await reduceImage(await photoBlob(message), VIEW_SIDE);
      const src = URL.createObjectURL(photo.blob);
      return {src, width: photo.width, height: photo.height, release: () => URL.revokeObjectURL(src)};
    },
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
    prime(messageId, blob, mimetype) {
      const src = URL.createObjectURL(blob);
      objectUrls.set(messageId, src);
      items.set(messageId, Promise.resolve({src, mimetype}));
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
