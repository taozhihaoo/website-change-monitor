import type { NotificationPayload, NotificationProvider } from './provider.js';
import type { Logger } from '../utils/logger.js';

/**
 * Logs the payload instead of sending anything. Used for the offline demo,
 * for tests, and as DEFAULT_NOTIFICATION_PROVIDER=mock so the pipeline can be
 * exercised without any external service.
 */
export class MockNotifier implements NotificationProvider {
  readonly name = 'mock';

  constructor(private readonly logger: Logger) {}

  async send(payload: NotificationPayload, target: string): Promise<void> {
    this.logger.info(
      {
        provider: this.name,
        target,
        event: payload.event,
        monitor_id: payload.monitor_id,
        monitor_name: payload.monitor_name,
        current_hash: payload.current_hash,
        diff_summary: { added: payload.diff.added, removed: payload.diff.removed },
      },
      'mock notification delivered',
    );
  }
}
