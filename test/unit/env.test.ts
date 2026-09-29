import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.dbPath).toBe('data/wcm.db');
    expect(config.logLevel).toBe('info');
    expect(config.browserHeadless).toBe(true);
    expect(config.maxConcurrentChecks).toBe(5);
    expect(config.defaultTimeoutMs).toBe(30_000);
    expect(config.allowPrivateTargets).toBe(false);
    expect(config.defaultNotificationProvider).toBe('none');
  });

  it('parses and coerces environment values', () => {
    const config = loadConfig({
      APP_PORT: '8080',
      DB_PATH: '/tmp/test.db',
      LOG_LEVEL: 'debug',
      BROWSER_HEADLESS: 'false',
      MAX_CONCURRENT_CHECKS: '10',
      DEFAULT_TIMEOUT: '15000',
      ALLOW_PRIVATE_TARGETS: 'true',
      DEFAULT_NOTIFICATION_PROVIDER: 'mock',
    });
    expect(config.port).toBe(8080);
    expect(config.dbPath).toBe('/tmp/test.db');
    expect(config.logLevel).toBe('debug');
    expect(config.browserHeadless).toBe(false);
    expect(config.maxConcurrentChecks).toBe(10);
    expect(config.defaultTimeoutMs).toBe(15_000);
    expect(config.allowPrivateTargets).toBe(true);
    expect(config.defaultNotificationProvider).toBe('mock');
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ APP_PORT: 'not-a-port' })).toThrowError();
    expect(() => loadConfig({ MAX_CONCURRENT_CHECKS: '0' })).toThrowError();
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrowError();
    expect(() => loadConfig({ DEFAULT_NOTIFICATION_PROVIDER: 'pigeon' })).toThrowError();
  });
});
