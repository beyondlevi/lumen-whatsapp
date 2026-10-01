// Fictional chats for demo mode (screenshots and videos). Every name, place and
// number is made up; phone numbers use the 555-0100–0199 range reserved for
// fiction. Times are clock times on a fixed demo day so captures look the same
// on every launch: "today" ends at 09:41.

export type DemoMessage = {
  id: string;
  fromMe: boolean;
  /** Sender JID of a group message. */
  participant?: string;
  /** Sender name of an incoming message. */
  pushName?: string;
  /** Days before the demo day (0 = today). */
  daysAgo: number;
  /** Local clock time, `HH:MM`. */
  time: string;
  messageType: string;
  message: Record<string, unknown>;
};

export type DemoChat = {
  jid: string;
  /** Contact or group name; omitted for a number that is not in the contacts. */
  name?: string;
  unreadCount: number;
  messages: DemoMessage[];
  /** Answer that arrives once, a few seconds after the first reply sent in this chat. */
  autoReply?: string;
};

/** Clock time of the newest demo message. */
export const DEMO_DAY_END = '09:41';

const MAYA = '12025550101@s.whatsapp.net';
const SAM = '12025550102@s.whatsapp.net';
const JORDAN = '12025550103@s.whatsapp.net';
const ANA = '12025550104@s.whatsapp.net';
const LEO = '12025550105@s.whatsapp.net';
const PRIYA = '12025550106@s.whatsapp.net';
const BIKES = '12025550107@s.whatsapp.net';
const UNKNOWN = '12025550199@s.whatsapp.net';
const HIKE = '120363000000000042@g.us';

const text = (value: string) => ({messageType: 'conversation', message: {conversation: value}});
const photo = (caption: string) => ({messageType: 'imageMessage', message: {imageMessage: {caption}}});
const audio = () => ({messageType: 'audioMessage', message: {audioMessage: {seconds: 9, ptt: true}}});
const file = (fileName: string) => ({messageType: 'documentMessage', message: {documentMessage: {fileName}}});
const location = (name: string) => ({messageType: 'locationMessage', message: {locationMessage: {name}}});

let counter = 0;
function message(
  fromMe: boolean,
  daysAgo: number,
  time: string,
  content: {messageType: string; message: Record<string, unknown>},
  sender?: {pushName: string; participant?: string},
): DemoMessage {
  counter += 1;
  return {
    id: `DEMO${String(counter).padStart(4, '0')}`,
    fromMe,
    daysAgo,
    time,
    ...content,
    ...(sender ?? {}),
  };
}

const me = (daysAgo: number, time: string, content: ReturnType<typeof text>) =>
  message(true, daysAgo, time, content);

/** A fresh copy of the demo chats, newest activity first. */
export function demoChats(): DemoChat[] {
  counter = 0;
  const maya = {pushName: 'Maya Chen'};
  const ana = {pushName: 'Ana Ruiz', participant: ANA};
  const leo = {pushName: 'Leo Park', participant: LEO};
  const priya = {pushName: 'Priya Nair', participant: PRIYA};
  const sam = {pushName: 'Sam Rivera'};
  const bikes = {pushName: 'Bike Shop'};
  const jordan = {pushName: 'Jordan Lee'};
  return [
    {
      jid: MAYA,
      name: 'Maya Chen',
      unreadCount: 2,
      autoReply: 'Perfect, thanks! See you at 10.',
      messages: [
        message(false, 0, '09:16', text('Morning! Are we still on for the design review?'), maya),
        me(0, '09:18', text('Yes, 10:00 in Room 3.')),
        me(0, '09:18', text("I'll share the slides before then.")),
        message(false, 0, '09:24', photo('Whiteboard from Monday'), maya),
        message(false, 0, '09:40', text('Great, see you there.'), maya),
        message(false, 0, DEMO_DAY_END, text('Can you bring the projector?'), maya),
      ],
    },
    {
      jid: HIKE,
      name: 'Hike Crew',
      unreadCount: 2,
      messages: [
        message(false, 0, '08:02', text("Who's in for Saturday?"), ana),
        message(false, 0, '08:05', text('Me! Leaving at 7.'), leo),
        me(0, '08:07', text('Count me in.')),
        message(false, 0, '08:30', text("Same. I'll bring snacks."), priya),
        message(false, 0, '09:28', photo('Trail map'), leo),
      ],
    },
    {
      jid: SAM,
      name: 'Sam Rivera',
      unreadCount: 0,
      autoReply: 'Great, I booked a table.',
      messages: [
        message(false, 1, '21:02', audio(), sam),
        message(false, 0, '08:10', text('Dinner tonight?'), sam),
        me(0, '08:15', text('Sounds good, 7 pm works.')),
      ],
    },
    {
      jid: BIKES,
      name: 'Bike Shop',
      unreadCount: 0,
      messages: [
        message(false, 1, '18:12', text('Your bike is ready for pickup.'), bikes),
        message(false, 1, '18:20', file('Invoice_0042.pdf'), bikes),
      ],
    },
    {
      jid: JORDAN,
      name: 'Jordan Lee',
      unreadCount: 0,
      messages: [
        me(3, '19:40', text('Where should we meet?')),
        message(false, 3, '19:45', location('Central Station'), jordan),
      ],
    },
    {
      jid: UNKNOWN,
      unreadCount: 1,
      messages: [message(false, 9, '14:05', text('Hi! Is the desk still available?'))],
    },
  ];
}
