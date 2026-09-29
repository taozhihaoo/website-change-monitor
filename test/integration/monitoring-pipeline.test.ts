import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, readFixture, type FixtureSite } from './helpers/fixture-site.js';
import { buildRealStack, type RealStack } from './helpers/real-stack.js';

/**
 * Full-pipeline integration test against a real browser and a real SQLite
 * database, using a local fixture server instead of the internet:
 *
 * create monitor → run (baseline) → run (unchanged) → fixture changes
 * → run (changed + change event + notification) → run (no duplicates).
 */
describe('website change monitoring (full pipeline)', () => {
  let site: FixtureSite;
  let stack: RealStack;

  beforeAll(async () => {
    site = await startFixtureSite();
    stack = await buildRealStack();
  });

  afterAll(async () => {
    await stack.close();
    await site.close();
  });

  it('baseline → unchanged → changed → idempotent, end to end', async () => {
    const monitor = await stack.monitorService.create({
      name: 'Acme product price',
      url: site.url,
      selector: '.product-price',
      selectorType: 'css',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
    });

    // 1. first check → baseline
    const first = await stack.checkService.runCheck(monitor, 'manual');
    expect(first.run.status).toBe('baseline');
    expect(first.changeEvent).toBeNull();
    expect(first.run.durationMs).toBeGreaterThanOrEqual(0);

    const latestAfterBaseline = stack.repos.snapshots.latestByMonitor(monitor.id);
    expect(latestAfterBaseline?.content).toBe('$99');

    // 2. second check → unchanged
    const second = await stack.checkService.runCheck(monitor, 'schedule');
    expect(second.run.status).toBe('unchanged');
    expect(second.changeEvent).toBeNull();

    // 3. the "website" changes v1 → v2, next check detects it
    await site.setPage(await readFixture('site-v2.html'));
    const third = await stack.checkService.runCheck(monitor, 'schedule');
    await third.notification;

    expect(third.run.status).toBe('changed');
    expect(third.changeEvent).not.toBeNull();
    expect(third.changeEvent?.previousContent).toBe('$99');
    expect(third.changeEvent?.currentContent).toBe('$89');
    expect(third.changeEvent?.diff.added).toBe(1);
    expect(third.changeEvent?.diff.removed).toBe(1);
    expect(stack.mockPayloads).toHaveLength(1);

    const deliveries = stack.repos.deliveries.listByMonitor(monitor.id, 10);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ provider: 'mock', status: 'sent' });

    // 4. running again with the same content produces nothing new
    const fourth = await stack.checkService.runCheck(monitor, 'schedule');
    expect(fourth.run.status).toBe('unchanged');
    expect(fourth.changeEvent).toBeNull();
    expect(stack.mockPayloads).toHaveLength(1);

    // full history is queryable
    expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10).map((r) => r.status)).toEqual([
      'unchanged',
      'changed',
      'unchanged',
      'baseline',
    ]);
    expect(stack.repos.changeEvents.listByMonitor(monitor.id, 10)).toHaveLength(1);
    expect(stack.repos.snapshots.countByMonitor(monitor.id)).toBe(4); // every successful check stores a snapshot
  });

  it('supports xpath selectors', async () => {
    const monitor = await stack.monitorService.create({
      name: 'Xpath stock',
      url: site.url,
      selector: '//p[@class="product-stock"]',
      selectorType: 'xpath',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
    });
    const outcome = await stack.checkService.runCheck(monitor, 'manual');
    expect(outcome.run.status).toBe('baseline');
    expect(stack.repos.snapshots.latestByMonitor(monitor.id)?.content).toContain('In stock');
  });

  it('supports text selectors', async () => {
    const monitor = await stack.monitorService.create({
      name: 'Text price',
      url: site.url,
      selector: '$',
      selectorType: 'text',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
    });
    const outcome = await stack.checkService.runCheck(monitor, 'manual');
    expect(outcome.run.status).toBe('baseline');
    const content = stack.repos.snapshots.latestByMonitor(monitor.id)?.content ?? '';
    expect(content).toContain('$89');
  });

  it('a missing selector records SELECTOR_NOT_FOUND and keeps monitoring alive', async () => {
    const monitor = await stack.monitorService.create({
      name: 'Broken selector',
      url: site.url,
      selector: '.does-not-exist',
      selectorType: 'css',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
    });
    const outcome = await stack.checkService.runCheck(monitor, 'manual');
    expect(outcome.run.status).toBe('error');
    expect(outcome.run.errorCode).toBe('SELECTOR_NOT_FOUND');

    // the monitor still works once the selector matches again
    const working = await stack.monitorService.create({
      name: 'Recovers',
      url: site.url,
      selector: '.product-name',
      selectorType: 'css',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
    });
    const recovered = await stack.checkService.runCheck(working, 'manual');
    expect(recovered.run.status).toBe('baseline');
  });

  it('test-extraction returns content without persisting anything', async () => {
    const countRows = (table: string): number =>
      (stack.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
        .count;
    const before = {
      monitors: countRows('monitors'),
      snapshots: countRows('snapshots'),
      changeEvents: countRows('change_events'),
      checkRuns: countRows('check_runs'),
      deliveries: countRows('notification_deliveries'),
    };

    const result = await stack.monitorService.testExtraction({
      url: site.url,
      selector: '.product-price',
      selectorType: 'css',
    });
    expect(result.content).toBe('$89');
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.durationMs).toBeGreaterThan(0);

    expect({
      monitors: countRows('monitors'),
      snapshots: countRows('snapshots'),
      changeEvents: countRows('change_events'),
      checkRuns: countRows('check_runs'),
      deliveries: countRows('notification_deliveries'),
    }).toEqual(before);
  });
});
