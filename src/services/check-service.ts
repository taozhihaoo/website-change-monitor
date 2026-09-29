import type {
  ChangeEvent,
  CheckRun,
  CheckStatus,
  CheckTrigger,
  Monitor,
} from '../domain/types.js';
import { AppError, toAppError } from '../domain/errors.js';
import type { ChangeEventRepository } from '../repositories/change-event-repository.js';
import type { CheckRunRepository } from '../repositories/check-run-repository.js';
import type { MonitorRepository } from '../repositories/monitor-repository.js';
import type { SnapshotRepository } from '../repositories/snapshot-repository.js';
import type { ExtractionService } from './extraction-service.js';
import type { NotificationService } from '../notifications/notification-service.js';
import type { Logger } from '../utils/logger.js';
import type { Clock } from '../utils/clock.js';
import { newId } from '../utils/id.js';
import { sha256Hex } from '../utils/hash.js';
import { normalizeContent } from '../utils/normalize.js';
import { computeDiff } from './diff-service.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';

export interface CheckOutcome {
  run: CheckRun;
  changeEvent: ChangeEvent | null;
  /** Resolves when notification delivery attempts finished (or null). */
  notification: Promise<void> | null;
}

export interface CheckServiceDeps {
  monitorRepo: MonitorRepository;
  snapshotRepo: SnapshotRepository;
  changeEventRepo: ChangeEventRepository;
  checkRunRepo: CheckRunRepository;
  extraction: ExtractionService;
  notifications: NotificationService;
  urlGuardOptions: UrlGuardOptions;
  clock: Clock;
  logger: Logger;
  defaultTimeoutMs: number;
  defaultSettleMs: number;
}

/**
 * The core pipeline: fetch → extract → normalize → hash → compare → persist →
 * notify.
 *
 * Semantics:
 * - first successful check stores the baseline and never notifies;
 * - same hash as previous snapshot → unchanged;
 * - different hash → snapshot + change event. The UNIQUE(monitor_id,
 *   current_hash) constraint guarantees one event per content state (A→B→A→B
 *   does not re-notify for B);
 * - notifications are asynchronous: a failed webhook never fails the check;
 * - every attempt (including errors) produces exactly one check_run row.
 */
export class CheckService {
  private readonly busyMonitors = new Set<string>();

  constructor(private readonly deps: CheckServiceDeps) {}

  isBusy(monitorId: string): boolean {
    return this.busyMonitors.has(monitorId);
  }

  async runCheck(monitor: Monitor, triggeredBy: CheckTrigger): Promise<CheckOutcome> {
    if (this.busyMonitors.has(monitor.id)) {
      throw new AppError('MONITOR_BUSY', 'A check for this monitor is already in progress.');
    }
    this.busyMonitors.add(monitor.id);
    try {
      return await this.execute(monitor, triggeredBy);
    } finally {
      this.busyMonitors.delete(monitor.id);
    }
  }

  private async execute(monitor: Monitor, triggeredBy: CheckTrigger): Promise<CheckOutcome> {
    const startedAt = this.deps.clock.now();
    try {
      assertSafePublicUrl(monitor.url, this.deps.urlGuardOptions);

      const extraction = await this.deps.extraction.extract({
        url: monitor.url,
        selector: monitor.selector,
        selectorType: monitor.selectorType,
        timeoutMs: this.deps.defaultTimeoutMs,
        settleMs: this.deps.defaultSettleMs,
      });

      const content = normalizeContent(extraction.content);
      if (content.length === 0) {
        throw new AppError('EMPTY_EXTRACTION', 'The target matched but contained no text content.');
      }
      const hash = sha256Hex(content);
      const checkedAt = this.deps.clock.now().toISOString();

      const previous = this.deps.snapshotRepo.latestByMonitor(monitor.id);
      this.deps.snapshotRepo.insert({
        id: newId(),
        monitorId: monitor.id,
        contentHash: hash,
        content,
        checkedAt,
      });

      let status: CheckStatus;
      let changeEvent: ChangeEvent | null = null;

      if (previous === null) {
        status = 'baseline';
      } else if (previous.contentHash === hash) {
        status = 'unchanged';
      } else {
        status = 'changed';
        const diff = computeDiff(previous.content, content);
        // Returns null when this content state already has an event (idempotency).
        changeEvent = this.deps.changeEventRepo.insert({
          id: newId(),
          monitorId: monitor.id,
          previousHash: previous.contentHash,
          currentHash: hash,
          previousContent: previous.content,
          currentContent: content,
          diff,
          detectedAt: checkedAt,
        });
      }

      const finishedAt = this.deps.clock.now();
      const run = this.deps.checkRunRepo.insert({
        id: newId(),
        monitorId: monitor.id,
        triggeredBy,
        status,
        errorCode: null,
        errorMessage: null,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      });

      this.deps.logger.info(
        { monitorId: monitor.id, runId: run.id, status, durationMs: run.durationMs },
        'check completed',
      );

      let notification: Promise<void> | null = null;
      if (changeEvent !== null) {
        this.deps.logger.info(
          { monitorId: monitor.id, eventId: changeEvent.id, currentHash: changeEvent.currentHash },
          'change detected',
        );
        notification = this.deps.notifications
          .notifyChange(monitor, changeEvent)
          .catch((err: unknown) => {
            this.deps.logger.error({ err, monitorId: monitor.id }, 'notification crashed');
          });
      }

      return { run, changeEvent, notification };
    } catch (err) {
      return this.recordError(monitor, triggeredBy, startedAt, err);
    }
  }

  private recordError(
    monitor: Monitor,
    triggeredBy: CheckTrigger,
    startedAt: Date,
    err: unknown,
  ): CheckOutcome {
    const appError = toAppError(err);
    const finishedAt = this.deps.clock.now();
    const run = this.deps.checkRunRepo.insert({
      id: newId(),
      monitorId: monitor.id,
      triggeredBy,
      status: 'error',
      errorCode: appError.code,
      errorMessage: appError.message,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    this.deps.logger.warn(
      { monitorId: monitor.id, runId: run.id, errorCode: appError.code },
      'check failed',
    );
    return { run, changeEvent: null, notification: null };
  }
}
