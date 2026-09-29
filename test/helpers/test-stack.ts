import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { migrate } from '../../src/db/migrate.js';
import { createRepositories, type Repositories } from '../../src/repositories/index.js';
import { createLogger, type Logger } from '../../src/utils/logger.js';
import { systemClock, type Clock } from '../../src/utils/clock.js';
import type { ExtractionRequest, ExtractionResult } from '../../src/services/extraction-service.js';
import type { ExtractionService } from '../../src/services/extraction-service.js';
import type { HostResolver } from '../../src/utils/dns-guard.js';
import { CheckService } from '../../src/services/check-service.js';
import { MonitorService } from '../../src/services/monitor-service.js';
import { NotificationService } from '../../src/notifications/notification-service.js';
import type { NotificationPayload, NotificationProvider } from '../../src/notifications/provider.js';
import type { Monitor } from '../../src/domain/types.js';

export function silentLogger(): Logger {
  return createLogger('silent');
}

export class MutableClock implements Clock {
  current: Date;

  constructor(initial = new Date('2026-09-30T10:00:00.000Z')) {
    this.current = initial;
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export type ExtractionBehavior = (request: ExtractionRequest) => Promise<ExtractionResult>;

export function extractionStub(behavior: ExtractionBehavior): {
  service: ExtractionService;
  calls: ExtractionRequest[];
} {
  const calls: ExtractionRequest[] = [];
  const service = {
    extract: (request: ExtractionRequest): Promise<ExtractionResult> => {
      calls.push(request);
      return behavior(request);
    },
  } as unknown as ExtractionService;
  return { service, calls };
}

export function constantExtraction(content: string): ExtractionBehavior {
  return () => Promise.resolve({ content, durationMs: 5 });
}

export interface ServiceStack {
  db: Db;
  repos: Repositories;
  clock: MutableClock;
  checkService: CheckService;
  monitorService: MonitorService;
  notificationService: NotificationService;
  /** Recorded payloads from the mock provider. */
  mockPayloads: NotificationPayload[];
  setExtraction(behavior: ExtractionBehavior): void;
  createMonitor(overrides?: Partial<Monitor>): Monitor;
}

export interface StackOptions {
  defaultNotificationProvider?: 'none' | 'mock';
  urlGuardOptions?: { allowPrivateTargets: boolean };
  webhookMaxAttempts?: number;
  retryBaseDelayMs?: number;
  providers?: Map<string, NotificationProvider>;
  clock?: MutableClock;
  /** Resolver handed to MonitorService/ExtractionService for DNS guarding. */
  dnsResolver?: HostResolver | null;
  /** 0 (default in tests) keeps full snapshot history. */
  maxSnapshotsPerMonitor?: number;
}

/** Offline default: every hostname resolves to a public IP. */
export const defaultFakeResolver: HostResolver = {
  resolve4: async () => ['93.184.216.34'],
  resolve6: async () => [],
};

/**
 * Builds the full service stack over an in-memory database with a stubbed
 * extraction service — everything above the browser layer, fully offline.
 */
export function buildStack(options: StackOptions = {}): ServiceStack {
  const db = openDatabase(':memory:');
  migrate(db);
  const repos = createRepositories(db);
  const logger = silentLogger();
  const clock = options.clock ?? new MutableClock();
  const urlGuardOptions = options.urlGuardOptions ?? { allowPrivateTargets: true };

  let behavior: ExtractionBehavior = constantExtraction('initial content');
  const { service: extraction } = extractionStub((request) => behavior(request));
  const setExtraction = (next: ExtractionBehavior): void => {
    behavior = next;
  };

  const mockPayloads: NotificationPayload[] = [];
  const mockProvider: NotificationProvider = {
    name: 'mock',
    send: async (payload) => {
      mockPayloads.push(payload);
    },
  };
  const providers = options.providers ?? new Map<string, NotificationProvider>([['mock', mockProvider]]);

  const notificationService = new NotificationService({
    providers,
    deliveryRepo: repos.deliveries,
    clock,
    logger,
    maxAttempts: options.webhookMaxAttempts ?? 3,
    retryBaseDelayMs: options.retryBaseDelayMs ?? 1,
    urlGuardOptions,
    defaultProvider: options.defaultNotificationProvider ?? 'none',
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
    defaultTimeoutMs: 5_000,
    defaultSettleMs: 0,
    maxSnapshotsPerMonitor: options.maxSnapshotsPerMonitor ?? 0,
  });

  const monitorService = new MonitorService({
    monitorRepo: repos.monitors,
    extraction,
    urlGuardOptions,
    dnsResolver:
      options.dnsResolver ??
      (defaultFakeResolver as HostResolver | null),
    clock,
    logger,
    defaultTimeoutMs: 5_000,
    defaultSettleMs: 0,
  });

  let nextMonitor = 0;
  const createMonitor = (overrides: Partial<Monitor> = {}): Monitor => {
    nextMonitor += 1;
    const now = clock.now().toISOString();
    const id = `aaaaaaaa-0000-4000-8000-${String(nextMonitor).padStart(12, '0')}`;
    return repos.monitors.create({
      id,
      name: `Monitor ${nextMonitor}`,
      url: 'https://example.com/product',
      selector: '.product-price',
      selectorType: 'css',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  };

  return {
    db,
    repos,
    clock,
    checkService,
    monitorService,
    notificationService,
    mockPayloads,
    setExtraction,
    createMonitor,
  };
}

export function cleanupStack(stack: ServiceStack): void {
  stack.db.close();
}

export { systemClock };
