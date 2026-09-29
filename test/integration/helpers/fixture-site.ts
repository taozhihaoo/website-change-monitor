import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface FixtureSite {
  /** Base URL of the local fixture server. */
  baseUrl: string;
  url: string;
  /** Overwrites the served page content. */
  setPage(html: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * A local HTTP server that serves one mutable HTML page. Tests start with
 * fixtures/site-v1.html and can switch the served content to simulate a
 * website change — fully offline, no external requests.
 */
export async function startFixtureSite(): Promise<FixtureSite> {
  const directory = await mkdtemp(join(tmpdir(), 'wcm-fixture-'));
  const initial = await readFile(
    fileURLToPath(new URL('../../../fixtures/site-v1.html', import.meta.url)),
    'utf8',
  );
  const pagePath = join(directory, 'page.html');
  await writeFile(pagePath, initial, 'utf8');

  const server: Server = createServer((req, res) => {
    if ((req.url ?? '/').startsWith('/page.html')) {
      readFile(pagePath)
        .then((body) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500).end();
        });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    url: `${baseUrl}/page.html`,
    async setPage(html: string): Promise<void> {
      await writeFile(pagePath, html, 'utf8');
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function readFixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8');
}
