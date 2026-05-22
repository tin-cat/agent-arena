'use strict';

const joinOverlay = document.getElementById('join-overlay');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const joinRoomLabel = document.getElementById('join-room');

const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const status = document.getElementById('connection-status');
const roomNameLabel = document.getElementById('room-name');
const roomSwitch = document.getElementById('room-switch');

const DEFAULT_ROOM = 'lobby';

let socket = null;
let displayName = '';
let currentRoom = DEFAULT_ROOM;

// Mirror the server's slug rules so the hash, header, and stored room agree.
function normalizeRoom(value) {
	if (typeof value !== 'string') {
		return DEFAULT_ROOM;
	}
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || DEFAULT_ROOM;
}

// The room is whatever the URL hash names (#general → "general").
function roomFromHash() {
	return normalizeRoom(decodeURIComponent(location.hash.replace(/^#/, '')));
}

function setStatus(text, state) {
	status.textContent = text;
	status.className = 'status' + (state ? ' ' + state : '');
}

function setComposerEnabled(enabled) {
	messageInput.disabled = !enabled;
	sendButton.disabled = !enabled;
}

function showRoom(room) {
	roomNameLabel.textContent = room;
	joinRoomLabel.textContent = room;
	document.title = `#${room} · Chat`;
}

// True when the list is scrolled (near) the bottom, so we only auto-scroll
// when the user is already following the live conversation.
function isAtBottom() {
	const threshold = 60;
	return messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
}

function scrollToBottom() {
	messages.scrollTop = messages.scrollHeight;
}

function formatTime(ts) {
	return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(message) {
	const li = document.createElement('li');

	if (message.type === 'system') {
		li.className = 'system';
		li.textContent = message.text;
		return li;
	}

	li.className = 'message' + (message.name === displayName ? ' own' : '');

	const meta = document.createElement('div');
	meta.className = 'meta';

	const author = document.createElement('span');
	author.className = 'author';
	author.textContent = message.name;

	const time = document.createElement('span');
	time.className = 'time';
	time.textContent = formatTime(message.ts);

	meta.append(author, time);

	// textContent keeps user input inert — no HTML injection.
	const text = document.createElement('div');
	text.className = 'text';
	text.textContent = message.text;

	li.append(meta, text);
	return li;
}

function appendMessage(message) {
	const stick = isAtBottom();
	messages.append(renderMessage(message));
	if (stick) {
		scrollToBottom();
	}
}

function connect() {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	socket = new WebSocket(`${protocol}//${location.host}`);

	socket.addEventListener('open', () => {
		setStatus('online', 'online');
		setComposerEnabled(true);
		socket.send(JSON.stringify({ type: 'join', name: displayName, room: currentRoom }));
	});

	socket.addEventListener('message', (event) => {
		let payload;
		try {
			payload = JSON.parse(event.data);
		} catch {
			return;
		}

		// Ignore anything addressed to a room we've already left (switch races).
		if (payload.room && payload.room !== currentRoom) {
			return;
		}

		if (payload.type === 'history') {
			messages.innerHTML = '';
			for (const message of payload.messages) {
				messages.append(renderMessage(message));
			}
			scrollToBottom();
			return;
		}

		appendMessage(payload);
	});

	socket.addEventListener('close', () => {
		setStatus('disconnected — reconnecting…', 'offline');
		setComposerEnabled(false);
		setTimeout(connect, 2000);
	});

	socket.addEventListener('error', () => {
		socket.close();
	});
}

// Switch to the room named in the hash, without reloading the page.
function switchRoom(room) {
	if (room === currentRoom) {
		return;
	}
	currentRoom = room;
	showRoom(room);
	messages.innerHTML = '';
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({ type: 'switch', room }));
	}
}

joinForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const name = nameInput.value.trim();
	if (!name) {
		return;
	}
	displayName = name;
	joinOverlay.classList.add('hidden');
	chat.classList.remove('hidden');
	messageInput.focus();
	connect();
});

messageForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const text = messageInput.value.trim();
	if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
		return;
	}
	socket.send(JSON.stringify({ type: 'message', text }));
	messageInput.value = '';
	messageInput.focus();
});

// Clicking the room name prompts for another room; we route through the hash so
// that the hashchange handler is the single place that performs the switch.
roomSwitch.addEventListener('click', () => {
	const next = prompt('Switch to room:', currentRoom);
	if (next === null) {
		return;
	}
	const room = normalizeRoom(next);
	if (`#${room}` === location.hash) {
		switchRoom(room); // Hash unchanged (e.g. re-entered same slug); switch directly.
	} else {
		location.hash = room;
	}
});

window.addEventListener('hashchange', () => {
	switchRoom(roomFromHash());
});

// Normalize the initial hash so the address bar matches the room we joined.
currentRoom = roomFromHash();
if (location.hash !== `#${currentRoom}`) {
	location.hash = currentRoom;
}
showRoom(currentRoom);
