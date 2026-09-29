import type { FastifyInstance } from 'fastify';
import type { CheckRunRepository } from '../../repositories/check-run-repository.js';
import type { Scheduler } from '../../scheduler/scheduler.js';

export interface HealthRoutesDeps {
  checkRunRepo: CheckRunRepository;
  scheduler: Scheduler;
  version: string;
  startedAt: number;
}

export async function healthRoutes(app: FastifyInstance, deps: HealthRoutesDeps): Promise<void> {
  app.get('/health', async () => {
    const status = deps.scheduler.status();
    return {
      status: 'ok',
      version: deps.version,
      uptime_seconds: Math.floor((Date.now() - deps.startedAt) / 1000),
      scheduler: {
        active_checks: status.activeChecks,
        queued_checks: status.queuedChecks,
      },
    };
  });

  app.get('/scheduler/status', async () => {
    const status = deps.scheduler.status();
    return {
      active_checks: status.activeChecks,
      queued_checks: status.queuedChecks,
      running_monitor_ids: status.runningMonitorIds,
    };
  });

  app.get('/stats', async () => {
    const stats = deps.checkRunRepo.dashboardStats();
    return {
      total_monitors: stats.totalMonitors,
      active_monitors: stats.activeMonitors,
      failed_monitors: stats.failedMonitors,
      changes_detected: stats.changesDetected,
      last_check_at: stats.lastCheckAt,
    };
  });
}
