import {
  ListItem,
  Page,
  StatusIndicatorType,
  TimestampPosition,
  TimestampTextColor,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {avatarFallback} from '../components/avatarFallback';
import {chatDisplayName, chatPreview, formatListTime} from '../format';
import {t} from '../i18n/strings';
import {useReturnOrder} from '../state/useReturnOrder';
import {useWhatsApp} from '../WhatsAppProvider';
import {ChatListEmptyPage} from './ChatListEmptyPage';
import {StatusPage} from './StatusPage';

export function chatPath(jid: string): string {
  return `/chat/${encodeURIComponent(jid)}`;
}

export function ChatListPage() {
  const navigate = useNavigate();
  const {phase, chats, offline, syncing, isUnread, listOrder, thread, avatarFor, requestAvatar} = useWhatsApp();

  const rows = useReturnOrder(chats, listOrder);

  // Profile pictures load once per chat while the list is shown.
  useEffect(() => {
    for (const chat of rows) {
      requestAvatar(chat.jid, chat.avatarUrl);
    }
  }, [requestAvatar, rows]);

  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  if (chats.length === 0) {
    return <ChatListEmptyPage offline={offline} />;
  }

  return (
    <Page
      headerText={syncing ? t('loadingHeader') : t('chatsHeader')}
      headerIsLoading={syncing}
      headerMetadata={offline && !syncing ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel={t('chatListLabel')}>
        {rows.map(chat => {
          const name = chatDisplayName(chat.jid, chat.name);
          const unread = isUnread(chat);
          const picture = avatarFor(chat.jid);
          return (
            <ListItem
              key={chat.jid}
              title={name}
              subtitle={chatPreview(chat, thread(chat.jid).messages)}
              timestamp={formatListTime(chat.timestamp)}
              timestampPosition={TimestampPosition.ACCESSORY_TOP}
              timestampTextColor={unread ? TimestampTextColor.ACCENT : TimestampTextColor.PRIMARY}
              avatarSrc={picture ?? undefined}
              avatarPrimaryContent={picture ? undefined : avatarFallback(chat.name, chat.isGroup)}
              avatarAlt={name}
              avatarStatusIndicator={unread ? StatusIndicatorType.UNREAD : undefined}
              onClick={() => navigate(chatPath(chat.jid))}
            />
          );
        })}
      </VerticalList>
    </Page>
  );
}
