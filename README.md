# lumen-whatsapp

WhatsApp client for **Rokid Lumen** glasses, built as a Meta Ray-Ban Display (MRBD) web app with the official
[UI Toolkit for Meta Ray-Ban Display](https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web) and
backed by an [Evolution API v2](https://github.com/EvolutionAPI/evolution-api) server. The screens follow the
toolkit's messaging example (`examples/messaging`).

- **Chats**: profile picture, name, preview, and time for the 40 most recent chats. Unread chats have an
  unread dot on the avatar and an accent-colored time. The last list and the 30 most recent messages of up to 20 chats are
  cached in localStorage (never the API key). On launch the cached list shows at once, and the header
  shows a spinner with “Loading…” until the first refresh arrives.
- **Conversation**: the 30 most recent messages, starting below the header (nothing runs under the name
  chip), with the chat's picture in the header. Videos, stickers, documents, locations, contacts and polls
  show a marker (“Video”, “Document: …”).
- **Photos**: Enter on a photo opens its menu with **View** first. View downloads the photo
  (`getBase64FromMediaMessage`) and shows it full screen on the dark window background, with a loader
  while it downloads and an error with **Try again** if it fails. Back returns to the same bubble.
- **Voice messages**: the bubble shows the length; Enter plays or pauses it, with the position and a
  progress bar. The audio is downloaded on the first play. WhatsApp voice notes are OGG/Opus, which
  `<audio>` plays in GeckoView and in Chromium; if `canPlayType` says no, the app asks the server for MP4
  (`convertToMp4`). One message plays at a time and playback stops when the conversation closes.
  Enter on a voice message opens its menu: **Listen** (it reads **Pause** while playing), **Transcribe**,
  the four reactions and Reply.
- **Sending voice notes**: **Voice** opens the recording screen, which records through the Lumen host's
  microphone API (see "Lumen audio API" below). Send posts the note to `sendWhatsAppAudio`; it arrives
  as a WhatsApp voice note (ptt).
- **Reactions**: a reaction is never a bubble. Each message shows a badge under its bottom-right corner
  with the emojis people reacted with and, from 2 on, the count (the latest reaction of each person
  counts; an empty one removes it). This covers reactions from the server (`reactionMessage` records
  pointing at the message's key) and your own, which show at once.
- **Previews**: when the newest record of a chat is a reaction, the list shows the newest real message if
  the reaction is yours (or was removed), and “Reacted ❤️ to “…”” for someone else's (“Reacted ❤️” when
  the message is not loaded yet; with the sender's first name in groups).
- **Profile pictures**: from `profilePicUrl` in `findChats` when the server has it, otherwise one
  `fetchProfilePictureUrl` per chat (two at a time), cached in localStorage (`lumen-whatsapp.avatars.v1`,
  24 h; “no picture” 6 h). A picture is shown only after it loads; otherwise the initials (or a
  person/group icon) stay.
- **Conversation actions**: a bottom rail with Reply, Voice (records a voice note when the host has
  `window.lumen.audio`, disabled otherwise) and Photos (disabled).
- **Reply**: the text field (the toolkit's `InputTextView`, a real `<textarea>`) appears only after Reply,
  as its own history entry, so Back closes it and focus returns to Reply. On the glasses, Enter on the
  field opens the platform's dictation composer, and the text arrives through `input`/`change` events.
  Right then moves to Send. After sending, the field closes.
- **Message menu**: Enter on a bubble opens a toolkit `ContextMenu` anchored to it, with View (photos
  only), four reactions (👍 ❤️ 😂 😭) and Reply, which opens the field quoting that message. Back closes the menu and returns
  focus to the bubble.

  `InputTextView` handles Enter in its own `keydown` handler, calling `preventDefault()` and
  `stopPropagation()`. The host must therefore open the composer the way the MRBD host does: on
  activation of the focused field, whatever the page does with the event.
- **Updates**: polling. The open conversation refreshes every 3 s. The chat list refreshes every 5 s, or
  every ~15 s while a conversation is open. Polling pauses while the page is hidden.
- **Language**: English by default; Portuguese (pt-BR wording) for any `pt-*` `navigator.language`,
  including the glasses' `pt-PT`. All UI strings are in `src/i18n/strings.ts`.

## Controls

The app uses only arrow keys, Enter, and Escape (the Neural Band / Rokid gestures).

| Where | Key | Action |
|---|---|---|
| Chats | Up / Down | Move between chats |
| Chats | Enter | Open the chat |
| Chats | Escape | Not handled by the app, so the platform closes it |
| Conversation | Up / Down | Move between the message bubbles (scrolls history) and the action rail |
| Conversation | Enter on Reply | Opens the reply field, focused |
| Reply field | Enter | On the glasses: opens the platform's dictation composer. In a desktop browser: sends the text (UI Toolkit `InputTextView` behavior) |
| Reply field | Right, then Enter | Send (the path to use on the glasses after dictating); the field closes |
| Reply field | Escape | Closes the field, back to Reply |
| Conversation | Enter on a bubble | Opens the message menu |
| Conversation | Enter on a voice message | Opens its menu: Listen/Pause, Transcribe, reactions, Reply |
| Conversation | Enter on Voice | Opens the recording screen |
| Recording | Enter on Send (initial focus) | Stops, sends, returns to the conversation on Voice |
| Recording | Right, Enter (Discard) or Escape | Cancels without sending |
| Transcript | Escape | Back to the voice message (the transcript stays under it) |
| Message menu | Left / Right, Enter | Pick View (photos), 👍 ❤️ 😂 😭 (sends the reaction) or Reply (quoted reply) |
| Photo | Escape | Back to the conversation, on the same bubble |
| Photo error | Enter on “Try again” | Downloads the photo again |
| Message menu | Escape | Closes the menu, back to the bubble |
| Conversation | Escape | Back to the chat list, with the same chat focused |
| Error screens | Enter on “Try again” | Reconnects |
| Setup screen | Enter on “Check again” | Reads the configuration again |

## Configuration (platform contract)

Credentials are never bundled and never typed on the glasses. The phone companion fills in the fields that
`public/manifest.webmanifest` declares:

```json
"lumen_config": [
  {"key": "evolution.url", "label": "Evolution server URL", "type": "url"},
  {"key": "evolution.instance", "label": "Instance", "type": "text"},
  {"key": "evolution.apiKey", "label": "API key", "type": "secret"},
  {"key": "demo", "label": "Demo mode (screenshots)", "type": "text", "optional": true}
],
"lumen_internet": true
```

`lumen_internet: true` asks the platform to route the phone's internet to the offline package. Without it,
calls reach the Evolution server only when the glasses have their own Wi-Fi.

At runtime the app calls `await window.lumen.config.get()`, which returns a `Record<string, string>`
where a missing key means not configured. It subscribes with `window.lumen.config.onChange(cb)`. The
callback may pass the new values or nothing; with nothing, the app calls `get()` again. If `onChange`
returns a function, the app uses it to unsubscribe. See `src/config/lumenConfig.ts`.

- If any key is missing, the app shows the **Setup** screen, which names the missing fields.
- A URL that is not `http(s)://` shows **Invalid server URL**.

### Demo mode

The field is marked `"optional": true`, so the companion does not ask for it (older Lumen versions ignore
the flag). For screenshots and videos, set the **Demo mode (screenshots)** field to exactly `demo-captures` (surrounding
spaces are ignored; any other value, including `demo`, `yes` or a different case, is ignored). The Evolution
fields can stay filled in. The change applies at once, even with the app open. Clear the field to go back to
the server.

In demo mode:

- the chats come from `src/demo/demoData.ts`. They are fictional and in English. Phone numbers use the
  555-0100–0199 range reserved for fiction, and the newest message is at 09:41 "today";
- `src/demo/demoClient.ts` answers with Evolution-shaped payloads, so the same parsing and screens run. It
  never calls `fetch`. Sending takes 0.6 s; Maya Chen and Sam Rivera answer your first reply once, after about
  2.5 s plus the next poll;
- it covers stacked reactions (Hike Crew: 👍👍❤️; Maya's 👍 on your message; Sam's ❤️ as the list preview),
  profile pictures (from the list for Maya and Hike Crew, on request for Sam and Bike Shop, initials for
  Jordan Lee, an icon for the unknown number), two photos to View and a 6 s voice note to play;
- pictures and the voice note are generated by `scripts/generate-demo-media.mjs` (abstract shapes, dark
  backgrounds for the additive display, a synthesized tone melody in OGG/Opus) and ship inside the package
  (`src/demo/assets`). The app reads them from its own origin when they are viewed or played;
- the app reads and writes no storage. The chat cache, the read marks, the picture cache and the development
  config are left as they are, and every launch starts from the same unread chats;
- the copy is in English whatever the device language.

The only request outside the package origin is the Toolkit's Noto Sans stylesheet
(`fonts.googleapis.com`), which `<App>` adds in both modes before the configuration is read.

### Development fallback

When `window.lumen` does not exist (a regular browser), the app reads
`?evolution.url=…&evolution.instance=…&evolution.apiKey=…` (or `?demo=demo-captures`) and stores the values in localStorage under
`lumen-whatsapp.dev-config`. It then removes the parameters from the address bar. An empty value clears
that key.

When `window.lumen` exists, the URL parameters are still removed, but they are ignored.

## Evolution API v2

The endpoints were checked against the Evolution source (v2.3.7, `src/api/routes/*.router.ts` and the
services). Every call is `POST` with the headers `Content-Type: application/json` and `apikey: <key>`.
The instance name is a path segment encoded with `encodeURIComponent`, so a space becomes `%20` and never
`+`, which Evolution would answer with 404.

| Call | Body | Response used |
|---|---|---|
| `POST /chat/findChats/{instance}` | `{"take": 40}` | array of `{remoteJid, pushName, updatedAt, unreadCount, lastMessage}`, most recent first |
| `POST /chat/findContacts/{instance}` | `{"where": {}}` | array of `{remoteJid, pushName}`; requested only when a chat has no name |
| `POST /chat/findMessages/{instance}` | `{"where": {"key": {"remoteJid": "<jid>"}}, "page": 1, "offset": 30}` | `{messages: {total, pages, currentPage, records: [...]}}`, newest first |
| `POST /message/sendText/{instance}` | `{"number": "<jid>", "text": "…"}`, plus `"quoted": {"key": {"id", "fromMe", "remoteJid"}, "message": {"conversation": "…"}}` when replying to a message | 201, the sent message (`key`, `messageTimestamp`, `status: "PENDING"`) |
| `POST /message/sendReaction/{instance}` | `{"key": {"id", "fromMe", "remoteJid", "participant"?}, "reaction": "👍"}` (`participant` for group messages) | 201; failures show a Toast |
| `POST /chat/markMessageAsRead/{instance}` | `{"readMessages": [{"id", "fromMe": false, "remoteJid"}]}` (up to 30) | 201; failures are ignored |
| `POST /chat/fetchProfilePictureUrl/{instance}` | `{"number": "<jid>"}` (contacts and groups) | 200, `{wuid, profilePictureUrl}`; `null` when there is none or it is private |
| `POST /message/sendWhatsAppAudio/{instance}` | `{"number": "<jid>", "audio": "<base64>", "encoding": true}`. `audio` is plain base64 or a URL (class-validator `isBase64`, no `data:` prefix); multipart with a `file` field also works | 201, the sent message. With `encoding: true` (also the default) the server re-encodes with ffmpeg to OGG/Opus mono 48 kHz (`libopus`, `-application voip`) and sends it as a voice note (`ptt: true`, `audio/ogg; codecs=opus`). The host's recording is already OGG/Opus mono 16 kHz; `encoding: false` would skip the conversion, but keeping it is safer for WhatsApp. Source: [`audioWhatsapp`](https://github.com/EvolutionAPI/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L3206), [route](https://github.com/EvolutionAPI/evolution-api/blob/fa09d37892cdbb1d65a250155d293d92230c5b30/src/api/routes/sendMessage.router.ts#L88) |
| `POST /chat/getBase64FromMediaMessage/{instance}` | `{"message": {"key": {"id", "fromMe", "remoteJid"}}, "convertToMp4": false}` | 201, `{mediaType, fileName, mimetype, base64, …}`; 400 when the download fails. The server looks the message up by key and retries a failed download once after 5 s, so the app waits up to 30 s |

`status@broadcast`, `@broadcast` and `@newsletter` chats are hidden.

### Errors

| Condition | Screen |
|---|---|
| `fetch` rejects (offline, DNS, TLS, timeout, **CORS**) | “Can't reach the server” |
| 401 / 403 | “API key rejected” |
| 404 | “Instance not found”. Evolution checks the instance before the key, so a wrong instance gives 404 even with a bad key |
| Other statuses, e.g. 503 `LICENSE_REQUIRED` on 2.4 | “Server error” |

The phone's internet can take 5–15 s to come up after launch. On the first load, network failures are
retried every 3 s for up to 30 s while the header shows the **Loading…** spinner, over the cached list
when there is one. Only after that does it show the network error; with a cached list, the list stays and
the header shows **Offline** instead.

After the first load, a failed poll keeps the data on screen, shows “Connection lost. Retrying…”, and marks
the header **Offline** until a poll succeeds.

### CORS

The glasses call Evolution directly from the page. For the offline package the origin is
`http://127.0.0.1:<port>`, and the port changes, so the server must allow the app with `CORS_ORIGIN`:
either `*` (the default) or a list without spaces.

Evolution reflects the requested headers in the preflight, so `apikey` is allowed. With a restrictive
list, a blocked origin gets HTTP 500 with no CORS headers. The browser reports that as a network error,
so the app shows “Can't reach the server”.

### Known limitations

- **WhatsApp LID chats:** incoming messages may be stored under `<id>@lid` and messages you send under the
  phone JID. The same person can then appear as two chats. Evolution also skips `@lid` JIDs in
  `markMessageAsRead`.
- **Unread state:** `unreadCount` comes from the server. The app also keeps a local “read up to” time per
  chat, in localStorage, so an opened chat stops being highlighted even if the server count lags.
- **No WebSocket:** only polling is used. Evolution's Socket.io is optional and may later replace the
  3 s / 5 s polling.
- **Media:** only photos (View) and voice/audio messages (play) are downloaded. Videos, stickers and
  documents keep their marker. Downloads live in memory for the session (the last 6) and are never stored.
- **Profile pictures** are WhatsApp CDN URLs (`pps.whatsapp.net`) loaded with `<img>`, so they need the
  phone's internet like the rest of the app, and expire after a while (hence the 24 h cache).

## Lumen audio API (voice notes and transcription)

On the Rokid glasses `getUserMedia` is muted for apps, so the app never uses `getUserMedia` or
`MediaRecorder`. The phone captures the glasses' microphone and transcribes, and the Lumen host exposes
that as `window.lumen.audio` (`src/audio/lumenAudio.ts`):

```ts
interface LumenAudio {
  record(options?: {maxMs?: number}): Promise<LumenRecording>;      // the app asks for 120000 (2 min)
  transcribe(audio: Blob, options?: {language?: string; onPartial?: (text: string) => void;
    signal?: AbortSignal}): Promise<{text: string}>;
}
interface LumenRecording {
  onLevel: ((level: number, elapsedMs: number) => void) | null;  // ~5 times a second
  onEnd: ((reason: 'max' | 'error', result?: LumenAudioResult, error?: Error) => void) | null;
  stop(): Promise<LumenAudioResult>;                               // {blob, mimeType, durationMs}
  cancel(): void;
}
// Rejections carry .code: busy, no-phone, unavailable, too-large, unsupported-format, no-speech,
// engine (with .message), cancelled, timeout.
```

- **Feature detection**: the API is used only when `window.lumen.audio` has `record` and `transcribe`.
  On older hosts, **Voice** stays disabled and **Transcribe** is shown disabled ("not available on this
  device").
- **Recording screen** (`/chat/:id/record`, its own history entry):
  - shows the elapsed time, a microphone level bar (from `onLevel`) and **Send** (initial focus) /
    **Discard**;
  - Send stops and sends; Discard or Back cancels without sending;
  - at 2:00 the host ends the recording (`onEnd('max', result)`), and the screen says so and keeps
    Send / Discard;
  - while sending, a spinner; then the Toast "Voice message sent", and the conversation shows the note,
    playable at once from memory;
  - host errors show a message with **Try again**.
- **Transcription screen** (`/chat/:id/transcript/:messageId`, Back closes):
  - downloads the voice note like Listen, calls `transcribe`, and shows the partial text live, then the
    final text;
  - the transcript is kept in memory for the session (opening it again is instant) and also shows under
    the voice bubble;
  - errors (busy, no-phone, too-large, no-speech, engine, …) have their own message and **Try again**;
  - Back aborts a running transcription (`signal`).
- **Demo mode** uses a simulated `window.lumen.audio` (`src/audio/demoAudio.ts`):
  - an animated level while recording, and the packaged demo voice note as the recording;
  - a fixed English transcript delivered word by word;
  - no microphone, no network, no storage.

## Development

```sh
npm install
npm run mock          # mock Evolution v2 on http://127.0.0.1:8089 (instance "Lumen Test", key "mock-api-key")
npm run dev           # then open the URL printed by the mock (it carries the dev parameters)
```

The mock (`mock/server.mjs`) returns the Evolution v2 response shapes. It follows the same guard order
(unknown instance gives 404, then a wrong key gives 401) and error bodies (`{status, error, response:
{message}}`), and it answers CORS preflights.

## Build and package

```sh
npm run build         # typecheck + production build into dist/
npm run package       # build + dist/lumen-whatsapp.mrbd.zip
```

The `.mrbd.zip` is the contents of `dist/` at the zip root: `index.html`, `manifest.webmanifest`, the
icons, and `assets/`. The manifest `id` is `cloud.bynd.lumen.whatsapp`; reinstalling with the same id keeps
the app's localStorage. `scripts/package-offline.mjs` fails the build if the manifest lacks `id`,
`lumen_config` keys, `lumen_internet: true`, a `version` equal to `package.json`'s, or a square PNG icon
≥ 192 px.

The build targets Chromium 95 (the system WebView) and Firefox 115+ (GeckoView is Firefox 156).

## Tests

```sh
npm test                                          # unit tests (parsing, client, config contract, i18n)
npx playwright install chromium firefox           # once
npm run package && npm run test:e2e               # keyboard-only E2E, Chromium + Firefox, against the mock
```

The E2E suite (`tests/e2e/run.mjs`) serves `dist/` like the Lumen host does, and makes real cross-origin
calls to the mock. It covers:

- the list;
- opening a chat;
- a dictated reply;
- a quoted reply;
- polling, both in the conversation and in the list;
- Back restoring focus;
- Escape on the list left to the platform;
- the Setup, Loading…, network, 401, 404 and invalid-URL screens;
- the cached list on relaunch, with the header spinner until the refresh;
- the conversation rail, the Reply field and Back closing it, and the message menu (reaction and quoted reply);
- the `window.lumen.config` contract (`get` and `onChange`);
- pt-PT;
- the unzipped `.mrbd.zip` with every other origin blocked;
- profile pictures (from `findChats`, from `fetchProfilePictureUrl`, a broken URL keeping the initials, and
  the cache on the next launch), the full-screen photo (View first, Back to the same bubble, failure with
  Try again), voice playback (Chromium; Firefox has no audio output in this sandbox, so a separate test
  checks that Gecko decodes the OGG/Opus note), and reactions as badges, never bubbles;
- demo mode: the capture script key by key, in Chromium, Firefox and the unzipped package, with every
  request outside the app blocked and sentinel "real" data in storage. The test checks that none of that
  data appears on screen and that storage is left unchanged. It also switches demo mode on and off while
  the app is open.

`E2E_TRACE=1` prints the focused element after each key of the capture script.

A smoke test for a real Chromium 95 (Android System WebView version) is in `tests/e2e/chromium95.mjs`; its
header lists the setup.

CI (`.github/workflows/ci.yml`) runs the unit tests, `npm run package`, and the E2E suite. It uploads
the `.mrbd.zip` and the E2E screenshots as artifacts.

Voice notes and transcription (`tests/e2e/fakeAudio.mjs` injects a scripted `window.lumen.audio`, in
Chromium and Firefox):
- recording, Send, Discard, Back and the 2-minute limit (`maxMs: 120000`, `onEnd('max')`);
- the voice note sent to `sendWhatsAppAudio` (base64 OGG, `encoding: true`, checked on the mock);
- the `busy` and `no-phone` errors and Try again;
- the voice menu (Listen, Pause, Transcribe);
- transcription: partials, the kept transcript, an `engine` error and Try again;
- Voice and Transcribe disabled without the API;
- the demo capture script records, sends and transcribes with the simulated API.

Headless browsers do not replace a test on the glasses (GeckoView and WebView, the dictation composer, and
the Back gesture).
