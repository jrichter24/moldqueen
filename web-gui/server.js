// moldqueen web-gui — minimal static server. NO framework, NO dependencies:
// just Node's built-in http/fs so it stays light on the Pi. It serves the
// vanilla-JS control panel from ./public. Wiring to java-core (to actually
// drive the excavator) is deliberately TBD and lives behind a future endpoint.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  // Map URL -> file under PUBLIC_DIR, defaulting to index.html. normalize()
  // strips ".." so requests can't escape the public directory.
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, rel === '/' ? 'index.html' : rel);

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`moldqueen web-gui listening on http://${HOST}:${PORT}/`);
});
