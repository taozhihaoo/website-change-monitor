/**
 * Phase 2 end-to-end verification against a REAL built server.
 * Covers: baseline/unchanged/changed, A→B→A and A→B→A→B semantics,
 * webhook deliveries, snapshot retention, test-extraction isolation,
 * clean API errors. Run: node scripts/e2e-verify.mjs
 */
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PAGE = join(ROOT, 'data', 'e2e-page.html');
const DB_PATH = join(ROOT, 'data', 'e2e.db');
const PORT = 3101;
const HOOK_PORT = 8933;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // clean state
  await rm(DB_PATH, { force: true });
  await rm(`${DB_PATH}-wal`, { force: true });
  await rm(`${DB_PATH}-shm`, { force: true });
  await writeFile(FIXTURE_PAGE, await readFile(join(ROOT, 'fixtures', 'site-v1.html'), 'utf8'));

  // fixture site + webhook receiver
  const fixture = createServer((req, res) => {
    readFile(FIXTURE_PAGE).then(
      (body) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(body);
      },
      () => res.writeHead(500).end(),
    );
  });
  const hookLog = [];
  const hook = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hookLog.push(JSON.parse(body));
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((r) => fixture.listen(8934, '127.0.0.1', r));
  await new Promise((r) => hook.listen(HOOK_PORT, '127.0.0.1', r));
  const fixtureUrl = 'http://127.0.0.1:8934/page.html';

  // real built server (dist/index.js), retention set low to prove pruning
  const server = spawn('node', ['dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PORT: String(PORT),
      DB_PATH: 'data/e2e.db',
      LOG_LEVEL: 'error',
      ALLOW_PRIVATE_TARGETS: 'true',
      DEFAULT_NOTIFICATION_PROVIDER: 'none',
      MAX_SNAPSHOTS_PER_MONITOR: '3',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await sleep(2500);

  try {
    const api = async (method, path, payload) => {
      const res = await fetch(BASE + path, {
        method,
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, body };
    };

    const health = await api('GET', '/health');
    check('server /health', health.status === 200 && health.body.status === 'ok');

    const created = await api('POST', '/monitors', {
      name: 'E2E price watcher',
      url: fixtureUrl,
      selector: '.product-price',
      selector_type: 'css',
      check_interval_seconds: 300,
      webhook_url: `http://127.0.0.1:${HOOK_PORT}/hook?secret=e2e-token`,
    });
    check('create monitor', created.status === 201);
    const id = created.body.monitor.id;

    const run = async () => {
      const response = await api('POST', `/monitors/${id}/run?wait=1`);
      if (response.body === null || response.body.run === undefined) {
        throw new Error(`run returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
      }
      return response.body;
    };
    const changeCount = async () =>
      (await api('GET', `/monitors/${id}/changes?limit=50`)).body.changes.length;

    let outcome = await run();
    check('baseline run', outcome.run.status === 'baseline' && outcome.change_event === null);
    outcome = await run();
    check('unchanged run', outcome.run.status === 'unchanged' && outcome.change_event === null);

    await writeFile(FIXTURE_PAGE, await readFile(join(ROOT, 'fixtures', 'site-v2.html'), 'utf8'));
    outcome = await run();
    check('A→B changed', outcome.run.status === 'changed' && outcome.change_event !== null);
    check(
      'diff $99→$89',
      outcome.change_event?.previous_content === '$99' &&
        outcome.change_event?.current_content === '$89',
    );
    await sleep(300);
    check(
      'webhook #1 received',
      hookLog.length === 1 &&
        hookLog[0].event === 'content_changed' &&
        hookLog[0].monitor_id === id,
    );
    outcome = await run();
    await sleep(200);
    check(
      'no duplicate webhook on unchanged',
      outcome.run.status === 'unchanged' && hookLog.length === 1,
    );

    // B→A (revert) — a real change under Phase 2 semantics
    await writeFile(FIXTURE_PAGE, await readFile(join(ROOT, 'fixtures', 'site-v1.html'), 'utf8'));
    outcome = await run();
    await sleep(300);
    check(
      'B→A is a real change',
      outcome.run.status === 'changed' && outcome.change_event?.current_content === '$99',
    );
    check('webhook #2 received', hookLog.length === 2);

    // A→B again — yet another new event + webhook
    await writeFile(FIXTURE_PAGE, await readFile(join(ROOT, 'fixtures', 'site-v2.html'), 'utf8'));
    outcome = await run();
    await sleep(300);
    check('A→B again is a new change', outcome.run.status === 'changed' && outcome.change_event !== null);
    check('webhook #3 received (3 total)', hookLog.length === 3);
    check('three change events recorded', (await changeCount()) === 3);

    const changes = (await api('GET', `/monitors/${id}/changes?limit=50`)).body.changes;
    const deliveries = changes.flatMap((c) => c.deliveries);
    check(
      'delivery rows sent (3)',
      deliveries.length === 3 && deliveries.every((d) => d.status === 'sent'),
    );
    check(
      'API masks webhook target',
      changes.some((c) =>
        c.deliveries.some((d) => d.target === `http://127.0.0.1:${HOOK_PORT}/…`),
      ),
    );

    const db = new Database(DB_PATH, { readonly: true });
    const dbTarget = db.prepare('SELECT target FROM notification_deliveries LIMIT 1').get();
    check(
      'DB stores full webhook endpoint',
      dbTarget.target === `http://127.0.0.1:${HOOK_PORT}/hook?secret=e2e-token`,
    );
    const snapCount = db
      .prepare('SELECT COUNT(*) AS c FROM snapshots WHERE monitor_id = ?')
      .get(id).c;
    check('snapshot retention (3)', snapCount === 3, `got ${snapCount}`);
    const eventCount = db
      .prepare('SELECT COUNT(*) AS c FROM change_events WHERE monitor_id = ?')
      .get(id).c;
    check('change events untouched by retention', eventCount === 3);
    db.close();

    const countAll = () => {
      const d = new Database(DB_PATH, { readonly: true });
      const row = {
        s: d.prepare('SELECT COUNT(*) AS c FROM snapshots').get().c,
        e: d.prepare('SELECT COUNT(*) AS c FROM change_events').get().c,
        r: d.prepare('SELECT COUNT(*) AS c FROM check_runs').get().c,
      };
      d.close();
      return row;
    };
    const before = countAll();
    const testExtraction = await api('POST', '/monitors/test-extraction', {
      url: fixtureUrl,
      selector: '.product-stock',
      selector_type: 'css',
    });
    check(
      'test-extraction works',
      testExtraction.status === 200 && testExtraction.body.content.includes('limited quantity'),
    );
    const after = countAll();
    check(
      'test-extraction persists nothing',
      JSON.stringify(before) === JSON.stringify(after),
      JSON.stringify({ before, after }),
    );

    const notFound = await api('GET', '/monitors/74a3e33f-1c58-4a1e-a6d3-9f7e2c11b000');
    const invalid = await api('POST', '/monitors', { name: '', url: 'nope', selector: '' });
    const errText = JSON.stringify(notFound) + JSON.stringify(invalid);
    check(
      '404 clean envelope',
      notFound.status === 404 && notFound.body.error.code === 'MONITOR_NOT_FOUND',
    );
    check('400 validation clean', invalid.status === 400 && invalid.body.error.code === 'VALIDATION_ERROR');
    check('no stack traces leaked', !errText.includes(' at ') && !errText.includes('stack'));

    const runs = (await api('GET', `/monitors/${id}/runs?limit=50`)).body.runs;
    check('check history complete (6 runs)', runs.length === 6);
    // chronological: baseline, unchanged, changed(A→B), unchanged, changed(B→A), changed(A→B)
    const expected = ['changed', 'changed', 'unchanged', 'changed', 'unchanged', 'baseline'];
    check(
      'run statuses correct (newest first)',
      runs.map((r) => r.status).join(',') === expected.join(','),
    );

    const sched = await api('GET', '/scheduler/status');
    check(
      'scheduler status endpoint',
      sched.status === 200 && typeof sched.body.active_checks === 'number',
    );
  } finally {
    server.kill();
    fixture.close();
    hook.close();
    await sleep(500);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== E2E: ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('E2E failed:', err);
  process.exitCode = 1;
});
