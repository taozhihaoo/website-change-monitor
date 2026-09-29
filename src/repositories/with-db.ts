import { AppError } from '../domain/errors.js';

/**
 * Wraps a database operation, converting driver-level failures into an
 * AppError with a safe message. The raw driver error is preserved as `cause`
 * for logging but never serialized to API responses.
 */
export function withDb<T>(op: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('DATABASE_ERROR', 'A database operation failed.', {
      details: { operation: op },
      cause: err,
    });
  }
}
