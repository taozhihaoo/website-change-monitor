import { AppError } from '../domain/errors.js';
import type { NotificationPayload, NotificationProvider } from './provider.js';
import { NotificationError } from './provider.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';
import {
  assertPublicDnsResolution,
  type HostResolver,
} from '../utils/dns-guard.js';

/**
 * Posts the change payload as JSON to a user-configured webhook URL.
 * Retries are decided by NotificationService based on NotificationError.
 * The target passes the same URL + DNS guards as monitored pages.
 */
export class WebhookNotifier implements NotificationProvider {
  readonly name = 'webhook';

  constructor(
    private readonly options: {
      timeoutMs: number;
      urlGuardOptions: UrlGuardOptions;
      dnsResolver: HostResolver | null;
    },
  ) {}

  async send(payload: NotificationPayload, target: string): Promise<void> {
    if (target.trim().length === 0) {
      throw new NotificationError('Webhook URL is empty.', false);
    }
    try {
      const parsed = assertSafePublicUrl(target, this.options.urlGuardOptions);
      if (!this.options.urlGuardOptions.allowPrivateTargets && this.options.dnsResolver !== null) {
        await assertPublicDnsResolution(parsed.hostname, {
          resolver: this.options.dnsResolver,
        });
      }
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
