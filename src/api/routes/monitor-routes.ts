import type { FastifyInstance } from 'fastify';
import { AppError } from '../../domain/errors.js';
import type { MonitorService, UpdateMonitorInput } from '../../services/monitor-service.js';
import type { CheckService } from '../../services/check-service.js';
import type { SnapshotRepository } from '../../repositories/snapshot-repository.js';
import type { ChangeEventRepository } from '../../repositories/change-event-repository.js';
import type { CheckRunRepository } from '../../repositories/check-run-repository.js';
import type { NotificationDeliveryRepository } from '../../repositories/notification-delivery-repository.js';
import type { Scheduler } from '../../scheduler/scheduler.js';
import type { NotificationService } from '../../notifications/notification-service.js';
import {
  createMonitorSchema,
  idParamSchema,
  paginationQuerySchema,
  runNowQuerySchema,
  updateMonitorSchema,
} from '../schemas.js';
import {
  serializeChangeEvent,
  serializeCheckRun,
  serializeDelivery,
  serializeMonitor,
  serializeMonitorWithSummary,
  serializeSnapshot,
} from '../serializers.js';
import type { Logger } from '../../utils/logger.js';

export interface MonitorRoutesDeps {
  monitorService: MonitorService;
  checkService: CheckService;
  scheduler: Scheduler;
  notificationService: NotificationService;
  snapshotRepo: SnapshotRepository;
  changeEventRepo: ChangeEventRepository;
  checkRunRepo: CheckRunRepository;
  deliveryRepo: NotificationDeliveryRepository;
  logger: Logger;
}

export async function monitorRoutes(app: FastifyInstance, deps: MonitorRoutesDeps): Promise<void> {
  app.get('/monitors', async () => {
    return { monitors: deps.monitorService.list().map(serializeMonitorWithSummary) };
  });

  app.post('/monitors', async (request, reply) => {
    const body = createMonitorSchema.parse(request.body);
    const monitor = await deps.monitorService.create({
      name: body.name,
      url: body.url,
      selector: body.selector,
      selectorType: body.selector_type,
      checkIntervalSeconds: body.check_interval_seconds,
      enabled: body.enabled,
      webhookUrl: body.webhook_url,
    });
    return reply.status(201).send({ monitor: serializeMonitor(monitor) });
  });

  app.get('/monitors/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const monitor = deps.monitorService.getWithSummary(id);
    return { monitor: serializeMonitorWithSummary(monitor) };
  });

  app.patch('/monitors/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateMonitorSchema.parse(request.body);
    const patch: UpdateMonitorInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.selector !== undefined ? { selector: body.selector } : {}),
      ...(body.selector_type !== undefined ? { selectorType: body.selector_type } : {}),
      ...(body.check_interval_seconds !== undefined
        ? { checkIntervalSeconds: body.check_interval_seconds }
        : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.webhook_url !== undefined ? { webhookUrl: body.webhook_url } : {}),
    };
    const monitor = await deps.monitorService.update(id, patch);
    return { monitor: serializeMonitor(monitor) };
  });

  app.delete('/monitors/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    deps.monitorService.delete(id);
    return reply.status(204).send();
  });

  app.post('/monitors/:id/run', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const query = runNowQuerySchema.parse(request.query);
    const monitor = deps.monitorService.get(id);

    const pending = deps.scheduler.runNow(monitor);

    if (query.wait === '1' || query.wait === 'true') {
      const outcome = await pending;
      return {
        run: serializeCheckRun(outcome.run),
        change_event: outcome.changeEvent ? serializeChangeEvent(outcome.changeEvent) : null,
      };
    }

    pending.catch((err: unknown) => {
      if (!(err instanceof AppError)) {
        deps.logger.error({ err, monitorId: id }, 'manual run crashed');
      }
    });
    return reply.status(202).send({ status: 'queued', monitor_id: id });
  });

  app.get('/monitors/:id/runs', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    deps.monitorService.get(id);
    const { limit, offset } = paginationQuerySchema.parse(request.query);
    const runs = deps.checkRunRepo.listByMonitor(id, limit, offset);
    return { runs: runs.map(serializeCheckRun) };
  });

  app.get('/monitors/:id/snapshots', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    deps.monitorService.get(id);
    const { limit, offset } = paginationQuerySchema.parse(request.query);
    const snapshots = deps.snapshotRepo.listByMonitor(id, limit);
    return { snapshots: snapshots.map(serializeSnapshot), offset };
  });

  app.get('/monitors/:id/changes', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    deps.monitorService.get(id);
    const { limit, offset } = paginationQuerySchema.parse(request.query);
    const events = deps.changeEventRepo.listByMonitor(id, limit, offset);
    return {
      changes: events.map((event) => ({
        ...serializeChangeEvent(event),
        deliveries: deps.deliveryRepo.listByChangeEvent(event.id).map(serializeDelivery),
      })),
    };
  });

  app.get('/monitors/:id/notifications', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    deps.monitorService.get(id);
    const { limit, offset } = paginationQuerySchema.parse(request.query);
    const deliveries = deps.deliveryRepo.listByMonitor(id, limit, offset);
    return { notifications: deliveries.map(serializeDelivery) };
  });

  app.post('/monitors/:id/test-notification', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const monitor = deps.monitorService.get(id);
    const result = await deps.notificationService.sendTestNotification(monitor);
    if (!result.delivered) {
      throw new AppError('NOTIFICATION_FAILED', result.error ?? 'Test notification failed.');
    }
    return { provider: result.provider, delivered: true };
  });
}
