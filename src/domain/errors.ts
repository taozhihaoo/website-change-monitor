export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_URL',
  'URL_NOT_ALLOWED',
  'DNS_ERROR',
  'MONITOR_NOT_FOUND',
  'MONITOR_BUSY',
  'SELECTOR_NOT_FOUND',
  'TEXT_NOT_FOUND',
  'EMPTY_EXTRACTION',
  'TIMEOUT',
  'NAVIGATION_ERROR',
  'NETWORK_ERROR',
  'EXTRACTION_FAILED',
  'NOTIFICATION_FAILED',
  'DATABASE_ERROR',
  'NOT_FOUND',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/**
 * Application error with a stable machine-readable code.
 * Messages are crafted to be safe to expose over HTTP (no internals, no stack).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
  }
  return new AppError('INTERNAL', 'An unexpected internal error occurred.', { cause: err });
}
