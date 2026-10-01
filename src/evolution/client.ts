// Minimal Evolution API v2 REST client. Endpoints and payloads follow the
// v2.3.x source (src/api/routes/chat.router.ts, sendMessage.router.ts):
//   POST /chat/findChats/{instance}          {take}
//   POST /chat/findContacts/{instance}       {where: {}}
//   POST /chat/findMessages/{instance}       {where: {key: {remoteJid}}, page, offset}
//   POST /chat/markMessageAsRead/{instance}  {readMessages: [{id, fromMe, remoteJid}]}
//   POST /message/sendText/{instance}        {number, text, quoted?: {key, message}}
//   POST /message/sendReaction/{instance}    {key: {id, remoteJid, fromMe, participant?}, reaction}
// Every call sends the `apikey` header. The instance name is a path segment and
// is URL-encoded with encodeURIComponent (a space must be %20, never `+`).

import type {EvolutionConfig} from '../config/lumenConfig';

export type EvolutionErrorKind =
  /** fetch() failed: offline, DNS, TLS, timeout, or blocked by CORS. */
  | 'network'
  /** 401/403: API key refused. */
  | 'auth'
  /** 404: the instance (or the API path) does not exist on that server. */
  | 'instance'
  /** 400: the server rejected the request (e.g. number not on WhatsApp). */
  | 'rejected'
  /** Any other non-2xx or unreadable response. */
  | 'server';

export class EvolutionError extends Error {
  readonly kind: EvolutionErrorKind;
  readonly status: number | null;

  constructor(kind: EvolutionErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'EvolutionError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export type MessageKeyRef = {id: string; fromMe: boolean; remoteJid: string};

/** The calls the app makes; implemented by EvolutionClient and by the demo client. */
export type EvolutionApi = Pick<
  EvolutionClient,
  'findChats' | 'findContacts' | 'findMessages' | 'sendText' | 'sendReaction' | 'markMessagesAsRead'
>;

const REQUEST_TIMEOUT_MS = 15000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function responseMessage(body: unknown): string {
  if (body != null && typeof body === 'object') {
    const response = (body as {response?: {message?: unknown}}).response;
    const message = response?.message;
    if (Array.isArray(message)) {
      return message.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return '';
}

export class EvolutionClient {
  private readonly config: EvolutionConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: EvolutionConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  endpoint(path: string): string {
    return `${this.config.url}/${path}/${encodeURIComponent(this.config.instance)}`;
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    // AbortSignal.any/timeout are too new for Chromium 95, so merge by hand.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', onAbort);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint(path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.config.apiKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted && !timedOut) {
        throw error;
      }
      throw new EvolutionError(
        'network',
        null,
        timedOut ? 'Request timed out' : error instanceof Error ? error.message : 'Network error',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    let payload: unknown = null;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (response.ok) {
        throw new EvolutionError('server', response.status, 'Unreadable response');
      }
    }

    if (!response.ok) {
      const detail = responseMessage(payload);
      const status = response.status;
      const kind: EvolutionErrorKind =
        status === 401 || status === 403
          ? 'auth'
          : status === 404
            ? 'instance'
            : status === 400
              ? 'rejected'
              : 'server';
      throw new EvolutionError(kind, status, detail || `HTTP ${status}`);
    }
    return payload as T;
  }

  /** Most recent chats first. `take` limits the rows (LIMIT in the SQL query). */
  findChats(take: number, signal?: AbortSignal): Promise<unknown> {
    return this.post('chat/findChats', {take}, signal);
  }

  findContacts(signal?: AbortSignal): Promise<unknown> {
    return this.post('chat/findContacts', {where: {}}, signal);
  }

  /** Newest first; `offset` is the page size, `page` is 1-based. */
  findMessages(remoteJid: string, limit: number, signal?: AbortSignal): Promise<unknown> {
    return this.post(
      'chat/findMessages',
      {where: {key: {remoteJid}}, page: 1, offset: limit},
      signal,
    );
  }

  /** `quoted` makes the message a reply to an earlier one (key plus its text). */
  sendText(
    remoteJid: string,
    text: string,
    quoted?: {key: MessageKeyRef; text: string},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {number: remoteJid, text};
    if (quoted) {
      body.quoted = {key: quoted.key, message: {conversation: quoted.text}};
    }
    return this.post('message/sendText', body, signal);
  }

  /** Reacts to a message with an emoji (an empty string removes the reaction). */
  sendReaction(key: MessageKeyRef & {participant?: string}, reaction: string, signal?: AbortSignal): Promise<unknown> {
    return this.post('message/sendReaction', {key, reaction}, signal);
  }

  markMessagesAsRead(keys: MessageKeyRef[], signal?: AbortSignal): Promise<unknown> {
    return this.post('chat/markMessageAsRead', {readMessages: keys}, signal);
  }
}
