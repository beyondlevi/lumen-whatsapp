import {
  InputTextView,
  Page,
  TextStyle,
  TextView,
  Toast,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent} from 'react';
import {Navigate, useParams} from 'react-router-dom';
import {MessageBubble} from '../components/MessageBubble';
import type {EvolutionErrorKind} from '../evolution/client';
import {isGroupJid, type ChatMessage} from '../evolution/parse';
import {chatDisplayName, describeContent, endsMessageRun, startsMessageRun} from '../format';
import {t, type StringKey} from '../i18n/strings';
import {useWhatsApp} from '../WhatsAppProvider';
import {StatusPage} from './StatusPage';

const FAILURE_REASONS: Record<EvolutionErrorKind, StringKey> = {
  network: 'reasonNetwork',
  auth: 'reasonAuth',
  instance: 'reasonInstance',
  rejected: 'reasonRejected',
  server: 'reasonServer',
};

const REPLY_FIELD_ID = 'reply-field';
const QUOTE_SNIPPET_LENGTH = 24;

function snippet(text: string): string {
  const chars = Array.from(text);
  return chars.length > QUOTE_SNIPPET_LENGTH
    ? `${chars.slice(0, QUOTE_SNIPPET_LENGTH - 1).join('').trimEnd()}…`
    : text;
}

function failureReason(error: unknown): string {
  const kind = error instanceof Error && 'kind' in error ? String(error.kind) : '';
  return t(kind in FAILURE_REASONS ? FAILURE_REASONS[kind as EvolutionErrorKind] : 'reasonServer');
}

export function ThreadPage() {
  const {jid} = useParams();
  const {phase} = useWhatsApp();

  if (!jid) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <Thread jid={jid} />;
}

function Thread({jid}: {jid: string}) {
  const {chatFor, thread, openThread, sendText, offline} = useWhatsApp();
  const chat = chatFor(jid);
  const name = chatDisplayName(jid, chat?.name);
  const {loaded, messages} = thread(jid);
  const isGroup = chat?.isGroup ?? isGroupJid(jid);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Message picked (Enter on a bubble) to reply to; Enter again cancels it.
  const [quoted, setQuoted] = useState<ChatMessage | null>(null);
  const selectQuote = useCallback((message: ChatMessage) => {
    setQuoted(current => (current?.id === message.id ? null : message));
    document.getElementById(REPLY_FIELD_ID)?.focus({preventScroll: true});
  }, []);
  // Marks the end of the conversation (below the newest bubble and its time).
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;

  useEffect(() => openThread(jid), [jid, openThread]);

  // Reveal the newest message on entry, and when a new one arrives while the
  // end of the conversation is on screen (the reader is not reading older ones).
  const endVisibleRef = useRef(true);
  const revealedRef = useRef(false);
  useEffect(() => {
    const end = endRef.current;
    if (end == null || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      endVisibleRef.current = entries.some(entry => entry.isIntersecting);
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (lastMessageId == null) {
      return;
    }
    if (!revealedRef.current || endVisibleRef.current) {
      endRef.current?.scrollIntoView({block: 'end'});
      revealedRef.current = true;
    }
  }, [lastMessageId]);

  const handleSend = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || sending) {
        return;
      }
      setSending(true);
      sendText(jid, body, quoted)
        .then(() => {
          setDraft('');
          setQuoted(null);
          Toast.show(t('messageSent'));
        })
        .catch(error => {
          Toast.show(t('sendFailed', {reason: failureReason(error)}));
        })
        .finally(() => setSending(false));
    },
    [jid, quoted, sendText, sending],
  );

  // The host hands focus to the document root while its own text entry (the
  // dictation composer) is open. Reclaim only that handoff so the reply field
  // keeps focus when the dictated text arrives.
  const handleDraftBlur = useCallback((event: FocusEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      const focusLeftTheDocument =
        focused == null || focused === document.body || focused === document.documentElement;
      if (input.isConnected && focusLeftTheDocument) {
        input.focus({preventScroll: true});
      }
    });
  }, []);

  const statusKey: StringKey | null = !loaded
    ? 'threadLoadingTitle'
    : messages.length === 0
      ? 'threadEmptyTitle'
      : null;

  return (
    <Page
      headerText={name}
      headerMetadata={offline ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      <div className="thread-shell">
        <VerticalList
          insetForHeader
          contentClassName="message-list"
          ariaLabel={t('threadLabel', {name})}>
            {statusKey ? (
              <div className="thread-status" role="status">
                <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                  {t(statusKey)}
                </TextView>
                {loaded ? (
                  <TextView as="p" textStyle={TextStyle.BODY2}>
                    {t('threadEmptyBody')}
                  </TextView>
                ) : null}
              </div>
            ) : null}
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                showSender={isGroup && !message.fromMe && startsMessageRun(messages, index)}
                endsRun={endsMessageRun(messages, index)}
                selected={message.id === quoted?.id}
                onSelect={selectQuote}
              />
            ))}
            <div className="message-end" ref={endRef} />
        </VerticalList>
        <div className="action-dock">
          <div className="draft-input">
            <InputTextView
              text={draft}
              hint={quoted ? t('quoteHint', {text: snippet(describeContent(quoted.content))}) : t('replyHint')}
              actionLabel={t('sendLabel')}
              loadingLabel={t('sendingLabel')}
              showLoader={sending}
              onTextChange={setDraft}
              onSend={handleSend}
              inputProps={{
                'aria-label': t('replyFieldLabel', {name}),
                id: REPLY_FIELD_ID,
                onBlur: handleDraftBlur,
                readOnly: sending,
              }}
            />
          </div>
        </div>
      </div>
    </Page>
  );
}
