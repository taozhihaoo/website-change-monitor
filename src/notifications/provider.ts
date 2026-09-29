import type { DiffResult } from '../domain/types.js';

export interface NotificationPayload {
  event: 'content_changed' | 'test';
  monitor_id: string;
  monitor_name: string;
  url: string;
  detected_at: string;
  previous_hash: string;
  current_hash: string;
  diff: DiffResult;
}

export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload, target: string): Promise<void>;
}

/**
 * Raised by providers. `retryable` drives the retry policy: network errors,
 * HTTP 5xx and 429 are retried; other 4xx responses fail immediately.
 */
export class NotificationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = 'NotificationError';
    if (cause !== undefined) {
      this.cause = cause;
    }
    this.retryable = retryable;
  }
}
