'use strict';

const joinOverlay = document.getElementById('join-overlay');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');

const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const status = document.getElementById('connection-status');

let socket = null;
let displayName = '';

function setStatus(text, state) {
	status.textContent = text;
	status.className = 'status' + (state ? ' ' + state : '');
}

function setComposerEnabled(enabled) {
	messageInput.disabled = !enabled;
	sendButton.disabled = !enabled;
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
		socket.send(JSON.stringify({ type: 'join', name: displayName }));
	});

	socket.addEventListener('message', (event) => {
		let payload;
		try {
			payload = JSON.parse(event.data);
		} catch {
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
