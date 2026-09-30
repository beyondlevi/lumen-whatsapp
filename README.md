# lumen-whatsapp

WhatsApp client for **Rokid Lumen** glasses, built as a Meta Ray-Ban Display (MRBD) web app with the official
[UI Toolkit for Meta Ray-Ban Display](https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web) and
backed by an [Evolution API v2](https://github.com/EvolutionAPI/evolution-api) server. The screens follow the
toolkit's messaging example (`examples/messaging`).

- **Chats**: name, preview, and time for the 40 most recent chats. Unread chats have an unread dot on the
  avatar and an accent-colored time.
- **Conversation**: the 30 most recent messages. Voice notes, photos, videos, stickers, documents,
  locations, contacts, polls, and reactions show only a marker (“Audio”, “Photo”, “Reaction 👍”…).
- **Reply**: a normal `<textarea>` (the toolkit's `InputTextView`). On the glasses, Enter on the field
  opens the platform's dictation composer, and the text arrives through `input`/`change` events. Right
  then moves to Send. Enter on a message bubble quotes that message in the reply.

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
| Conversation | (on open) | Focus is on the reply field |
| Conversation | Up / Down | Move between the field and the message bubbles (scrolls history) |
| Conversation | Enter on the field | On the glasses: opens the platform's dictation composer. In a desktop browser: sends the text (UI Toolkit `InputTextView` behavior) |
| Conversation | Right from the field, then Enter | Send (the path to use on the glasses after dictating) |
| Conversation | Enter on a bubble | Reply quoting that message (Enter again cancels) |
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
  {"key": "evolution.apiKey", "label": "API key", "type": "secret"}
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

### Development fallback

When `window.lumen` does not exist (a regular browser), the app reads
`?evolution.url=…&evolution.instance=…&evolution.apiKey=…` and stores the values in localStorage under
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
| `POST /chat/markMessageAsRead/{instance}` | `{"readMessages": [{"id", "fromMe": false, "remoteJid"}]}` (up to 30) | 201; failures are ignored |

`status@broadcast`, `@broadcast` and `@newsletter` chats are hidden.

### Errors

| Condition | Screen |
|---|---|
| `fetch` rejects (offline, DNS, TLS, timeout, **CORS**) | “Can't reach the server” |
| 401 / 403 | “API key rejected” |
| 404 | “Instance not found”. Evolution checks the instance before the key, so a wrong instance gives 404 even with a bad key |
| Other statuses, e.g. 503 `LICENSE_REQUIRED` on 2.4 | “Server error” |

The phone's internet can take 5–15 s to come up after launch. On the first load, network failures are
retried every 3 s for up to 30 s while the app shows **Connecting…**. Only after that does it show the
network error.

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
- **Media is not shown:** no media is downloaded or played; messages show only their marker.

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
`lumen_config` keys, `lumen_internet: true`, or a square PNG icon ≥ 192 px.

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
- the Setup, Connecting…, network, 401, 404 and invalid-URL screens;
- the `window.lumen.config` contract (`get` and `onChange`);
- pt-PT;
- the unzipped `.mrbd.zip` with every other origin blocked.

A smoke test for a real Chromium 95 (Android System WebView version) is in `tests/e2e/chromium95.mjs`; its
header lists the setup.

CI (`.github/workflows/ci.yml`) runs the unit tests, `npm run package`, and the E2E suite. It uploads
the `.mrbd.zip` and the E2E screenshots as artifacts.

Headless browsers do not replace a test on the glasses (GeckoView and WebView, the dictation composer, and
the Back gesture).
