import { AppError } from '../domain/errors.js';
import type { NotificationPayload, NotificationProvider } from './provider.js';
import { NotificationError } from './provider.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';
import {
  assertPublicDnsResolution,
  type HostResolver,
} from '../utils/dns-guard.js';

const MAX_REDIRECTS = 3;

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

    let currentUrl = target;
    let method: 'POST' | 'GET' = 'POST';
    let body: string | undefined = JSON.stringify(payload);

    // fetch() follows redirects by default. A public endpoint returning
    // 302 → http://169.254.169.254/... would otherwise turn a validated URL
    // into an internal request, with the change payload attached (307/308).
    // Follow redirects manually and re-run both guard layers on EVERY hop.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await this.assertTargetAllowed(currentUrl);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'WebsiteChangeMonitor/0.1',
          },
          ...(body !== undefined ? { body } : {}),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (err) {
        // Network failures and timeouts are considered transient.
        throw new NotificationError('Webhook request failed (network error or timeout).', true, err);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) {
          throw new NotificationError(
            `Webhook redirect (HTTP ${response.status}) has no Location header.`,
            false,
          );
        }
        if (hop === MAX_REDIRECTS) {
          throw new NotificationError('Webhook endpoint redirected too many times.', false);
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new NotificationError('Webhook endpoint returned an invalid redirect target.', false);
        }
        await this.assertTargetAllowed(nextUrl);
        // Standard semantics: 301/302/303 downgrade POST to GET and drop the
        // body; 307/308 keep the method and body.
        if (
          response.status === 303 ||
          (method === 'POST' && (response.status === 301 || response.status === 302))
        ) {
          method = 'GET';
          body = undefined;
        }
        await response.body?.cancel().catch(() => undefined);
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new NotificationError(
          `Webhook endpoint responded with HTTP ${response.status}.`,
          retryable,
        );
      }
      return;
    }

    throw new NotificationError('Webhook endpoint redirected too many times.', false);
  }

  private async assertTargetAllowed(target: string): Promise<void> {
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
  }
}
