import {Toast} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ConfigField} from '../config/lumenConfig';
import {createDemoClient} from '../demo/demoClient';
import {EvolutionClient, EvolutionError, isAbortError, type EvolutionApi} from '../evolution/client';
import {
  accountKey,
  parseChats,
  parseContactList,
  parseContacts,
  parseMessage,
  parseMessages,
  phoneFromJid,
  type Chat,
  type ChatMessage,
  type Contact,
  type ContactNames,
} from '../evolution/parse';
import {chatDisplayName, chatPreview, describeContent} from '../format';
import {uniqueTargets, type SearchTarget} from '../search/searchTargets';
import {setLocaleOverride, t} from '../i18n/strings';
import {cacheAccount, loadChatCache, saveChatCache} from './chatCache';
import {loadReadMarks, saveReadMarks, type ReadMarks} from './readMarks';
import {createDemoAudio} from '../audio/demoAudio';
import {hostAudio, type LumenAudio, type LumenAudioResult} from '../audio/lumenAudio';
import {createAvatarLoader} from './avatars';
import {createMediaLoader, type LoadedMedia} from './media';
import {useLumenConfig} from './useLumenConfig';

/** Most recent chats requested from findChats. */
export const CHAT_LIMIT = 40;
/** Messages requested per conversation. */
export const MESSAGE_LIMIT = 30;
export const LIST_POLL_MS = 5000;
export const THREAD_POLL_MS = 3000;
/** While a thread is open, the chat list refreshes every Nth thread poll (~15 s). */
const LIST_POLL_EVERY_N_THREAD_POLLS = 5;
/** The phone's internet can take 5–15 s to come up after launch. */
export const CONNECT_RETRY_MS = 3000;
export const CONNECT_WINDOW_MS = 30000;
const MARK_READ_BATCH = 30;

export type Phase =
  | {kind: 'setup'; missing: ConfigField[]}
  | {kind: 'invalid-config'}
  | {kind: 'connecting'}
  | {kind: 'error'; error: EvolutionError}
  | {kind: 'ready'};

/** `loaded`: messages to show (maybe from the cache); `synced`: refreshed from the server this session. */
export type Thread = {loaded: boolean; synced: boolean; messages: ChatMessage[]};

export type WhatsAppState = {
  phase: Phase;
  instance: string | null;
  chats: Chat[];
  offline: boolean;
  /** Cached data is on screen while the first refresh runs. */
  syncing: boolean;
  isUnread(chat: Chat): boolean;
  thread(jid: string): Thread;
  chatFor(jid: string): Chat | undefined;
  retry(): void;
  /** Reads the platform configuration again (Setup screen). */
  reloadConfig(): void;
  /** Registers the conversation on screen; it is polled and marked as read. */
  openThread(jid: string): () => void;
  /** Sends a text, optionally as a reply to `quoted`. */
  sendText(jid: string, text: string, quoted?: ChatMessage | null): Promise<void>;
  /** Reacts to a message with an emoji. */
  sendReaction(message: ChatMessage, emoji: string): Promise<void>;
  /** Loaded profile picture of a chat, or null (initials are shown). */
  avatarFor(jid: string): string | null;
  /** Starts loading a chat's profile picture once; `knownUrl` comes from findChats. */
  requestAvatar(jid: string, knownUrl?: string): void;
  /** Downloads a photo or voice message on demand (kept in memory for the session). */
  loadMedia(message: ChatMessage): Promise<LoadedMedia>;
  /** Microphone and transcription: the host's, the simulated one in demo mode, or null (not available). */
  audio: LumenAudio | null;
  /** Sends a recorded voice note (`levels` is accepted for the shared recorder; WhatsApp draws its own waveform). */
  sendVoice(jid: string, recording: LumenAudioResult, levels?: readonly number[]): Promise<void>;
  /** Transcription of a message made this session, if any. */
  transcriptFor(messageId: string): string | null;
  saveTranscript(messageId: string, text: string): void;
  /** Chat order last shown by the list; kept across the list route's unmounts. */
  listOrder: {current: string[] | null};
  /** Demo mode: fictional chats, no server. */
  demo: boolean;
  /** The list's chats (recent first) and the saved contacts, for voice search; contacts load once. */
  searchTargets(): Promise<SearchTarget[]>;
  /** Saved name of a contact, for a conversation that is not in the list yet. */
  contactName(jid: string): string | null;
};

