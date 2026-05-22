# Real-Time Chat

A minimal real-time chat app with named rooms. Open the page, pick a display
name, and you join the room named in the URL hash (`#general`). Every message is
broadcast instantly over WebSockets to the other people in that same room, and
the most recent 200 messages per room are kept in a SQLite file so the history
survives a server restart and is replayed to anyone who joins later.

## What this is about

This is a deliberately small, dependency-light chat app meant to be easy to read
and run. There are no accounts. Rooms are just slugs in the URL hash, so
`/#general` and `/#random` are separate conversations; changing the hash (or
clicking the room name in the header) moves you between them without reloading
the page. The default room, when no hash is given, is `lobby`.

Messages persist to a local SQLite database (`chat.db`) through Node's built-in
`node:sqlite` module, so no extra dependency is needed and history is not lost
when the server restarts.

## Tech stack

- **Node.js** (>= 22.5) as the runtime. The built-in `node:sqlite` module (used
  for persistence) is only available from 22.5 onward, and is still flagged
  experimental — `npm start` passes `--experimental-sqlite` for you.
- **Express** serves the static client files.
- **ws** provides the WebSocket server, attached to the same HTTP server Express
  runs on (so one port serves both the page and the socket).
- **SQLite** (`node:sqlite`, no dependency) stores message history per room.
- **Vanilla HTML/CSS/JavaScript** on the client — no build step, no framework.

## Code structure

```
.
├── server.js           # Express static server + WebSocket server + SQLite history
├── package.json        # Dependencies and the `start` script
├── chat.db             # SQLite message store (created on first run; gitignored)
└── public/             # The web client (served as static files)
    ├── index.html      # Page shell: name prompt, room header, message list, composer
    ├── styles.css      # Full-screen chatroom layout and theme
    └── client.js       # WebSocket connection, room/hash handling, rendering
```

### How it works

- On startup, `server.js` opens (or creates) the SQLite database, serves
  everything under `public/`, and opens a WebSocket server on the same port.
- The client reads the room from the URL hash (defaulting to `lobby`), then sends
  a `join` message with the chosen display name and that room.
- The server replays the room's stored history (up to 200 messages) to that
  client only, then broadcasts a `"… joined the room"` notice to that room.
- When a client sends a `message`, the server stamps it with the sender's name
  and a timestamp, inserts it into SQLite (pruning that room back to its newest
  200 rows), and broadcasts it to everyone in the same room.
- Changing the URL hash (or clicking the room name) sends a `switch` message: the
  server announces the departure to the old room, then replays history and
  announces arrival in the new one — all over the same connection.
- On disconnect, a `"… left the room"` notice is broadcast to the client's room.

Join/leave notices are live presence only and are not stored; only chat messages
are persisted. All message text is rendered with `textContent` on the client, so
user input is never interpreted as HTML.

### Message protocol

Messages are JSON sent over the WebSocket. Rooms are slugs (`[a-z0-9-]`); the
server normalizes whatever it receives, so the client and server always agree.

Client → server:

```jsonc
{ "type": "join", "name": "Ada", "room": "general" }
{ "type": "switch", "room": "random" }
{ "type": "message", "text": "Hello, everyone!" }
```

Server → client (every payload carries the `room` it belongs to):

```jsonc
{ "type": "history", "room": "general", "messages": [ /* recent messages */ ] }
{ "type": "message", "id": 7, "room": "general", "name": "Ada", "text": "Hi", "ts": 1700000000000 }
{ "type": "system", "room": "general", "text": "Ada joined the room", "ts": 1700000000000 }
```

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000> in a couple of browser tabs (or on different
devices on your network) and watch messages broadcast between them. Add a hash
to pick a room, e.g. <http://localhost:3000/#general>; tabs sharing a hash share
a conversation.

The port and the database location are configurable with environment variables:

```bash
PORT=8080 DB_PATH=/var/data/chat.db npm start
```

## Contributing

1. Fork and clone the repository.
2. `npm install` to pull dependencies.
3. `npm start` and develop against <http://localhost:3000>.

Some ideas worth adding: typing indicators, an online-user list per room, a
room directory, or message rate limiting. Keep the client dependency-free where
reasonable, and keep `server.js` readable — the project's value is in being a
small, complete example.
