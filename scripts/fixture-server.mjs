/**
 * Minimal static file server for local fixtures. Used by `npm run demo` and
 * available via `npm run serve:fixture` for manual exploration.
 *
 *   node scripts/fixture-server.mjs [directory] [port]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../fixtures', import.meta.url)),
);
const port = Number.parseInt(process.argv[3] ?? '8931', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const relativePath = url.pathname === '/' ? 'site-v1.html' : url.pathname.replace(/^\/+/, '');
    const filePath = join(directory, relativePath);
    if (!filePath.startsWith(directory)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fixture server: http://127.0.0.1:${port}/ (serving ${directory})`);
});
