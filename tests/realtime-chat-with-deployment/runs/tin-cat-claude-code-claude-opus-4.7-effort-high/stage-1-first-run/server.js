'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const HISTORY_LIMIT = 1000;

// In-memory ring of the last HISTORY_LIMIT messages, replayed to new joiners.
const history = [];
let nextId = 1;

function rememberMessage(message) {
	history.push(message);
	if (history.length > HISTORY_LIMIT) {
		history.shift();
	}
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
	const data = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN) {
			client.send(data);
		}
	}
}

function sanitize(value, maxLength) {
	if (typeof value !== 'string') {
		return '';
	}
	return value.trim().slice(0, maxLength);
}

wss.on('connection', (socket) => {
	// A connection is "unnamed" until it sends a valid join.
	socket.displayName = null;

	socket.on('message', (raw) => {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}

		if (parsed.type === 'join') {
			const name = sanitize(parsed.name, 40);
			if (!name) {
				return;
			}
			socket.displayName = name;

			// Replay the recent backlog to this client only.
			socket.send(JSON.stringify({ type: 'history', messages: history }));

			const joined = {
				id: nextId++,
				type: 'system',
				text: `${name} joined the room`,
				ts: Date.now(),
			};
			rememberMessage(joined);
			broadcast(joined);
			return;
		}

		if (parsed.type === 'message') {
			// Ignore chatter from clients that never joined.
			if (!socket.displayName) {
				return;
			}
			const text = sanitize(parsed.text, 2000);
			if (!text) {
				return;
			}
			const message = {
				id: nextId++,
				type: 'message',
				name: socket.displayName,
				text,
				ts: Date.now(),
			};
			rememberMessage(message);
			broadcast(message);
		}
	});

	socket.on('close', () => {
		if (!socket.displayName) {
			return;
		}
		const left = {
			id: nextId++,
			type: 'system',
			text: `${socket.displayName} left the room`,
			ts: Date.now(),
		};
		rememberMessage(left);
		broadcast(left);
	});
});

server.listen(PORT, () => {
	console.log(`Chat server listening on http://localhost:${PORT}`);
});
