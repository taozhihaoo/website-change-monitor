import type { ChangeEvent, Monitor } from '../domain/types.js';
import type {
  NotificationDeliveryRepository,
} from '../repositories/notification-delivery-repository.js';
import type { Logger } from '../utils/logger.js';
import type { Clock } from '../utils/clock.js';
import { newId } from '../utils/id.js';
import { sleep } from '../utils/clock.js';
import type { UrlGuardOptions } from '../utils/url-guard.js';
import type { NotificationPayload, NotificationProvider } from './provider.js';

export interface TestNotificationResult {
  provider: string;
  delivered: boolean;
  error: string | null;
}

export interface NotificationServiceDeps {
  providers: Map<string, NotificationProvider>;
  deliveryRepo: NotificationDeliveryRepository;
  clock: Clock;
  logger: Logger;
  maxAttempts: number;
  retryBaseDelayMs: number;
  urlGuardOptions: UrlGuardOptions;
  /** Used when a monitor has neither webhook nor email configured: 'none' | 'mock'. */
  defaultProvider: 'none' | 'mock';
}

/**
 * Delivery records store the complete webhook endpoint (path + query) so the
 * history reflects what was actually called — webhooks routinely live at
 * secret paths, and an origin-only record cannot be debugged or audited.
 * Masking happens at the API layer (see serializers), never in storage.
 */
function storableTarget(providerName: string, target: string): string {
  if (providerName !== 'webhook') {
    return target; // 'mock' or an email address
  }
  try {
    new URL(target);
    return target;
  } catch {
    return 'unparsed';
  }
}

interface DeliveryRoute {
  providerName: string;
  provider: NotificationProvider;
  target: string;
}

/**
 * Routes change events to every configured notification target (webhook
 * and/or SMTP email) with bounded retries per target. Failures are recorded
 * in notification_deliveries and logged; they NEVER fail the check that
 * produced the change event.
 */
export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /**
   * Delivers change notifications. Resolves when all delivery attempts are
   * exhausted (success or final failure) so callers can await it in tests;
   * the check pipeline normally fires it without awaiting.
   */
  async notifyChange(monitor: Monitor, event: ChangeEvent): Promise<void> {
    const routes = this.resolveRoutes(monitor);
    if (routes.length === 0) {
      return;
    }
    await Promise.all(routes.map((route) => this.deliverChange(monitor, event, route)));
  }

  /**
   * Sends a test notification through every configured target (webhook and/or
   * email; mock when neither is configured). Does not persist anything.
   */
  async sendTestNotification(monitor: Monitor): Promise<TestNotificationResult[]> {
    const routes: DeliveryRoute[] = [];
    if (monitor.webhookUrl !== null) {
      const provider = this.deps.providers.get('webhook');
      if (provider) {
        routes.push({ providerName: 'webhook', provider, target: monitor.webhookUrl });
      }
    }
    if (monitor.notifyEmail !== null) {
      const provider = this.deps.providers.get('email');
      if (provider) {
        routes.push({ providerName: 'email', provider, target: monitor.notifyEmail });
      }
    }
    if (routes.length === 0) {
      const mock = this.deps.providers.get('mock');
      if (mock) {
        routes.push({ providerName: 'mock', provider: mock, target: 'mock' });
      }
    }

    if (routes.length === 0) {
      return [
        {
          provider: 'none',
          delivered: false,
          error: 'No notification provider is available.',
        },
      ];
    }

    const payload: NotificationPayload = {
      event: 'test',
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      url: monitor.url,
      detected_at: this.deps.clock.now().toISOString(),
      previous_hash: 'test',
      current_hash: 'test',
      diff: { added: 0, removed: 0, changes: [] },
    };

    return Promise.all(
      routes.map(async (route): Promise<TestNotificationResult> => {
        try {
          await route.provider.send(payload, route.target);
          this.deps.logger.info(
            { provider: route.providerName, monitorId: monitor.id },
            'test notification sent',
          );
          return { provider: route.providerName, delivered: true, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Notification failed.';
          this.deps.logger.warn(
            { provider: route.providerName, monitorId: monitor.id, error: message },
            'test notification failed',
          );
          return { provider: route.providerName, delivered: false, error: message };
        }
      }),
    );
  }

  /**
   * Explicit targets first (webhook and/or email). When a monitor has none,
   * fall back to the default provider ('none' → no delivery at all, 'mock' →
   * logged delivery used by the demo/tests).
   */
  private resolveRoutes(monitor: Monitor): DeliveryRoute[] {
    const routes: DeliveryRoute[] = [];

    if (monitor.webhookUrl !== null) {
      const provider = this.deps.providers.get('webhook');
      if (provider) {
        routes.push({ providerName: 'webhook', provider, target: monitor.webhookUrl });
      } else {
        this.deps.logger.warn('webhook target configured but webhook provider not registered');
      }
    }

    if (monitor.notifyEmail !== null) {
      const provider = this.deps.providers.get('email');
      if (provider) {
        routes.push({ providerName: 'email', provider, target: monitor.notifyEmail });
      } else {
        this.deps.logger.warn(
          'email target configured but email provider not registered (SMTP_HOST missing?)',
        );
      }
    }

    if (routes.length === 0 && this.deps.defaultProvider !== 'none') {
      const provider = this.deps.providers.get(this.deps.defaultProvider);
      if (provider) {
        routes.push({
          providerName: this.deps.defaultProvider,
          provider,
          target: 'mock',
        });
      }
    }

    return routes;
  }

  private async deliverChange(
    monitor: Monitor,
    event: ChangeEvent,
    route: DeliveryRoute,
  ): Promise<void> {
    const payload: NotificationPayload = {
      event: 'content_changed',
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      url: monitor.url,
      detected_at: event.detectedAt,
      previous_hash: event.previousHash,
      current_hash: event.currentHash,
      diff: event.diff,
    };

    const delivery = this.deps.deliveryRepo.create({
      id: newId(),
      changeEventId: event.id,
      monitorId: monitor.id,
      provider: route.providerName,
      target: storableTarget(route.providerName, route.target),
      createdAt: this.deps.clock.now().toISOString(),
    });

    await this.deliver(route.provider, payload, route.target, delivery.id);
  }

  private async deliver(
    provider: NotificationProvider,
    payload: NotificationPayload,
    target: string,
    deliveryId: string,
  ): Promise<void> {
    let attempts = 0;
    let lastError: string | null = null;

    while (attempts < this.deps.maxAttempts) {
      attempts += 1;
      try {
        await provider.send(payload, target);
        this.deps.deliveryRepo.updateStatus(deliveryId, {
          status: 'sent',
          attempts,
          lastError: null,
          updatedAt: this.deps.clock.now().toISOString(),
        });
        this.deps.logger.info(
          { deliveryId, provider: provider.name, attempts },
          'notification sent',
        );
        return;
      } catch (err) {
        const retryable = err instanceof Error && 'retryable' in err && err.retryable === true;
        lastError = err instanceof Error ? err.message : 'Unknown notification error.';
        this.deps.logger.warn(
          { deliveryId, provider: provider.name, attempts, error: lastError },
          'notification attempt failed',
        );
        if (!retryable || attempts >= this.deps.maxAttempts) {
          break;
        }
        await sleep(this.deps.retryBaseDelayMs * 2 ** (attempts - 1));
      }
    }

    this.deps.deliveryRepo.updateStatus(deliveryId, {
      status: 'failed',
      attempts,
      lastError,
      updatedAt: this.deps.clock.now().toISOString(),
    });
    this.deps.logger.error({ deliveryId, provider: provider.name }, 'notification failed');
  }
}
