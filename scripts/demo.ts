/**
 * Offline demo: exercises the complete monitoring pipeline against a local
 * fixture page — no API keys, no SMTP, no internet access required.
 *
 *   npm run demo
 *
 * Flow: serve v1 fixture → baseline → unchanged → switch fixture to v2
 * → changed + change event + (mock) notification → unchanged again
 * (idempotency: no duplicate event or notification).
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { createRepositories } from '../src/repositories/index.js';
import { BrowserManager } from '../src/browser/browser-manager.js';
import { ExtractionService } from '../src/services/extraction-service.js';
import { MonitorService } from '../src/services/monitor-service.js';
import { CheckService } from '../src/services/check-service.js';
import { WebhookNotifier } from '../src/notifications/webhook-notifier.js';

import { NotificationService } from '../src/notifications/notification-service.js';
import type { NotificationProvider } from '../src/notifications/provider.js';

const DATA_DIR = 'data';
const DEMO_DB_PATH = join(DATA_DIR, 'demo.db');

function banner(text: string): void {
  console.log(`\n\x1b[1m=== ${text} ===\x1b[0m`);
}

async function startDemoSite(): Promise<{ url: string; pagePath: string; close: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'wcm-demo-'));
  const pagePath = join(directory, 'page.html');
  await writeFile(
    pagePath,
    await readFile(
      fileURLToPath(new URL('../fixtures/site-v1.html', import.meta.url)),
      'utf8',
    ),
    'utf8',
  );
  const server: Server = createServer((req, res) => {
    readFile(pagePath)
      .then((body) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/page.html`,
    pagePath,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  banner('Website Change Monitor — offline demo');
  console.log('Serving a local fixture page (no internet needed).');

  const config = {
    ...loadConfig({}),
    allowPrivateTargets: true, // demo targets 127.0.0.1 on purpose
    extractionSettleMs: 50,
    defaultTimeoutMs: 15_000,
  };
  const logger = createLogger('warn');

  const site = await startDemoSite();
  const db = openDatabase(DEMO_DB_PATH);
  migrate(db, (info) => console.log(`migration applied: v${info.version} (${info.name})`));
  const repos = createRepositories(db);
  const urlGuardOptions = { allowPrivateTargets: config.allowPrivateTargets };

  const browserManager = new BrowserManager({ headless: true }, logger);
  const extraction = new ExtractionService(browserManager, logger, urlGuardOptions);
  const monitorService = new MonitorService({
    monitorRepo: repos.monitors,
    extraction,
    urlGuardOptions,
    clock: { now: () => new Date() },
    logger,
    defaultTimeoutMs: config.defaultTimeoutMs,
    defaultSettleMs: config.extractionSettleMs,
  });

  const mockPayloads: unknown[] = [];
  const demoMock: NotificationProvider = {
    name: 'mock',
    send: async (payload) => {
      mockPayloads.push(payload);
    },
  };
  const notificationService = new NotificationService({
    providers: new Map<string, NotificationProvider>([
      ['webhook', new WebhookNotifier({ timeoutMs: 3_000, urlGuardOptions })],
      ['mock', demoMock],
    ]),
    deliveryRepo: repos.deliveries,
    clock: { now: () => new Date() },
    logger,
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    urlGuardOptions,
    defaultProvider: 'mock',
  });

  const checkService = new CheckService({
    monitorRepo: repos.monitors,
    snapshotRepo: repos.snapshots,
    changeEventRepo: repos.changeEvents,
    checkRunRepo: repos.checkRuns,
    extraction,
    notifications: notificationService,
    urlGuardOptions,
    clock: { now: () => new Date() },
    logger,
    defaultTimeoutMs: config.defaultTimeoutMs,
    defaultSettleMs: config.extractionSettleMs,
  });

  const monitor = await monitorService.create({
    name: 'Demo: Acme product price',
    url: site.url,
    selector: '.product-price',
    selectorType: 'css',
    checkIntervalSeconds: 300,
    enabled: true,
    webhookUrl: null,
  });
  console.log(
    `Monitor created:\n  id        ${monitor.id}\n  url       ${monitor.url}\n  selector  css ${monitor.selector}`,
  );

  const run = async (label: string): Promise<void> => {
    const outcome = await checkService.runCheck(monitor, 'manual');
    if (outcome.notification !== null) {
      await outcome.notification;
    }
    const lines = [
      `  status      ${outcome.run.status}`,
      `  duration    ${outcome.run.durationMs} ms`,
      `  content     ${JSON.stringify(repos.snapshots.latestByMonitor(monitor.id)?.content ?? '')}`,
    ];
    if (outcome.changeEvent !== null) {
      lines.push(
        `  change      ${outcome.changeEvent.previousContent} → ${outcome.changeEvent.currentContent}`,
        `  diff        +${outcome.changeEvent.diff.added} / −${outcome.changeEvent.diff.removed}`,
      );
    }
    console.log(`${label}\n${lines.join('\n')}`);
  };

  banner('Check #1 — first run');
  await run('Creating the baseline…');

  banner('Check #2 — nothing changed');
  await run('Comparing against the baseline…');

  banner('The page changes: $99 → $89 (+ a new feature line)');
  await writeFile(
    site.pagePath,
    await readFile(fileURLToPath(new URL('../fixtures/site-v2.html', import.meta.url)), 'utf8'),
    'utf8',
  );

  banner('Check #3 — change detected');
  await run('Comparing against the previous snapshot…');

  banner('Check #4 — same content again (idempotency)');
  await run('No duplicate event or notification is produced…');

  banner('Results');
  const events = repos.changeEvents.listByMonitor(monitor.id, 10);
  const runs = repos.checkRuns.listByMonitor(monitor.id, 10);
  const deliveries = repos.deliveries.listByMonitor(monitor.id, 10);
  console.log(
    [
      `  check runs          ${runs.length} → ${runs.map((r) => r.status).join(', ')}`,
      `  change events       ${events.length}`,
      `  notifications       ${deliveries.length} → ${deliveries.map((d) => `${d.provider}:${d.status}`).join(', ')}`,
      `  mock payloads       ${mockPayloads.length}`,
    ].join('\n'),
  );
  const payload = mockPayloads[0] as Record<string, unknown> | undefined;
  if (payload !== undefined) {
    console.log('\nWebhook payload shape (delivered by the mock provider):');
    console.log(JSON.stringify({ ...payload, monitor_id: '…', url: '…' }, null, 2));
  }
  console.log(`\nSQLite database written to ${DEMO_DB_PATH} — inspect it with:\n  npm exec --  better-sqlite3 ${DEMO_DB_PATH} "select status, error_code from check_runs"`);

  banner('Demo complete');
  await browserManager.close();
  db.close();
  await site.close();
}

main().catch((err) => {
  console.error('demo failed:', err);
  process.exitCode = 1;
});