const EMPTY_THREAD: Thread = {loaded: false, synced: false, messages: []};

/** Base64 of a blob, without the data: prefix (what Evolution's media endpoints take). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function toError(error: unknown): EvolutionError {
  return error instanceof EvolutionError
    ? error
    : new EvolutionError('server', null, error instanceof Error ? error.message : String(error));
}

/** Keeps locally sent messages until the server returns them. */
function mergeThread(server: ChatMessage[], previous: ChatMessage[]): ChatMessage[] {
  const known = new Set(server.map(message => message.id));
  const pending = previous.filter(message => message.pending && !known.has(message.id));
  return pending.length === 0
    ? server
    : [...server, ...pending].sort((a, b) => a.timestamp - b.timestamp);
}

export function useWhatsAppState(): WhatsAppState {
  const [config, reloadConfig] = useLumenConfig();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({kind: 'connecting'});
  const [chats, setChats] = useState<Chat[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [readMarks, setReadMarks] = useState<ReadMarks>(loadReadMarks);

  const contactsRef = useRef<ContactNames>(new Map());
  const contactsRequestedRef = useRef(false);
  const activeJidRef = useRef<string | null>(null);
  const markedReadRef = useRef(new Set<string>());
  const offlineRef = useRef(false);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const listOrderRef = useRef<string[] | null>(null);
  const threadsRef = useRef<Record<string, Thread>>({});
  threadsRef.current = threads;

  // Demo mode: fictional chats from src/demo, no server, nothing read from or
  // written to storage, English copy.
  const demo = config.status === 'demo';
  const demoRef = useRef(false);
  const client = useMemo<EvolutionApi | null>(
    () =>
      config.status === 'ready'
        ? new EvolutionClient(config.config)
        : config.status === 'demo'
          ? createDemoClient()
          : null,
    [config],
  );

  // Saved contacts for voice search, fetched on the first search of a session.
  const contactListRef = useRef<{client: EvolutionApi; list: Promise<Contact[]>} | null>(null);
  const [contactNames, setContactNames] = useState<ReadonlyMap<string, string>>(new Map());

  const [avatarVersion, setAvatarVersion] = useState(0);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const audio = useMemo(() => (config.status === 'demo' ? createDemoAudio() : hostAudio()), [config.status]);
  const cacheAccountKey = config.status === 'ready' ? cacheAccount(config.config) : null;
  const avatars = useMemo(
    () =>
      client == null
        ? null
        : createAvatarLoader(
            client,
            () => setAvatarVersion(version => version + 1),
            cacheAccountKey == null ? null : {account: cacheAccountKey},
          ),
    [cacheAccountKey, client],
  );
  useEffect(() => () => avatars?.dispose(), [avatars]);
  const media = useMemo(() => (client == null ? null : createMediaLoader(client)), [client]);
  useEffect(() => () => media?.dispose(), [media]);

  const setOfflineState = useCallback((value: boolean) => {
    if (offlineRef.current === value) {
      return;
    }
    offlineRef.current = value;
    setOffline(value);
    if (value) {
      Toast.show(t('connectionLost'));
    }
  }, []);

  const loadContacts = useCallback(async (evolution: EvolutionApi, signal: AbortSignal) => {
    if (contactsRequestedRef.current) {
      return;
    }
    contactsRequestedRef.current = true;
    try {
      const contacts = parseContacts(await evolution.findContacts(signal));
      contactsRef.current = contacts;
      setChats(previous =>
        previous.map(chat =>
          chat.name == null && contacts.has(chat.jid)
            ? {...chat, name: contacts.get(chat.jid) ?? null}
            : chat,
        ),
      );
    } catch {
      // Names are optional: try again on a later refresh.
      contactsRequestedRef.current = false;
    }
  }, []);

  const refreshChats = useCallback(
    async (evolution: EvolutionApi, signal: AbortSignal) => {
      const parsed = parseChats(await evolution.findChats(CHAT_LIMIT, signal), contactsRef.current);
      if (signal.aborted) {
        return;
      }
      // findChats picks an arbitrary message among those sharing the latest
      // second; prefer the newest one already loaded in the conversation.
      const next = parsed.map(chat => {
        const loaded = threadsRef.current[chat.jid]?.messages;
        const newest = loaded?.[loaded.length - 1];
        return newest && newest.timestamp >= (chat.timestamp ?? 0) && newest.id !== chat.lastMessage?.id
          ? {...chat, lastMessage: newest, timestamp: newest.timestamp}
          : chat;
      });
      setChats(next);
      if (next.some(chat => chat.name == null)) {
        void loadContacts(evolution, signal);
      }
    },
    [loadContacts],
  );

  const markRead = useCallback((evolution: EvolutionApi, jid: string, messages: ChatMessage[]) => {
    const incoming = messages.filter(message => !message.fromMe);
    const latestIncoming = incoming.length ? incoming[incoming.length - 1].timestamp : 0;
    const chatTime = chatsRef.current.find(chat => chat.jid === jid)?.timestamp ?? 0;
    const mark = Math.max(latestIncoming, chatTime);
    if (mark > 0) {
      setReadMarks(previous => {
        if ((previous[jid] ?? 0) >= mark) {
          return previous;
        }
        const next = {...previous, [jid]: mark};
        if (!demoRef.current) {
          saveReadMarks(next);
        }
        return next;
      });
    }
    const unmarked = incoming
      .filter(message => !markedReadRef.current.has(message.id))
      .slice(-MARK_READ_BATCH);
    if (unmarked.length === 0) {
      return;
    }
    unmarked.forEach(message => markedReadRef.current.add(message.id));
    evolution
      .markMessagesAsRead(
        unmarked.map(message => ({id: message.id, fromMe: false, remoteJid: message.remoteJid})),
      )
      .catch(() => {
        unmarked.forEach(message => markedReadRef.current.delete(message.id));
      });
  }, []);

  const refreshThread = useCallback(
    async (evolution: EvolutionApi, jid: string, signal: AbortSignal) => {
      const messages = parseMessages(
        await evolution.findMessages(jid, MESSAGE_LIMIT, signal),
        contactsRef.current,
      );
      if (signal.aborted) {
        return;
      }
      setThreads(previous => ({
        ...previous,
        [jid]: {
          loaded: true,
          synced: true,
          messages: mergeThread(messages, previous[jid]?.messages ?? []),
        },
      }));
      // Keep the list preview current without waiting for the next findChats.
      const newest = messages[messages.length - 1];
      if (newest) {
        setChats(previous => {
          const chat = previous.find(candidate => candidate.jid === jid);
          if (!chat || chat.lastMessage?.id === newest.id || (chat.timestamp ?? 0) > newest.timestamp) {
            return previous;
          }
          const updated = {...chat, lastMessage: newest, timestamp: newest.timestamp};
          return [updated, ...previous.filter(candidate => candidate.jid !== jid)];
        });
      }
      if (activeJidRef.current === jid) {
        markRead(evolution, jid, messages);
      }
    },
    [markRead],
  );

  // Initial load. Network failures retry every 3 s for up to 30 s while the
  // header shows the loading spinner, because the phone's internet may still be coming up.
  useEffect(() => {
    if (config.status === 'loading') {
      return;
    }
    // Entering demo mode drops the stored read marks from view; leaving it reads them again.
    if (demo !== demoRef.current) {
      demoRef.current = demo;
      setLocaleOverride(demo ? 'en' : null);
      setReadMarks(demo ? {} : loadReadMarks());
    }
    if (config.status === 'missing') {
      setPhase({kind: 'setup', missing: config.missing});
      return;
    }
    if (config.status === 'invalid' || client == null) {
      setPhase({kind: 'invalid-config'});
      return;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    contactsRef.current = new Map();
    contactsRequestedRef.current = false;
    markedReadRef.current = new Set();
    offlineRef.current = false;
    setOffline(false);
    // Show the last known chats right away; the header spins until the refresh lands.
    const cached = config.status === 'ready' ? loadChatCache(cacheAccount(config.config)) : null;
    setChats(cached?.chats ?? []);
    setThreads(
      Object.fromEntries(
        Object.entries(cached?.threads ?? {}).map(([jid, messages]) => [
          jid,
          {loaded: true, synced: false, messages},
        ]),
      ),
    );
    setSyncing(true);
    setPhase(cached ? {kind: 'ready'} : {kind: 'connecting'});

    const attempt = async () => {
      try {
        await refreshChats(client, controller.signal);
        if (!controller.signal.aborted) {
          setSyncing(false);
          setPhase({kind: 'ready'});
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        const failure = toError(error);
        if (failure.kind === 'network' && Date.now() - startedAt < CONNECT_WINDOW_MS) {
          timer = setTimeout(attempt, CONNECT_RETRY_MS);
          return;
        }
        setSyncing(false);
        if (cached && failure.kind !== 'auth' && failure.kind !== 'instance') {
          // Keep the cached chats on screen; polling keeps retrying.
          setOfflineState(true);
          return;
        }
        setPhase({kind: 'error', error: failure});
      }
    };
    void attempt();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, config, connectAttempt, demo, refreshChats, setOfflineState]);

  // Polling while ready: the open thread every 3 s, the chat list every 5 s
  // (every ~15 s while a thread is open). Paused while the page is hidden.
  const ready = phase.kind === 'ready' && !syncing;
  useEffect(() => {
    if (!ready || client == null) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let threadPolls = 0;
    let running = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!controller.signal.aborted && !document.hidden) {
        timer = setTimeout(run, activeJidRef.current ? THREAD_POLL_MS : LIST_POLL_MS);
      }
    };

    const run = async () => {
      if (running) {
        return;
      }
      running = true;
      const jid = activeJidRef.current;
      try {
        if (jid) {
          await refreshThread(client, jid, controller.signal);
          threadPolls += 1;
        }
        if (!jid || threadPolls % LIST_POLL_EVERY_N_THREAD_POLLS === 0) {
          await refreshChats(client, controller.signal);
        }
        setOfflineState(false);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        const failure = toError(error);
        if (failure.kind === 'auth' || failure.kind === 'instance') {
          setPhase({kind: 'error', error: failure});
          return;
        }
        setOfflineState(true);
      } finally {
        running = false;
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client, ready, refreshChats, refreshThread, setOfflineState]);

  // Load a thread as soon as it opens instead of waiting for the next poll.
  useEffect(() => {
    if (!ready || client == null || activeJid == null) {
      return;
    }
    const controller = new AbortController();
    refreshThread(client, activeJid, controller.signal).catch(error => {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      const failure = toError(error);
      if (failure.kind === 'auth' || failure.kind === 'instance') {
        setPhase({kind: 'error', error: failure});
      } else {
        setOfflineState(true);
      }
    });
    return () => controller.abort();
  }, [activeJid, client, ready, refreshThread, setOfflineState]);

  const openThread = useCallback((jid: string) => {
    activeJidRef.current = jid;
    setActiveJid(jid);
    return () => {
      if (activeJidRef.current === jid) {
        activeJidRef.current = null;
        setActiveJid(null);
      }
    };
  }, []);

  const sendText = useCallback(
    async (jid: string, text: string, quoted?: ChatMessage | null) => {
      if (client == null) {
        throw new EvolutionError('network', null, 'Not connected');
      }
      const response = await client.sendText(
        jid,
        text,
        quoted
          ? {
              key: {id: quoted.id, fromMe: quoted.fromMe, remoteJid: quoted.remoteJid},
              text: describeContent(quoted.content),
            }
          : undefined,
      );
      const sent: ChatMessage = parseMessage(response) ?? {
        id: `local-${Date.now()}`,
        remoteJid: jid,
        fromMe: true,
        senderName: null,
        timestamp: Date.now(),
        content: {kind: 'text', text},
      };
      const message: ChatMessage = {...sent, remoteJid: jid, pending: true};
      setThreads(previous => {
        const current = previous[jid] ?? {loaded: true, synced: true, messages: []};
        return {...previous, [jid]: {...current, messages: mergeThread(current.messages, [message])}};
      });
      setChats(previous => {
        const existing = previous.find(chat => chat.jid === jid);
        if (!existing) {
          return previous;
        }
        const updated = {...existing, lastMessage: message, timestamp: message.timestamp};
        return [updated, ...previous.filter(chat => chat.jid !== jid)];
      });
    },
    [client],
  );

  const sendReaction = useCallback(
    async (message: ChatMessage, emoji: string) => {
      if (client == null) {
        throw new EvolutionError('network', null, 'Not connected');
      }
      const key = {
        id: message.id,
        fromMe: message.fromMe,
        remoteJid: message.remoteJid,
        ...(message.participant ? {participant: message.participant} : {}),
      };
      const response = await client.sendReaction(key, emoji);
      // Show the badge now; the server's reaction record replaces it on the next poll.
      const parsed = parseMessage(response);
      const reaction: ChatMessage = {
        id: parsed?.content.kind === 'reaction' ? parsed.id : `local-reaction-${Date.now()}`,
        remoteJid: message.remoteJid,
        fromMe: true,
        senderName: null,
        timestamp: parsed?.timestamp ?? Date.now(),
        content: {kind: 'reaction', text: emoji, targetId: message.id},
        pending: true,
      };
      const jid = message.remoteJid;
      setThreads(previous => {
        const current = previous[jid] ?? {loaded: true, synced: true, messages: []};
        return {...previous, [jid]: {...current, messages: mergeThread(current.messages, [reaction])}};
      });
    },
    [client],
  );

  const sendVoice = useCallback(
    async (jid: string, recording: LumenAudioResult) => {
      if (client == null) {
        throw new EvolutionError('network', null, 'Not connected');
      }
      const seconds = Math.max(1, Math.round(recording.durationMs / 1000));
      const response = await client.sendVoice(jid, await blobToBase64(recording.blob), seconds);
      const parsed = parseMessage(response);
      const sent: ChatMessage = {
        id: parsed?.id ?? `local-voice-${Date.now()}`,
        remoteJid: jid,
        fromMe: true,
        senderName: null,
        timestamp: parsed?.timestamp ?? Date.now(),
        content: {kind: 'audio', text: '', seconds: parsed?.content.seconds ?? seconds},
        pending: true,
      };
      media?.prime(sent.id, recording.blob, recording.mimeType);
      setThreads(previous => {
        const current = previous[jid] ?? {loaded: true, synced: true, messages: []};
        return {...previous, [jid]: {...current, messages: mergeThread(current.messages, [sent])}};
      });
      setChats(previous => {
        const existing = previous.find(chat => chat.jid === jid);
        if (!existing) {
          return previous;
        }
        const updated = {...existing, lastMessage: sent, timestamp: sent.timestamp};
        return [updated, ...previous.filter(chat => chat.jid !== jid)];
      });
    },
    [client, media],
  );

  const saveTranscript = useCallback(
    (messageId: string, text: string) => setTranscripts(previous => ({...previous, [messageId]: text})),
    [],
  );

  const loadMedia = useCallback(
    (message: ChatMessage) =>
      media == null ? Promise.reject(new EvolutionError('network', null, 'Not connected')) : media.load(message),
    [media],
  );

  // Persist the list and recent messages for an instant start next time.
  useEffect(() => {
    if (cacheAccountKey == null || phase.kind !== 'ready' || syncing || chats.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const messages: Record<string, ChatMessage[]> = {};
      for (const [jid, thread] of Object.entries(threads)) {
        if (thread.loaded) {
          messages[jid] = thread.messages;
        }
      }
      saveChatCache(cacheAccountKey, chats, messages);
    }, 300);
    return () => clearTimeout(timer);
  }, [cacheAccountKey, chats, phase.kind, syncing, threads]);

  const searchTargets = useCallback(async (): Promise<SearchTarget[]> => {
    if (client == null) {
      return [];
    }
    if (contactListRef.current?.client !== client) {
      const list = client.findContacts().then(parseContactList);
      contactListRef.current = {client, list};
      list.then(
        contacts => setContactNames(new Map(contacts.map(contact => [contact.jid, contact.name]))),
        () => {
          // Try again on the next search.
          if (contactListRef.current?.list === list) {
            contactListRef.current = null;
          }
        },
      );
    }
    const chatTargets: SearchTarget[] = chatsRef.current.map(chat => ({
      id: chat.jid,
      name: chatDisplayName(chat.jid, chat.name),
      phone: phoneFromJid(chat.jid),
      isGroup: chat.isGroup,
      detail: chatPreview(chat, threadsRef.current[chat.jid]?.messages ?? []),
      inChats: true,
    }));
    let contacts: Contact[] = [];
    try {
      contacts = await contactListRef.current.list;
    } catch {
      // Without contacts, the chats alone are searched.
    }
    return uniqueTargets(
      chatTargets,
      contacts.map(contact => ({id: contact.jid, name: contact.name, phone: phoneFromJid(contact.jid), isGroup: contact.isGroup, detail: null, inChats: false})),
      accountKey,
    );
  }, [client]);

  const isUnread = useCallback(
    (chat: Chat) =>
      chat.unreadCount > 0 &&
      chat.jid !== activeJid &&
      (chat.timestamp ?? 0) > (readMarks[chat.jid] ?? 0),
    [activeJid, readMarks],
  );

  return useMemo<WhatsAppState>(
    () => ({
      phase,
      instance: config.status === 'ready' ? config.config.instance : null,
      chats,
      offline,
      syncing,
      isUnread,
      thread: jid => threads[jid] ?? EMPTY_THREAD,
      chatFor: jid => chats.find(chat => chat.jid === jid),
      retry: () => setConnectAttempt(count => count + 1),
      reloadConfig: () => {
        void reloadConfig().then(next => {
          if (next.status === 'missing') {
            Toast.show(t('setupStillMissing'));
          }
        });
      },
      openThread,
      sendText,
      sendReaction,
      avatarFor: jid => avatars?.get(jid) ?? null,
      requestAvatar: (jid, knownUrl) => avatars?.request(jid, knownUrl),
      loadMedia,
      audio,
      sendVoice,
      transcriptFor: messageId => transcripts[messageId] ?? null,
      saveTranscript,
      listOrder: listOrderRef,
      demo,
      searchTargets,
      contactName: jid => contactNames.get(jid) ?? contactsRef.current.get(jid) ?? null,
    }),
    // avatarVersion: a picture finished loading.
    [audio, avatarVersion, avatars, chats, config, contactNames, demo, isUnread, loadMedia, offline, openThread, phase, reloadConfig, saveTranscript, searchTargets, sendReaction, sendText, sendVoice, syncing, threads, transcripts],
  );
}
