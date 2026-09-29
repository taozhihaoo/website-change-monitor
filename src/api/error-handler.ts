import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';
import type { Logger } from '../utils/logger.js';

export function sendError(
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  reply.status(status).send({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

export function statusForAppError(err: AppError): number {
  switch (err.code) {
    case 'VALIDATION_ERROR':
    case 'INVALID_URL':
    case 'URL_NOT_ALLOWED':
    case 'DNS_ERROR':
      return 400;
    case 'MONITOR_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'MONITOR_BUSY':
      return 409;
    case 'SELECTOR_NOT_FOUND':
    case 'TEXT_NOT_FOUND':
    case 'EMPTY_EXTRACTION':
    case 'TIMEOUT':
    case 'NAVIGATION_ERROR':
    case 'NETWORK_ERROR':
    case 'EXTRACTION_FAILED':
      return 422;
    case 'NOTIFICATION_FAILED':
      return 502;
    default:
      return 500;
  }
}

interface HttpErrorLike {
  statusCode?: number;
}

/**
 * Unified error handling:
 * - AppError → its HTTP status with a safe message;
 * - ZodError → 400 with per-field issues;
 * - Fastify request errors (malformed JSON etc.) → their own status;
 * - anything else → logged server-side, generic 500 without stack or internals.
 */
export function installErrorHandlers(
  app: FastifyInstance,
  logger: Logger,
  spaFallback: () => boolean,
): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      sendError(reply, statusForAppError(err), err.code, err.message, err.details);
      return reply;
    }

    if (err instanceof ZodError) {
      sendError(reply, 400, 'VALIDATION_ERROR', 'Request validation failed.', {
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return reply;
    }

    const statusCode = (err as HttpErrorLike).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const message = err instanceof Error ? err.message : 'Request error.';
      sendError(reply, statusCode, 'REQUEST_ERROR', message);
      return reply;
    }

    logger.error({ err, requestId: request.id }, 'unhandled error');
    sendError(reply, 500, 'INTERNAL', 'Internal server error.', {
      request_id: request.id,
    });
    return reply;
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      spaFallback() &&
      (request.headers.accept ?? '').includes('text/html')
    ) {
      void reply.sendFile('index.html');
      return reply;
    }
    sendError(
      reply,
      404,
      'NOT_FOUND',
      `Route ${request.method} ${request.url} was not found.`,
    );
    return reply;
  });
}
