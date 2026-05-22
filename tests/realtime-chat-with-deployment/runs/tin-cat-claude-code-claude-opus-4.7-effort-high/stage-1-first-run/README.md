# Real-Time Chat

A minimal real-time chat app. Open the page, pick a display name, and you join a
single shared room. Every message is broadcast to all connected clients
instantly over WebSockets, and the most recent 1000 messages are kept in memory
so that anyone who joins later sees the recent backlog replayed to them.

## What this is about

This is a deliberately small, dependency-light chat room meant to be easy to
read and run. There are no accounts, no database, and no rooms beyond the one
shared room. State lives in memory, so it resets whenever the server restarts.

## Tech stack

- **Node.js** (>= 18) as the runtime.
- **Express** serves the static client files.
- **ws** provides the WebSocket server, attached to the same HTTP server Express
  runs on (so one port serves both the page and the socket).
- **Vanilla HTML/CSS/JavaScript** on the client — no build step, no framework.

## Code structure

```
.
├── server.js           # Express static server + WebSocket server + message history
├── package.json        # Dependencies and the `start` script
└── public/             # The web client (served as static files)
    ├── index.html      # Page shell: name prompt, message list, composer
    ├── styles.css      # Full-screen chatroom layout and theme
    └── client.js       # WebSocket connection, rendering, send/receive logic
```

### How it works

- On startup, `server.js` serves everything under `public/` and opens a
  WebSocket server on the same port.
- The client connects, then sends a `join` message with the chosen display name.
- The server replays its in-memory `history` (up to 1000 messages) to that
  client only, then broadcasts a `"… joined the room"` system notice to everyone.
- When a client sends a `message`, the server stamps it with the sender's name
  and a timestamp, stores it in `history` (dropping the oldest once past 1000),
  and broadcasts it to all connected clients.
- On disconnect, a `"… left the room"` system notice is broadcast.

All message text is rendered with `textContent` on the client, so user input is
never interpreted as HTML.

### Message protocol

Messages are JSON sent over the WebSocket.

Client → server:

```jsonc
{ "type": "join", "name": "Ada" }
{ "type": "message", "text": "Hello, everyone!" }
```

Server → client:

```jsonc
{ "type": "history", "messages": [ /* recent message objects */ ] }
{ "type": "message", "id": 7, "name": "Ada", "text": "Hi", "ts": 1700000000000 }
{ "type": "system", "id": 8, "text": "Ada joined the room", "ts": 1700000000000 }
```

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000> in a couple of browser tabs (or on different
devices on your network) and watch messages broadcast between them.

The port is configurable with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Contributing

1. Fork and clone the repository.
2. `npm install` to pull dependencies.
3. `npm start` and develop against <http://localhost:3000>.

Some ideas worth adding: persisting history to a database, multiple named rooms,
typing indicators, an online-user list, or message rate limiting. Keep the
client dependency-free where reasonable, and keep `server.js` readable — the
project's value is in being a small, complete example.
