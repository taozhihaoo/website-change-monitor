import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../src/db/database.js';
import { migrate } from '../../../src/db/migrate.js';
import { createRepositories, type Repositories } from '../../../src/repositories/index.js';
import { BrowserManager } from '../../../src/browser/browser-manager.js';
import { ExtractionService } from '../../../src/services/extraction-service.js';
import { MonitorService } from '../../../src/services/monitor-service.js';
import { CheckService } from '../../../src/services/check-service.js';
import { WebhookNotifier } from '../../../src/notifications/webhook-notifier.js';

import { NotificationService } from '../../../src/notifications/notification-service.js';
import type { NotificationProvider } from '../../../src/notifications/provider.js';
import { BoundedQueue } from '../../../src/scheduler/queue.js';
import { Scheduler } from '../../../src/scheduler/scheduler.js';
import { buildApp } from '../../../src/api/app.js';
import type { FastifyInstance } from 'fastify';
import { createLogger, type Logger } from '../../../src/utils/logger.js';
import { MutableClock, type StackOptions } from '../../helpers/test-stack.js';

export interface RealStack {
  db: Db;
  repos: Repositories;
  logger: Logger;
  browserManager: BrowserManager;
  extraction: ExtractionService;
  monitorService: MonitorService;
  checkService: CheckService;
  notificationService: NotificationService;
  scheduler: Scheduler;
  queue: BoundedQueue;
  app: FastifyInstance;
  clock: MutableClock;
  mockPayloads: ReturnType<typeof trackMock>;
  dataDir: string;
  close(): Promise<void>;
}

function trackMock(logger: Logger): { payloads: unknown[]; provider: NotificationProvider } {
  const payloads: unknown[] = [];
  return {
    payloads,
    provider: {
      name: 'mock',
      send: async (payload) => {
        payloads.push(payload);
        logger.debug({ event: payload.event }, 'mock notification (test)');
      },
    },
  };
}

/**
 * The REAL application stack — real BrowserManager + Playwright extraction,
 * real SQLite (temp file), real Fastify app (via inject()) — pointed at local
 * fixture pages only. Used by integration tests and the demo.
 */
export async function buildRealStack(options: StackOptions = {}): Promise<RealStack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'wcm-it-'));
  const db = openDatabase(join(dataDir, 'test.db'));
  migrate(db);
  const repos = createRepositories(db);
  const logger = createLogger('silent');
  const clock = new MutableClock();
  const urlGuardOptions = { allowPrivateTargets: true };

  const browserManager = new BrowserManager({ headless: true }, logger);
  const extraction = new ExtractionService(browserManager, logger, urlGuardOptions, {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  });

  const monitorService = new MonitorService({
    monitorRepo: repos.monitors,
    extraction,
    urlGuardOptions,
    clock,
    logger,
    defaultTimeoutMs: 10_000,
    defaultSettleMs: 50,
  });

  const mock = trackMock(logger);
  const notificationService = new NotificationService({
    providers: new Map<string, NotificationProvider>([
      ['webhook', new WebhookNotifier({ timeoutMs: 3_000, urlGuardOptions, dnsResolver: null })],
      ['mock', mock.provider],
    ]),
    deliveryRepo: repos.deliveries,
    clock,
    logger,
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    urlGuardOptions,
    defaultProvider: options.defaultNotificationProvider ?? 'mock',
  });

  const checkService = new CheckService({
    monitorRepo: repos.monitors,
    snapshotRepo: repos.snapshots,
    changeEventRepo: repos.changeEvents,
    checkRunRepo: repos.checkRuns,
    extraction,
    notifications: notificationService,
    urlGuardOptions,
    clock,
    logger,
    defaultTimeoutMs: 10_000,
    defaultSettleMs: 50,
  });

  const queue = new BoundedQueue(3, (err) => logger.error({ err }, 'queue task crashed'));
  const scheduler = new Scheduler({
    monitorRepo: repos.monitors,
    checkRunRepo: repos.checkRuns,
    checkService,
    queue,
    clock,
    logger,
    tickMs: 60_000,
  });

  const app = await buildApp({
    config: {
      port: 0,
      dbPath: join(dataDir, 'test.db'),
      logLevel: 'silent',
      browserHeadless: true,
      maxConcurrentChecks: 3,
      defaultTimeoutMs: 10_000,
      extractionSettleMs: 50,
      schedulerTickMs: 60_000,
      webhookTimeoutMs: 3_000,
      webhookMaxAttempts: 2,
      allowPrivateTargets: true,
      defaultNotificationProvider: 'mock',
    },
    logger,
    repos,
    monitorService,
    checkService,
    notificationService,
    scheduler,
    version: 'test',
    startedAt: Date.now(),
  });

  return {
    db,
    repos,
    logger,
    browserManager,
    extraction,
    monitorService,
    checkService,
    notificationService,
    scheduler,
    queue,
    app,
    clock,
    mockPayloads: mock.payloads,
    dataDir,
    async close(): Promise<void> {
      await app.close();
      await scheduler.stop();
      await browserManager.close();
      db.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
