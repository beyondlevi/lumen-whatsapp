// Thumbnails of photos (and videos) in the conversation. Most come with the
// message: WhatsApp sends a small JPEG (jpegThumbnail) that findMessages
// returns, so no download is needed. For one without it (an old message, a
// client that did not send one), the photo is downloaded once and drawn small
// here, one at a time, only for bubbles on screen; a few are kept, and the
// oldest are released.
import type {ChatMessage} from '../evolution/parse';
import {reduceImage, THUMBNAIL_SIDE} from '../photo/capturedPhoto';

/** Thumbnails made here and kept (the bubbles of a conversation's window, and some more). */
export const KEPT_THUMBNAILS = 24;

export type ThumbnailLoader = {
  /** A thumbnail made here, or null (not made yet, or it failed). */
  get(messageId: string): string | null;
  /** Makes the thumbnail of a photo without one, once. */
  request(message: ChatMessage): void;
  dispose(): void;
};

/** The image to show for a photo's thumbnail: the one in the message, as a data URL, if it has one. */
export function messageThumbnail(message: ChatMessage): string | null {
  return message.content.thumbnail ? `data:image/jpeg;base64,${message.content.thumbnail}` : null;
}

export function createThumbnailLoader(download: (message: ChatMessage) => Promise<Blob>, onChange: () => void): ThumbnailLoader {
  // Insertion order is the recency order: the first one is the next to go.
  const made = new Map<string, string>();
  const tried = new Set<string>();
  const queue: ChatMessage[] = [];
  let busy = false;
  let disposed = false;

  const keep = (id: string, url: string) => {
    made.set(id, url);
    while (made.size > KEPT_THUMBNAILS) {
      const [oldest, oldUrl] = made.entries().next().value as [string, string];
      made.delete(oldest);
      URL.revokeObjectURL(oldUrl);
      // Its bubble may come back later: it is made again then.
      tried.delete(oldest);
    }
  };

  const pump = async () => {
    if (busy || disposed) {
      return;
    }
    const message = queue.shift();
    if (message == null) {
      return;
    }
    busy = true;
    try {
      const thumbnail = await reduceImage(await download(message), THUMBNAIL_SIDE);
      if (!disposed) {
        keep(message.id, URL.createObjectURL(thumbnail.blob));
        onChange();
      }
    } catch {
      // No thumbnail: the bubble keeps its placeholder.
    } finally {
      busy = false;
      void pump();
    }
  };

  return {
    get(messageId) {
      const url = made.get(messageId);
      if (url != null) {
        // Seen again: the most recent now.
        made.delete(messageId);
        made.set(messageId, url);
      }
      return url ?? null;
    },
    request(message) {
      if (disposed || message.content.thumbnail || tried.has(message.id) || made.has(message.id)) {
        return;
      }
      tried.add(message.id);
      queue.push(message);
      void pump();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const url of made.values()) {
        URL.revokeObjectURL(url);
      }
      made.clear();
    },
  };
}
