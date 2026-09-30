// One chat bubble; based on the UI Toolkit messaging example. Activating a
// bubble opens its context menu: four reactions and Reply.

import arrowBigReplyFilled from '@wearables-ui-toolkit/icons/svg/arrowbigreply__filled.svg';
import {
  ButtonContextMenuItemView,
  Container,
  ContextMenu,
  CornerRadius,
  DismissReason,
  EmojiContextMenuItemView,
  MaterialLibrary,
  TailShapeProvider,
  TextColor,
  TextStyle,
  TextView,
  TooltipMode,
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useLayoutEffect, useMemo, useRef, useState, type MouseEvent} from 'react';
import type {ChatMessage} from '../evolution/parse';
import {describeContent, formatBubbleTime, isMarker} from '../format';
import {t} from '../i18n/strings';

export const REACTIONS = ['👍', '❤️', '😂', '😭'] as const;

type MessageBubbleProps = {
  message: ChatMessage;
  /** Shows the sender name above the first bubble of a run (group chats). */
  showSender: boolean;
  /** Shows the time below the last bubble of a run. */
  endsRun: boolean;
  tails: boolean;
  initialFocusEligible: boolean;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
};

const OUTBOUND_TOKEN_NAMES = {
  idleFill: '--uit-color-background-message-outbound',
  gradientStep1: '--uit-color-container-message-outbound-target-step1',
  gradientStep2: '--uit-color-container-message-outbound-target-step2',
  gradientStep3: '--uit-color-container-message-outbound-target-step3',
  gradientStep4: '--uit-color-container-message-outbound-target-step4',
  glowTint: '--uit-color-container-message-outbound-glow',
} as const;

function resolveColorToken(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (value.length === 0) {
    throw new Error(`Missing toolkit color token: ${token}`);
  }
  return value;
}

// The bubble exposes the same focus handle shape as a toolkit Button trigger.
type TriggerHandle = Pick<ButtonHandle, 'getElement'>;

type ReactionItemProps = {emoji: string; onChoose: (emoji: string, event?: MouseEvent<HTMLElement>) => void};

function ReactionItem({emoji, onChoose}: ReactionItemProps) {
  const choose = (event?: MouseEvent<HTMLElement>) => onChoose(emoji, event);
  return <EmojiContextMenuItemView emoji={emoji} ariaLabel={t('reactWith', {emoji})} onClick={choose} />;
}

export function MessageBubble({
  message,
  showSender,
  endsRun,
  tails,
  initialFocusEligible,
  onReact,
  onReply,
}: MessageBubbleProps) {
  const isOutgoing = message.fromMe;
  const tailDirection = tails && endsRun ? (isOutgoing ? 'right' : 'left') : 'none';
  const shapeProvider = useMemo(
    () => new TailShapeProvider(tailDirection, CornerRadius.MEDIUM),
    [tailDirection],
  );
  const material = useMemo(() => {
    if (!isOutgoing) {
      return MaterialLibrary.inboundMessage();
    }
    return MaterialLibrary.outboundMessage({
      idleFill: resolveColorToken(OUTBOUND_TOKEN_NAMES.idleFill),
      gradientStep1: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep1),
      gradientStep2: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep2),
      gradientStep3: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep3),
      gradientStep4: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep4),
      glowTint: resolveColorToken(OUTBOUND_TOKEN_NAMES.glowTint),
    });
  }, [isOutgoing]);
  const text = describeContent(message.content);
  const time = formatBubbleTime(message.timestamp);
  const sender = isOutgoing ? t('you') : message.senderName;
  const spoken = sender ? t('bubbleLabel', {sender, text, time}) : `${text}, ${time}`;

  const [menuOpen, setMenuOpen] = useState(false);
  // Public handle for the bubble that opens the menu, used to return focus to it.
  const bubbleElementRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TriggerHandle>({getElement: () => bubbleElementRef.current});

  const shouldReturnFocusToTriggerRef = useRef(false);
  useLayoutEffect(() => {
    if (!menuOpen && shouldReturnFocusToTriggerRef.current) {
      shouldReturnFocusToTriggerRef.current = false;
      triggerRef.current?.getElement()?.focus({preventScroll: true});
    }
  }, [menuOpen]);

  const toggleMenu = () => setMenuOpen(open => !open);
  const dismissMenuToTrigger = (event?: MouseEvent<HTMLElement>) => {
    // Menu items render in a portal owned by the bubble; keep the click from
    // reaching the bubble and reopening the menu.
    event?.stopPropagation();
    shouldReturnFocusToTriggerRef.current = true;
    setMenuOpen(false);
  };
  const chooseReaction = (emoji: string, event?: MouseEvent<HTMLElement>) => {
    dismissMenuToTrigger(event);
    onReact(message, emoji);
  };
  const chooseReply = (event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setMenuOpen(false);
    onReply(message);
  };

  const menu = (
    <ContextMenu
      aria-label={t('messageActionsLabel', {message: text})}
      onDismiss={reason => {
        if (reason === DismissReason.BACK_BUTTON || reason === DismissReason.NAVIGATION) {
          dismissMenuToTrigger();
        }
      }}>
      {REACTIONS.map(emoji => (
        <ReactionItem key={emoji} emoji={emoji} onChoose={chooseReaction} />
      ))}
      <ButtonContextMenuItemView
        title={t('replyAction')}
        icon={arrowBigReplyFilled}
        onClick={chooseReply}
      />
    </ContextMenu>
  );

  return (
    <div
      className={`message-row ${isOutgoing ? 'message-row--outgoing' : ''}`}>
      <div className="message-column">
        {showSender && message.senderName ? (
          <TextView
            className="message-sender"
            as="p"
            textStyle={TextStyle.META2}
            textColor={TextColor.SECONDARY}>
            {message.senderName}
          </TextView>
        ) : null}
        <Container
          ref={bubbleElementRef}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          ariaLabel={t('messageActionsLabel', {message: spoken})}
          clickable
          focusable
          initialFocusEligible={initialFocusEligible}
          material={material}
          onClick={toggleMenu}
          shapeProvider={shapeProvider}
          tooltipMode={menuOpen ? TooltipMode.FOCUSED : TooltipMode.NONE}
          tooltipFocusable
          tooltipHidesFocusState
          tooltipContentDescription={t('messageActionsLabel', {message: text})}
          tooltipContent={menu}>
          <div className="message-bubble-content">
            <TextView
              className="message-text"
              as="p"
              textStyle={TextStyle.BODY2}
              textColor={isMarker(message.content) ? TextColor.SECONDARY : undefined}>
              {text}
            </TextView>
          </div>
        </Container>
        {endsRun ? (
          <TextView
            className="message-timestamp"
            as="p"
            textStyle={TextStyle.META2}
            textColor={TextColor.SECONDARY}>
            {time}
          </TextView>
        ) : null}
      </div>
    </div>
  );
}
