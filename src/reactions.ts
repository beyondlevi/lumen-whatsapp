// Reactions arrive as their own messages (reactionMessage) that point at the
// message they react to. The thread shows them only as a badge on that
// message: the latest reaction of each sender counts, and an empty one removes it.
import type {ChatMessage} from './evolution/parse';

export type ReactionSummary = {emoji: string; count: number; mine: boolean};

export type ThreadView = {
  /** Messages to draw as bubbles (no reaction records). */
  messages: ChatMessage[];
  /** Reaction badges by the id of the message they react to. */
  reactions: Map<string, ReactionSummary[]>;
};

export function isReaction(message: ChatMessage): boolean {
  return message.content.kind === 'reaction';
}

function senderKey(message: ChatMessage): string {
  return message.fromMe ? 'me' : message.participant ?? message.remoteJid;
}

/** Splits reaction records out of a thread (oldest first) into per-message badges. */
export function splitReactions(messages: ChatMessage[]): ThreadView {
  const visible: ChatMessage[] = [];
  const bySender = new Map<string, Map<string, string>>();
  for (const message of messages) {
    if (!isReaction(message)) {
      visible.push(message);
      continue;
    }
    const target = message.content.targetId;
    if (!target) {
      continue;
    }
    const senders = bySender.get(target) ?? new Map<string, string>();
    const sender = senderKey(message);
    // Re-adding keeps insertion order meaningful: the latest reaction goes last.
    senders.delete(sender);
    if (message.content.text) {
      senders.set(sender, message.content.text);
    }
    bySender.set(target, senders);
  }

  const known = new Set(visible.map(message => message.id));
  const reactions = new Map<string, ReactionSummary[]>();
  for (const [target, senders] of bySender) {
    if (!known.has(target) || senders.size === 0) {
      continue;
    }
    const summaries: ReactionSummary[] = [];
    for (const [sender, emoji] of senders) {
      const summary = summaries.find(item => item.emoji === emoji);
      if (summary) {
        summary.count += 1;
        summary.mine ||= sender === 'me';
      } else {
        summaries.push({emoji, count: 1, mine: sender === 'me'});
      }
    }
    reactions.set(target, summaries);
  }
  return {messages: visible, reactions};
}

export function reactionCount(summaries: ReactionSummary[] | undefined): number {
  return (summaries ?? []).reduce((total, summary) => total + summary.count, 0);
}
