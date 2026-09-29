import type { Monitor } from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import type { MonitorRepository } from '../repositories/monitor-repository.js';
import type { CheckRunRepository } from '../repositories/check-run-repository.js';
import type { CheckOutcome, CheckService } from '../services/check-service.js';
import type { BoundedQueue } from './queue.js';
import type { Clock } from '../utils/clock.js';
import type { Logger } from '../utils/logger.js';

export interface SchedulerStatus {
  activeChecks: number;
  queuedChecks: number;
  runningMonitorIds: string[];
}

export interface SchedulerDeps {
  monitorRepo: MonitorRepository;
  checkRunRepo: CheckRunRepository;
  checkService: CheckService;
  queue: BoundedQueue;
  clock: Clock;
  logger: Logger;
  tickMs: number;
}

/**
 * In-process interval scheduler. Design notes:
 *
 * - Every SCHEDULER_TICK_MS it loads enabled monitors and dispatches the ones
 *   that are due. Due-ness is derived from the last check_run row, so after a
 *   restart there is no in-memory state to recover — the database is the
 *   source of truth.
 * - A monitor is never dispatched while one of its checks is already running
 *   (scheduler-level guard; CheckService enforces the same rule).
 * - A failing monitor only records an error check_run; it never breaks the
 *   tick loop or other monitors.
 * - The interval restarts from the last run's start time, including failed
 *   runs, which prevents error storms against a struggling target.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly runningMonitors = new Set<string>();
  private stopped = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tickNow();
    }, this.deps.tickMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.deps.queue.drain();
    this.deps.logger.info('scheduler stopped');
  }

  status(): SchedulerStatus {
    return {
      activeChecks: this.deps.queue.activeCount,
      queuedChecks: this.deps.queue.waitingCount,
      runningMonitorIds: [...this.runningMonitors],
    };
  }

  isDue(monitor: Monitor): boolean {
    const lastStartedAt = this.deps.checkRunRepo.latestStartedAt(monitor.id);
    if (lastStartedAt === null) {
      return true;
    }
    const dueAtMs = Date.parse(lastStartedAt) + monitor.checkIntervalSeconds * 1000;
    return this.deps.clock.now().getTime() >= dueAtMs;
  }

  /**
   * Enqueues an immediate manual check with high priority. Manual runs are
   * allowed for disabled monitors (e.g. after editing a URL) — the scheduler
   * only skips disabled monitors for *automatic* runs.
   */
  runNow(monitor: Monitor): Promise<CheckOutcome> {
    if (this.deps.checkService.isBusy(monitor.id)) {
      return Promise.reject(
        new AppError('MONITOR_BUSY', 'A check for this monitor is already in progress.'),
      );
    }
    return this.deps.queue.submit(async () => {
      try {
        return await this.deps.checkService.runCheck(monitor, 'manual');
      } finally {
        this.runningMonitors.delete(monitor.id);
      }
    }, 10);
  }

  /**
   * One scheduling pass: dispatch every enabled, due monitor that is not
   * already running. Public so tests (and run-once tooling) can drive the
   * loop deterministically without waiting on wall-clock timers.
   */
  async tickNow(): Promise<void> {
    if (this.ticking || this.stopped) {
      return;
    }
    this.ticking = true;
    try {
      const monitors = this.deps.monitorRepo.listEnabled();
      for (const monitor of monitors) {
        if (this.runningMonitors.has(monitor.id)) {
          continue;
        }
        if (!this.isDue(monitor)) {
          continue;
        }
        this.dispatch(monitor);
      }
    } catch (err) {
      this.deps.logger.error({ err }, 'scheduler tick failed');
    } finally {
      this.ticking = false;
    }
  }

  private dispatch(monitor: Monitor): void {
    this.runningMonitors.add(monitor.id);
    this.deps.logger.debug({ monitorId: monitor.id }, 'dispatching scheduled check');
    void this.deps.queue
      .submit(async () => {
        try {
          await this.deps.checkService.runCheck(monitor, 'schedule');
        } finally {
          this.runningMonitors.delete(monitor.id);
        }
      })
      .catch((err: unknown) => {
        // runCheck records errors itself; a rejection here means the guard
        // tripped or the database is broken — log and keep going.
        this.deps.logger.error({ err, monitorId: monitor.id }, 'scheduled check crashed');
      });
  }
}
