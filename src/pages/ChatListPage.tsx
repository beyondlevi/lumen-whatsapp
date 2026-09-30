import circleUserFilled from '@wearables-ui-toolkit/icons/svg/circleuser__filled.svg';
import circleUserStackFilled from '@wearables-ui-toolkit/icons/svg/circleuserstack__filled.svg';
import {
  IconImage,
  ListItem,
  Page,
  StatusIndicatorType,
  TimestampPosition,
  TimestampTextColor,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {chatDisplayName, chatPreview, formatListTime, initials} from '../format';
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
  const {phase, chats, offline, syncing, isUnread, listOrder} = useWhatsApp();

  const rows = useReturnOrder(chats, listOrder);

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
          const avatar = chat.name ? (
            initials(chat.name)
          ) : (
            <IconImage source={chat.isGroup ? circleUserStackFilled : circleUserFilled} />
          );
          return (
            <ListItem
              key={chat.jid}
              title={name}
              subtitle={chatPreview(chat)}
              timestamp={formatListTime(chat.timestamp)}
              timestampPosition={TimestampPosition.ACCESSORY_TOP}
              timestampTextColor={unread ? TimestampTextColor.ACCENT : TimestampTextColor.PRIMARY}
              avatarPrimaryContent={avatar}
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
