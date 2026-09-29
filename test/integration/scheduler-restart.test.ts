import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from './helpers/fixture-site.js';
import { buildRealStack, type RealStack } from './helpers/real-stack.js';
import { Scheduler } from '../../src/scheduler/scheduler.js';
import { BoundedQueue } from '../../src/scheduler/queue.js';
import { silentLogger } from '../helpers/test-stack.js';

/**
 * Scheduler lifecycle against the real stack: automatic dispatch, restart
 * recovery (state derived from the database, no in-memory restart logic).
 */
describe('scheduler lifecycle (restart recovery)', () => {
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

  it('runs automatically, stops cleanly, and a new scheduler resumes from the DB', async () => {
    const created = await stack.monitorService.create({
      name: 'Auto-scheduled',
      url: site.url,
      selector: '.product-price',
      selectorType: 'css',
      checkIntervalSeconds: 60, // DB minimum; timing is driven by the injected clock
      enabled: true,
      webhookUrl: null,
      notifyEmail: null,
    });

    const firstScheduler = new Scheduler({
      monitorRepo: stack.repos.monitors,
      checkRunRepo: stack.repos.checkRuns,
      checkService: stack.checkService,
      queue: stack.queue,
      clock: stack.clock,
      logger: silentLogger(),
      tickMs: 60_000,
    });

    // never run → immediately due
    await firstScheduler.tickNow();
    await stack.queue.drain();
    expect(stack.repos.checkRuns.listByMonitor(created.id, 10)).toHaveLength(1);

    // interval not yet elapsed → tick dispatches nothing
    stack.clock.advance(30_000);
    await firstScheduler.tickNow();
    await stack.queue.drain();
    expect(stack.repos.checkRuns.listByMonitor(created.id, 10)).toHaveLength(1);

    // stop (drains) — "process restart"
    await firstScheduler.stop();

    const afterRestart = new Scheduler({
      monitorRepo: stack.repos.monitors,
      checkRunRepo: stack.repos.checkRuns,
      checkService: stack.checkService,
      queue: new BoundedQueue(3),
      clock: stack.clock,
      logger: silentLogger(),
      tickMs: 60_000,
    });

    // interval elapsed while "down" → the new scheduler resumes from DB state
    stack.clock.advance(31_000);
    await afterRestart.tickNow();
    await afterRestart.stop();
    expect(stack.repos.checkRuns.listByMonitor(created.id, 10)).toHaveLength(2);

    // disabled monitors are never auto-dispatched (manual runs stay allowed)
    await stack.monitorService.update(created.id, { enabled: false });
    stack.clock.advance(120_000);
    const third = new Scheduler({
      monitorRepo: stack.repos.monitors,
      checkRunRepo: stack.repos.checkRuns,
      checkService: stack.checkService,
      queue: new BoundedQueue(3),
      clock: stack.clock,
      logger: silentLogger(),
      tickMs: 60_000,
    });
    await third.tickNow();
    await third.stop();
    expect(stack.repos.checkRuns.listByMonitor(created.id, 10)).toHaveLength(2);
  });
});
