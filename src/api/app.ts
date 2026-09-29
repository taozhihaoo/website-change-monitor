import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import type { MonitorService } from '../services/monitor-service.js';
import type { CheckService } from '../services/check-service.js';
import type { NotificationService } from '../notifications/notification-service.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { Repositories } from '../repositories/index.js';
import { installErrorHandlers } from './error-handler.js';
import { healthRoutes } from './routes/health-routes.js';
import { monitorRoutes } from './routes/monitor-routes.js';
import { extractionRoutes } from './routes/extraction-routes.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  repos: Repositories;
  monitorService: MonitorService;
  checkService: CheckService;
  notificationService: NotificationService;
  scheduler: Scheduler;
  version: string;
  startedAt: number;
}

function clientDistDir(): string | null {
  // dist/api/app.js → ../../client/dist in production layout
  const candidate = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  return existsSync(candidate) ? candidate : null;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    disableRequestLogging: true,
    bodyLimit: 64 * 1024,
  });

  // IMPORTANT: error/not-found handlers must be installed BEFORE any
  // register() call — awaited register boots the plugin contexts, and
  // handlers installed afterwards silently stop applying to them.
  let spaFallbackAvailable = false;
  installErrorHandlers(app, deps.logger, () => spaFallbackAvailable);

  const staticRoot = clientDistDir();
  if (staticRoot !== null) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    });
    spaFallbackAvailable = true;
  }

  await app.register(healthRoutes, {
    checkRunRepo: deps.repos.checkRuns,
    scheduler: deps.scheduler,
    version: deps.version,
    startedAt: deps.startedAt,
  });

  await app.register(monitorRoutes, {
    monitorService: deps.monitorService,
    checkService: deps.checkService,
    scheduler: deps.scheduler,
    notificationService: deps.notificationService,
    snapshotRepo: deps.repos.snapshots,
    changeEventRepo: deps.repos.changeEvents,
    checkRunRepo: deps.repos.checkRuns,
    deliveryRepo: deps.repos.deliveries,
    logger: deps.logger,
  });

  await app.register(extractionRoutes, { monitorService: deps.monitorService });

  return app;
}
