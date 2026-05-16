const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_LEN = 500;

const messages = [];
const clients = new Set();

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {}
  };

  // Add to clients first so we don't miss a message between init and subscribe.
  // The client deduplicates by id.
  clients.add(send);
  send({ type: 'init', messages: [...messages] });

  req.on('close', () => clients.delete(send));
});

app.post('/messages', (req, res) => {
  const body = req.body ?? {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (text.length === 0) {
    return res.status(400).json({ error: 'Message text is required.' });
  }
  if (text.length > MAX_LEN) {
    return res.status(400).json({ error: `Max ${MAX_LEN} characters.` });
  }

  const msg = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
  };

  messages.unshift(msg);

  for (const send of clients) {
    send({ type: 'message', ...msg });
  }

  res.status(201).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Wall running at http://localhost:${PORT}`);
});
