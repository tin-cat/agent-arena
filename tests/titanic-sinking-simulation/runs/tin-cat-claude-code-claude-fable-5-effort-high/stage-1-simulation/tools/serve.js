// Minimal static file server so the ES modules load (file:// blocks them).
// Usage: npm start  ->  http://localhost:8000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.PORT || 8000);
const mime = {
	'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
	'.svg': 'image/svg+xml', '.map': 'application/json',
};

const server = createServer(async (req, res) => {
	try {
		let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (path === '/') path = '/index.html';
		const file = normalize(join(root, path));
		if (!file.startsWith(normalize(root))) throw new Error('outside root');
		const data = await readFile(file);
		res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end('not found');
	}
});

function listen(p, triesLeft) {
	server.once('error', err => {
		if (err.code === 'EADDRINUSE' && triesLeft > 0) {
			console.log(`port ${p} is in use, trying ${p + 1}...`);
			listen(p + 1, triesLeft - 1);
		} else {
			throw err;
		}
	});
	server.listen(p, () => {
		console.log(`Titanic simulation: http://localhost:${p}`);
	});
}
listen(port, 10);
