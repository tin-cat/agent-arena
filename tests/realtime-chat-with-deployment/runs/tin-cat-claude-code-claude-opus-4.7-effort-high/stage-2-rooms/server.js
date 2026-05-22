'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');

// How many messages to keep (and replay) per room.
const HISTORY_LIMIT = 200;
const DEFAULT_ROOM = 'lobby';
const ROOM_MAX = 40;

// --- Persistence -----------------------------------------------------------
// Chat messages live in SQLite so history survives a restart. System notices
// (joins/leaves) are live presence only and are never stored.
const db = new DatabaseSync(DB_PATH);
db.exec(`
	CREATE TABLE IF NOT EXISTS messages (
		id   INTEGER PRIMARY KEY AUTOINCREMENT,
		room TEXT    NOT NULL,
		name TEXT    NOT NULL,
		text TEXT    NOT NULL,
		ts   INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room, id);
`);

const insertMessage = db.prepare(
	'INSERT INTO messages (room, name, text, ts) VALUES (?, ?, ?, ?)'
);
// Keep only the newest HISTORY_LIMIT rows in a room; drop anything older.
const pruneRoom = db.prepare(`
	DELETE FROM messages
	WHERE room = ?
	  AND id NOT IN (
	      SELECT id FROM messages WHERE room = ? ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
	  )
`);
const selectHistory = db.prepare(`
	SELECT id, name, text, ts FROM (
		SELECT id, name, text, ts FROM messages WHERE room = ? ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
	) ORDER BY id ASC
`);

// Persist a chat message and return the row it became.
function saveMessage(room, name, text, ts) {
	const { lastInsertRowid } = insertMessage.run(room, name, text, ts);
	pruneRoom.run(room, room);
	return { id: Number(lastInsertRowid), type: 'message', room, name, text, ts };
}

// Recent backlog for a room, oldest first.
function loadHistory(room) {
	return selectHistory.all(room).map((row) => ({ ...row, type: 'message', room }));
}

// --- HTTP + WebSocket ------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Send a payload to every connected client currently in `room`.
function broadcast(room, payload) {
	const data = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client.readyState === client.OPEN && client.room === room) {
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

// Rooms are slugs: lowercase, [a-z0-9-], so the URL hash and the room key agree.
function normalizeRoom(value) {
	if (typeof value !== 'string') {
		return DEFAULT_ROOM;
	}
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, ROOM_MAX);
	return slug || DEFAULT_ROOM;
}

function systemNotice(room, text) {
	return { type: 'system', room, text, ts: Date.now() };
}

// Replay a room's backlog to one client and announce its arrival to the room.
function enterRoom(socket, room) {
	socket.room = room;
	socket.send(JSON.stringify({ type: 'history', room, messages: loadHistory(room) }));
	broadcast(room, systemNotice(room, `${socket.displayName} joined the room`));
}

wss.on('connection', (socket) => {
	// A connection is "unnamed" until it sends a valid join.
	socket.displayName = null;
	socket.room = null;

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
			enterRoom(socket, normalizeRoom(parsed.room));
			return;
		}

		// Move an already-joined client to a different room without reconnecting.
		if (parsed.type === 'switch') {
			if (!socket.displayName) {
				return;
			}
			const room = normalizeRoom(parsed.room);
			if (room === socket.room) {
				return;
			}
			broadcast(socket.room, systemNotice(socket.room, `${socket.displayName} left the room`));
			enterRoom(socket, room);
			return;
		}

		if (parsed.type === 'message') {
			// Ignore chatter from clients that never joined a room.
			if (!socket.displayName || !socket.room) {
				return;
			}
			const text = sanitize(parsed.text, 2000);
			if (!text) {
				return;
			}
			const message = saveMessage(socket.room, socket.displayName, text, Date.now());
			broadcast(socket.room, message);
		}
	});

	socket.on('close', () => {
		if (!socket.displayName || !socket.room) {
			return;
		}
		broadcast(socket.room, systemNotice(socket.room, `${socket.displayName} left the room`));
	});
});

server.listen(PORT, () => {
	console.log(`Chat server listening on http://localhost:${PORT}`);
});
