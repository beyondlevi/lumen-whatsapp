// One chat bubble; based on the UI Toolkit messaging example. Activating a
// bubble picks it as the message to reply to.

import {
  Container,
  CornerRadius,
  MaterialLibrary,
  TailShapeProvider,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {useMemo} from 'react';
import type {ChatMessage} from '../evolution/parse';
import {describeContent, formatBubbleTime, isMarker} from '../format';
import {t} from '../i18n/strings';

type MessageBubbleProps = {
  message: ChatMessage;
  /** Shows the sender name above the first bubble of a run (group chats). */
  showSender: boolean;
  /** Shows the time below the last bubble of a run. */
  endsRun: boolean;
  /** This message is the one being replied to. */
  selected: boolean;
  onSelect: (message: ChatMessage) => void;
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

export function MessageBubble({message, showSender, endsRun, selected, onSelect}: MessageBubbleProps) {
  const isOutgoing = message.fromMe;
  const tailDirection = endsRun ? (isOutgoing ? 'right' : 'left') : 'none';
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
  const selectMessage = () => onSelect(message);
  const spoken = sender ? t('bubbleLabel', {sender, text, time}) : `${text}, ${time}`;

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
          aria-pressed={selected}
          ariaLabel={t('quoteBubbleLabel', {message: spoken})}
          clickable
          focusable
          initialFocusEligible={false}
          material={material}
          onClick={selectMessage}
          shapeProvider={shapeProvider}>
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
