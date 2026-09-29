import pino from 'pino';

export type Logger = pino.Logger;

const REDACTED_PATHS = [
  'smtp_password',
  'smtpPassword',
  'password',
  'authorization',
  'req.headers.authorization',
  '*.webhook_secret',
  'webhook_secret',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  });
}
