import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
import {
  ListItem,
  Page,
  StatusIndicatorType,
  TimestampPosition,
  TimestampTextColor,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {avatarFallback} from '../components/avatarFallback';
import {KeptPage} from '../components/KeptPage';
import {chatDisplayName, chatPreview, formatListTime} from '../format';
import {t} from '../i18n/strings';
import {useVoiceInput} from '../search/useVoiceInput';
import {ROWS_AHEAD, useListWindow} from '../state/useListWindow';
import {useReturnOrder} from '../state/useReturnOrder';
import {whenIdle} from '../state/whenIdle';
import {useWhatsApp} from '../WhatsAppProvider';
import {ChatListEmptyPage} from './ChatListEmptyPage';
import {DEMO_SEARCH_PHRASE, SEARCH_PATH} from './SearchPage';
import {StatusPage} from './StatusPage';

// From launch until the wearer first presses a key, the newest chat keeps the
// focus: the list shows the cached chats at once and the refresh that follows
// re-sorts them, which would otherwise carry the focus down with the chat that
// was first in the cache.
const launch = {untouched: true};
if (typeof document !== 'undefined') {
  const touched = () => {
    launch.untouched = false;
  };
  document.addEventListener('keydown', touched, {capture: true, once: true});
  document.addEventListener('pointerdown', touched, {capture: true, once: true});
}

/** Key of the voice search row, for the focus that comes back to the list. */
const VOICE_ROW = 'voice-search';

export function chatPath(jid: string): string {
  return `/chat/${encodeURIComponent(jid)}`;
}

// Each opening of a conversation (from the list or the search) is a new page
// for the page transition: it starts at the newest message, not where an
// earlier visit left it when that visit opened a photo or the recorder; Back
// from those pages still finds the conversation as it was.
const openings = new Map<string, number>();

/** Path of a conversation, opened afresh. */
export function openChatPath(jid: string): string {
  openings.set(jid, (openings.get(jid) ?? 0) + 1);
  return chatPath(jid);
}

/** The page transition's key: the path, and for a conversation, which opening it is. */
export function transitionKey({pathname}: {pathname: string}): string {
  const jid = /^\/chat\/[^/]+$/.test(pathname) ? chatOfPath(pathname) : null;
  return jid == null ? pathname : `${pathname}#${openings.get(jid) ?? 0}`;
}

/** The chat whose conversation (or one of its pages) is at `pathname`. */
function chatOfPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)/.exec(pathname);
  if (match == null) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The `/` route: the connection and empty screens. The chats themselves are
 * the ChatList, kept mounted above the routes.
 */
export function ChatListRoute() {
  const {phase, chats, offline} = useWhatsApp();
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  if (chats.length === 0) {
    return <ChatListEmptyPage offline={offline} />;
  }
  return null;
}

/** What a chat row shows; a row is drawn again only when one of these changes. */
type Row = {
  jid: string;
  name: string;
  savedName: string | null;
  isGroup: boolean;
  subtitle: string;
  timestamp: string | undefined;
  unread: boolean;
  picture: string | null;
};

/** Mounted when the list shows, or in idle time once it is ready after a launch on a conversation. */
function useKeptMount(ready: boolean, shown: boolean): boolean {
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (mounted || !ready) {
      return;
    }
    if (shown) {
      setMounted(true);
      return;
    }
    // After a launch on a conversation, once it is on screen and the wearer is not pressing keys.
    return whenIdle(() => setMounted(true), 3000);
  }, [mounted, ready, shown]);
  return mounted || shown;
}

/**
 * The chat list. It is mounted once and stays mounted, hidden and unchanged,
 * while a conversation, its pages or the search are open, so Back only shows
 * it again: the same rows and scroll, the focus on the chat the wearer came
 * from, and only the rows whose chat changed meanwhile drawn again.
 */
