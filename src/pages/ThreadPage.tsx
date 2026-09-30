import imageFilled from '@wearables-ui-toolkit/icons/svg/image__filled.svg';
import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
import {
  Button,
  ButtonRail,
  InputTextView,
  Page,
  TextStyle,
  TextView,
  Toast,
  VerticalList,
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent} from 'react';
import {Navigate, useLocation, useNavigate, useParams} from 'react-router-dom';
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
  const {chatFor, thread, openThread, sendText, sendReaction, offline} = useWhatsApp();
  const location = useLocation();
  const navigate = useNavigate();
  const chat = chatFor(jid);
  const name = chatDisplayName(jid, chat?.name);
  const {loaded, synced, messages} = thread(jid);
  const isGroup = chat?.isGroup ?? isGroupJid(jid);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [tails, setTails] = useState(true);
  // Message chosen with the bubble menu's Reply; sent as a quoted reply.
  const [quoted, setQuoted] = useState<ChatMessage | null>(null);
  const replyButtonRef = useRef<ButtonHandle>(null);

  const composerOpen =
    location.state != null &&
    typeof location.state === 'object' &&
    'replyComposer' in location.state &&
    location.state.replyComposer === true;
  const composerWasOpenRef = useRef(false);
  useLayoutEffect(() => {
    if (composerWasOpenRef.current && !composerOpen) {
      setDraft('');
      setQuoted(null);
      replyButtonRef.current?.getElement()?.focus({preventScroll: true});
    }
    composerWasOpenRef.current = composerOpen;
  }, [composerOpen]);

  const openComposer = useCallback(
    (message: ChatMessage | null) => {
      setQuoted(message);
      if (!composerOpen) {
        navigate(location.pathname, {state: {replyComposer: true}});
      }
    },
    [composerOpen, location.pathname, navigate],
  );
  const startReply = useCallback(() => openComposer(null), [openComposer]);
  const toggleTails = useCallback(() => setTails(current => !current), []);

  const react = useCallback(
    (message: ChatMessage, emoji: string) => {
      sendReaction(message, emoji)
        .then(() => Toast.show(t('reactionSent', {emoji})))
        .catch(error => Toast.show(t('reactionFailed', {reason: failureReason(error)})));
    },
    [sendReaction],
  );

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
          Toast.show(t('messageSent'));
          // Closing the composer entry clears the draft and refocuses Reply.
          navigate(-1);
        })
        .catch(error => {
          Toast.show(t('sendFailed', {reason: failureReason(error)}));
        })
        .finally(() => setSending(false));
    },
    [jid, navigate, quoted, sendText, sending],
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

  return (
    <Page
      headerText={name}
      headerIsLoading={!synced}
      headerMetadata={offline && synced ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      <div className="thread-shell">
        <VerticalList
          insetForHeader
          contentClassName="message-list"
          ariaLabel={t('threadLabel', {name})}>
          {loaded && messages.length === 0 ? (
            <div className="thread-status" role="status">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {t('threadEmptyTitle')}
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {t('threadEmptyBody')}
              </TextView>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              showSender={isGroup && !message.fromMe && startsMessageRun(messages, index)}
              endsRun={endsMessageRun(messages, index)}
              tails={tails}
              initialFocusEligible={!composerOpen && index === messages.length - 1}
              onReact={react}
              onReply={openComposer}
            />
          ))}
          <div className="message-end" ref={endRef} />
        </VerticalList>
        <div className="action-dock">
          {composerOpen ? (
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
                  autoFocus: true,
                  onBlur: handleDraftBlur,
                  readOnly: sending,
                }}
              />
            </div>
          ) : (
            <ButtonRail centerContentWhenSmallerThanWidth={false} anchorIndex={1}>
              <Button
                ref={replyButtonRef}
                title={t('replyAction')}
                initialFocusEligible={messages.length === 0}
                onClick={startReply}
              />
              <Button title={t('voiceAction')} icon={microphoneFilled} disabled initialFocusEligible={false} />
              <Button title={t('photosAction')} icon={imageFilled} disabled initialFocusEligible={false} />
              <Button
                title={tails ? t('hideTails') : t('showTails')}
                initialFocusEligible={false}
                onClick={toggleTails}
              />
            </ButtonRail>
          )}
        </div>
      </div>
    </Page>
  );
}
