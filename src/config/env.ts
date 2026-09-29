import 'dotenv/config';
import { z } from 'zod';

export const envSchema = z.object({
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().min(1).default('data/wcm.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  BROWSER_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  MAX_CONCURRENT_CHECKS: z.coerce.number().int().min(1).max(50).default(5),
  DEFAULT_TIMEOUT: z.coerce.number().int().min(1_000).default(30_000),
  EXTRACTION_SETTLE_MS: z.coerce.number().int().min(0).default(1_000),
  SCHEDULER_TICK_MS: z.coerce.number().int().min(1_000).default(10_000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).default(8_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  DNS_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  MAX_SNAPSHOTS_PER_MONITOR: z.coerce.number().int().min(0).default(100),
  ALLOW_PRIVATE_TARGETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DEFAULT_NOTIFICATION_PROVIDER: z.enum(['none', 'mock']).default('none'),
});

export interface AppConfig {
  port: number;
  dbPath: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  browserHeadless: boolean;
  maxConcurrentChecks: number;
  defaultTimeoutMs: number;
  extractionSettleMs: number;
  schedulerTickMs: number;
  webhookTimeoutMs: number;
  webhookMaxAttempts: number;
  dnsTimeoutMs: number;
  /** Per-monitor snapshot cap; 0 disables pruning (unlimited). */
  maxSnapshotsPerMonitor: number;
  allowPrivateTargets: boolean;
  defaultNotificationProvider: 'none' | 'mock';
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  return {
    port: parsed.APP_PORT,
    dbPath: parsed.DB_PATH,
    logLevel: parsed.LOG_LEVEL,
    browserHeadless: parsed.BROWSER_HEADLESS,
    maxConcurrentChecks: parsed.MAX_CONCURRENT_CHECKS,
    defaultTimeoutMs: parsed.DEFAULT_TIMEOUT,
    extractionSettleMs: parsed.EXTRACTION_SETTLE_MS,
    schedulerTickMs: parsed.SCHEDULER_TICK_MS,
    webhookTimeoutMs: parsed.WEBHOOK_TIMEOUT_MS,
    webhookMaxAttempts: parsed.WEBHOOK_MAX_ATTEMPTS,
    dnsTimeoutMs: parsed.DNS_TIMEOUT_MS,
    maxSnapshotsPerMonitor: parsed.MAX_SNAPSHOTS_PER_MONITOR,
    allowPrivateTargets: parsed.ALLOW_PRIVATE_TARGETS,
    defaultNotificationProvider: parsed.DEFAULT_NOTIFICATION_PROVIDER,
  };
}

export function loadConfigFromEnvironment(): AppConfig {
  return loadConfig();
}
