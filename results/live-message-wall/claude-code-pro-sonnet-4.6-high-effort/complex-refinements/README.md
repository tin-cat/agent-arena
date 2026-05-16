# Wall

A live, anonymous message wall. Visitors type a message and it appears instantly on the wall for everyone to see. No accounts, no deletions, no replies — just messages flowing left to right.

## Features

- **Real-time** — messages appear on all connected clients instantly via Server-Sent Events
- **Anonymous** — no login, no names, no tracking; only the message text is stored
- **Immutable** — messages cannot be deleted or edited
- **TUI aesthetic** — dark terminal theme, monospace font, minimal ASCII-inspired interface
- **Newspaper flow** — cards fill top-to-bottom then left-to-right, scrolling horizontally as the wall grows
- **Click to expand** — each card shows a preview; clicking it opens a modal with the full text

## Running

```
npm install
npm start
```

Open `http://localhost:3000`. Set `PORT` to override the default.

Messages are stored in memory and are lost when the server restarts.

## Technical structure

```
├── server.js          Node.js/Express HTTP server
├── package.json
└── public/
    └── index.html     Single-page frontend (HTML + CSS + JS, no build step)
```

### Server (`server.js`)

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Serves `public/index.html` |
| `/events` | `GET` | SSE stream — sends `init` batch on connect, then `message` events as they arrive |
| `/messages` | `POST` | Accepts `{ text }` JSON, validates, stores, broadcasts |

Messages are stored as an in-memory array in newest-first order. Each message has `id` (UUID v4), `text`, and `timestamp` (ISO 8601).

**Race-condition handling** — the SSE handler adds the client to the broadcast set *before* sending the initial snapshot. The client deduplicates messages by `id`, so any message that arrives between the subscribe and the snapshot delivery is displayed exactly once.

### Frontend (`public/index.html`)

A single HTML file with no external dependencies.

**Layout** — CSS flexbox column-wrap: `flex-direction: column; flex-wrap: wrap` on a fixed-height container. Cards stack top-to-bottom and overflow into new columns to the right. The outer container uses `overflow-x: auto` for horizontal scrolling.

**Real-time** — `EventSource` connects to `/events`. The `init` event populates the wall on load; subsequent `message` events prepend new cards with a fade-in animation.

**Cards** — fixed size (`27ch × 10.5em`). Text fades out at the bottom with a CSS mask gradient. Clicking opens a modal with the full message.

**Character limit** — 500 characters, enforced on both client and server.
