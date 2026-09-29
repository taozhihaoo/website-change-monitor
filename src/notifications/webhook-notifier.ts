import { AppError } from '../domain/errors.js';
import type { NotificationPayload, NotificationProvider } from './provider.js';
import { NotificationError } from './provider.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';

/**
 * Posts the change payload as JSON to a user-configured webhook URL.
 * Retries are decided by NotificationService based on NotificationError.
 */
export class WebhookNotifier implements NotificationProvider {
  readonly name = 'webhook';

  constructor(
    private readonly options: { timeoutMs: number; urlGuardOptions: UrlGuardOptions },
  ) {}

  async send(payload: NotificationPayload, target: string): Promise<void> {
    if (target.trim().length === 0) {
      throw new NotificationError('Webhook URL is empty.', false);
    }
    try {
      assertSafePublicUrl(target, this.options.urlGuardOptions);
    } catch (err) {
      if (err instanceof AppError) {
        throw new NotificationError(`Webhook URL is not allowed (${err.code}).`, false, err);
      }
      throw err;
    }

    let response: Response;
    try {
      response = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'WebsiteChangeMonitor/0.1',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      // Network failures and timeouts are considered transient.
      throw new NotificationError('Webhook request failed (network error or timeout).', true, err);
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new NotificationError(
        `Webhook endpoint responded with HTTP ${response.status}.`,
        retryable,
      );
    }
  }
}
