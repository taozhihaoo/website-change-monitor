import { loadConfigFromEnvironment } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { createRepositories } from './repositories/index.js';
import { BrowserManager } from './browser/browser-manager.js';
import { ExtractionService } from './services/extraction-service.js';
import { MonitorService } from './services/monitor-service.js';
import { CheckService } from './services/check-service.js';
import {
  MockNotifier,
} from './notifications/mock-notifier.js';
import { WebhookNotifier } from './notifications/webhook-notifier.js';
import { NotificationService } from './notifications/notification-service.js';
import type { NotificationProvider } from './notifications/provider.js';
import { BoundedQueue } from './scheduler/queue.js';
import { Scheduler } from './scheduler/scheduler.js';
import { buildApp } from './api/app.js';
import { systemClock } from './utils/clock.js';
import { createSystemResolver } from './utils/dns-guard.js';

const PACKAGE_VERSION = '0.1.0';

async function main(): Promise<void> {
  const config = loadConfigFromEnvironment();
  const logger = createLogger(config.logLevel);
  const startedAt = Date.now();

  logger.info(
    {
      port: config.port,
      dbPath: config.dbPath,
      maxConcurrentChecks: config.maxConcurrentChecks,
      browserHeadless: config.browserHeadless,
      allowPrivateTargets: config.allowPrivateTargets,
    },
    'starting website-change-monitor',
  );

  const db = openDatabase(config.dbPath);
  migrate(db, (info) => logger.info(info, 'migration applied'));
  const repos = createRepositories(db);

  const urlGuardOptions = { allowPrivateTargets: config.allowPrivateTargets };
  const dnsResolver = createSystemResolver(config.dnsTimeoutMs);
  const browserManager = new BrowserManager({ headless: config.browserHeadless }, logger);
  const extractionService = new ExtractionService(browserManager, logger, urlGuardOptions, dnsResolver);

  const monitorService = new MonitorService({
    monitorRepo: repos.monitors,
    extraction: extractionService,
    urlGuardOptions,
    dnsResolver,
    clock: systemClock,
    logger,
    defaultTimeoutMs: config.defaultTimeoutMs,
    defaultSettleMs: config.extractionSettleMs,
  });

  const notificationService = new NotificationService({
    providers: new Map<string, NotificationProvider>([
      [
        'webhook',
        new WebhookNotifier({ timeoutMs: config.webhookTimeoutMs, urlGuardOptions, dnsResolver }),
      ],
      ['mock', new MockNotifier(logger)],
    ]),
    deliveryRepo: repos.deliveries,
    clock: systemClock,
    logger,
    maxAttempts: config.webhookMaxAttempts,
    retryBaseDelayMs: 500,
    urlGuardOptions,
    defaultProvider: config.defaultNotificationProvider,
  });

  const checkService = new CheckService({
    monitorRepo: repos.monitors,
    snapshotRepo: repos.snapshots,
    changeEventRepo: repos.changeEvents,
    checkRunRepo: repos.checkRuns,
    extraction: extractionService,
    notifications: notificationService,
    urlGuardOptions,
    clock: systemClock,
    logger,
    defaultTimeoutMs: config.defaultTimeoutMs,
    defaultSettleMs: config.extractionSettleMs,
  });

  const queue = new BoundedQueue(config.maxConcurrentChecks, (err) =>
    logger.error({ err }, 'queued task crashed'),
  );
  const scheduler = new Scheduler({
    monitorRepo: repos.monitors,
    checkRunRepo: repos.checkRuns,
    checkService,
    queue,
    clock: systemClock,
    logger,
    tickMs: config.schedulerTickMs,
  });
  scheduler.start();

  const app = await buildApp({
    config,
    logger,
    repos,
    monitorService,
    checkService,
    notificationService,
    scheduler,
    version: PACKAGE_VERSION,
    startedAt,
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`website-change-monitor listening on http://localhost:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await scheduler.stop();
      await browserManager.close();
      db.close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

main().catch((err) => {
  // Logger may not exist yet if config loading failed.
  console.error(err);
  process.exit(1);
});
