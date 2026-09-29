import type { ChangeEvent, Monitor } from '../domain/types.js';
import type {
  NotificationDeliveryRepository,
} from '../repositories/notification-delivery-repository.js';
import type { Logger } from '../utils/logger.js';
import type { Clock } from '../utils/clock.js';
import { newId } from '../utils/id.js';
import { sleep } from '../utils/clock.js';
import type { UrlGuardOptions } from '../utils/url-guard.js';
import { isSafePublicUrl } from '../utils/url-guard.js';
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
  /** Used when a monitor has no webhook configured: 'none' | 'mock'. */
  defaultProvider: 'none' | 'mock';
}

function sanitizeTarget(target: string): string {
  if (!isSafePublicUrl(target, { allowPrivateTargets: true })) {
    return 'unparsed';
  }
  try {
    // Store only the origin — webhook URLs frequently contain secret tokens.
    return new URL(target).origin;
  } catch {
    return 'unparsed';
  }
}

/**
 * Routes change events to the configured notification provider with bounded
 * retries. Failures are recorded in notification_deliveries and logged; they
 * NEVER fail the check that produced the change event.
 */
export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /**
   * Delivers a change notification. Resolves when delivery attempts are
   * exhausted (success or final failure) so callers can await it in tests;
   * the check pipeline normally fires it without awaiting.
   */
  async notifyChange(monitor: Monitor, event: ChangeEvent): Promise<void> {
    const providerName = monitor.webhookUrl !== null ? 'webhook' : this.deps.defaultProvider;
    if (providerName === 'none') {
      return;
    }
    const provider = this.deps.providers.get(providerName);
    if (!provider) {
      this.deps.logger.warn({ provider: providerName }, 'notification provider not registered');
      return;
    }

    const target = monitor.webhookUrl ?? 'mock';
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

    const now = this.deps.clock.now().toISOString();
    const delivery = this.deps.deliveryRepo.create({
      id: newId(),
      changeEventId: event.id,
      monitorId: monitor.id,
      provider: providerName,
      target: providerName === 'webhook' ? sanitizeTarget(target) : target,
      createdAt: now,
    });

    await this.deliver(provider, payload, target, delivery.id);
  }

  /**
   * Sends a test notification for a monitor (uses webhook when configured,
   * mock otherwise). Does not persist anything.
   */
  async sendTestNotification(monitor: Monitor): Promise<TestNotificationResult> {
    const providerName = monitor.webhookUrl !== null ? 'webhook' : 'mock';
    const provider = this.deps.providers.get(providerName);
    if (!provider) {
      return { provider: providerName, delivered: false, error: 'Provider not registered.' };
    }

    const target = monitor.webhookUrl ?? 'mock';
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

    try {
      await provider.send(payload, target);
      this.deps.logger.info(
        { provider: providerName, monitorId: monitor.id },
        'test notification sent',
      );
      return { provider: providerName, delivered: true, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Notification failed.';
      this.deps.logger.warn(
        { provider: providerName, monitorId: monitor.id, error: message },
        'test notification failed',
      );
      return { provider: providerName, delivered: false, error: message };
    }
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