export function ChatList() {
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const {phase, chats, offline, syncing, isUnread, thread, avatarFor, requestAvatar, demo} = useWhatsApp();
  const voice = useVoiceInput(demo ? DEMO_SEARCH_PHRASE : null);
  const ready = phase.kind === 'ready' && chats.length > 0;
  const shown = ready && pathname === '/';
  const mounted = useKeptMount(ready, shown);
  const rows = useReturnOrder(chats, shown);

  // Where the focus goes back to: the chat whose conversation was open, else
  // the row focused last, else the newest chat.
  const wasShown = useRef<boolean | null>(null);
  const lastFocused = useRef<string | null>(null);
  const cameFrom = useRef<string | null>(null);
  cameFrom.current = chatOfPath(pathname) ?? cameFrom.current;
  const showing = shown && wasShown.current !== true;
  const returnTo = showing
    ? ([cameFrom.current, lastFocused.current].find(
        key => key != null && (key === VOICE_ROW || rows.some(chat => chat.jid === key)),
      ) ?? null)
    : null;
  const returnIndex = returnTo == null ? -1 : rows.findIndex(chat => chat.jid === returnTo);
  const listWindow = useListWindow(rows.length, returnIndex < 0 ? 0 : returnIndex + 1 + ROWS_AHEAD);
  const shownRows = rows.slice(0, listWindow.count);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const open = useCallback((jid: string) => navigateRef.current(openChatPath(jid)), []);
  const search = useCallback(() => navigateRef.current(SEARCH_PATH), []);
  const focusedIndex = listWindow.focused;
  const rowFocused = useCallback(
    (key: string, index: number) => {
      lastFocused.current = key;
      focusedIndex(index);
    },
    [focusedIndex],
  );

  // Profile pictures load once per chat, for the rows rendered while the list is shown.
  useEffect(() => {
    if (!shown) {
      return;
    }
    for (const chat of shownRows) {
      requestAvatar(chat.jid, chat.avatarUrl);
    }
  }, [requestAvatar, shown, shownRows]);

  // Hidden, the list keeps what it showed last: nothing renders or is drawn again.
  const view = useRef<ReactElement | null>(null);
  if (mounted && (shown || view.current == null)) {
    view.current = (
      <ChatListView
        headerText={syncing ? t('loadingHeader') : t('chatsHeader')}
        loading={syncing}
        metadata={offline && !syncing ? t('offlineMeta') : undefined}
        voiceSearch={voice.input != null}
        rows={shownRows.map(chat => ({
          jid: chat.jid,
          name: chatDisplayName(chat.jid, chat.name),
          savedName: chat.name,
          isGroup: chat.isGroup,
          subtitle: chatPreview(chat, thread(chat.jid).messages),
          timestamp: formatListTime(chat.timestamp),
          unread: isUnread(chat),
          picture: avatarFor(chat.jid),
        }))}
        onOpen={open}
        onSearch={search}
        onRowFocused={rowFocused}
      />
    );
  }

  // When the list can take the focus again (see KeptPage), it goes back where
  // the wearer was; shown the first time, to the newest chat, unless the
  // wearer is already in the list.
  const layerRef = useRef<HTMLDivElement>(null);
  const takeFocus = useRef<{to: string | null; first: boolean} | null>(null);
  useLayoutEffect(() => {
    if (layerRef.current == null) {
      return;
    }
    const before = wasShown.current;
    wasShown.current = shown;
    if (shown && before !== true) {
      takeFocus.current = {to: returnTo, first: before === null};
      cameFrom.current = null;
    }
  });
  const focusRow = useCallback(() => {
    const layer = layerRef.current;
    const pending = takeFocus.current;
    takeFocus.current = null;
    if (layer == null || pending == null) {
      return;
    }
    const focused = document.activeElement;
    if (pending.first && focused instanceof HTMLElement && layer.contains(focused)) {
      return;
    }
    const target =
      (pending.to == null ? null : layer.querySelector<HTMLElement>(`[data-row="${CSS.escape(pending.to)}"]`)) ??
      layer.querySelector<HTMLElement>('[data-chat]');
    target?.focus();
  }, []);

  const order = shown ? shownRows.map(chat => chat.jid).join(' ') : '';
  useEffect(() => {
    const first = layerRef.current?.querySelector<HTMLElement>('[data-chat]');
    const focused = document.activeElement;
    const list = first?.closest('[data-uit-focus-boundary-root]');
    if (launch.untouched && first != null && focused instanceof HTMLElement && focused !== first && list?.contains(focused)) {
      first.focus();
    }
  }, [order]);

  if (!mounted) {
    return null;
  }
  return (
    <KeptPage ref={layerRef} shown={shown} onLive={focusRow}>
      {view.current}
    </KeptPage>
  );
}

type ChatListViewProps = {
  headerText: string;
  loading: boolean;
  metadata: string | undefined;
  voiceSearch: boolean;
  rows: Row[];
  onOpen(jid: string): void;
  onSearch(): void;
  onRowFocused(key: string, index: number): void;
};

const sameRowData = (previous: Row, next: Row) =>
  (Object.keys(next) as (keyof Row)[]).every(key => previous[key] === next[key]);

// The list is drawn again only when what it shows changes, not whenever the
// chats are refreshed or the list shows again.
function sameView(previous: ChatListViewProps, next: ChatListViewProps): boolean {
  return (
    (Object.keys(next) as (keyof ChatListViewProps)[]).every(key => key === 'rows' || previous[key] === next[key]) &&
    previous.rows.length === next.rows.length &&
    next.rows.every((row, index) => sameRowData(previous.rows[index], row))
  );
}

/**
 * A row's element is kept while what it shows (and its place) is unchanged:
 * React skips an element it has already rendered, so only the rows whose chat
 * changed are drawn again.
 */
function useKeptRows(): (row: Row, index: number, render: () => ReactElement) => ReactElement {
  const kept = useRef(new Map<string, {row: Row; index: number; element: ReactElement}>());
  return useCallback((row, index, render) => {
    const previous = kept.current.get(row.jid);
    if (previous != null && previous.index === index && sameRowData(previous.row, row)) {
      return previous.element;
    }
    const element = render();
    kept.current.set(row.jid, {row, index, element});
    return element;
  }, []);
}

const ChatListView = memo(function ChatListView({
  headerText,
  loading,
  metadata,
  voiceSearch,
  rows,
  onOpen,
  onSearch,
  onRowFocused,
}: ChatListViewProps) {
  const keptRow = useKeptRows();
  return (
    <Page headerText={headerText} headerIsLoading={loading} headerMetadata={metadata} enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel={t('chatListLabel')}>
        {/* Above the first chat, one Up away; the first chat keeps the initial focus. */}
        {voiceSearch ? (
          <ListItem
            title={t('voiceSearchRow')}
            subtitle={t('voiceSearchHint')}
            icon={microphoneFilled}
            initialFocusEligible={false}
            data-row={VOICE_ROW}
            onFocus={() => onRowFocused(VOICE_ROW, -1)}
            onClick={onSearch}
          />
        ) : null}
        {rows.map((row, index) =>
          keptRow(row, index, () => (
            <ListItem
              key={row.jid}
              title={row.name}
              subtitle={row.subtitle}
              timestamp={row.timestamp}
              timestampPosition={TimestampPosition.ACCESSORY_TOP}
              timestampTextColor={row.unread ? TimestampTextColor.ACCENT : TimestampTextColor.PRIMARY}
              avatarSrc={row.picture ?? undefined}
              avatarPrimaryContent={row.picture ? undefined : avatarFallback(row.savedName, row.isGroup)}
              avatarAlt={row.name}
              avatarStatusIndicator={row.unread ? StatusIndicatorType.UNREAD : undefined}
              data-row={row.jid}
              data-chat=""
              onFocus={() => onRowFocused(row.jid, index)}
              onClick={() => onOpen(row.jid)}
            />
          )),
        )}
      </VerticalList>
    </Page>
  );
}, sameView);
