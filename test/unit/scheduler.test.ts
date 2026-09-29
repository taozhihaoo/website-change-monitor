import { describe, expect, it } from 'vitest';
import { BoundedQueue } from '../../src/scheduler/queue.js';
import { Scheduler } from '../../src/scheduler/scheduler.js';
import {
  buildStack,
  cleanupStack,
  constantExtraction,
  silentLogger,
  type ServiceStack,
} from '../helpers/test-stack.js';
import type { SchedulerDeps } from '../../src/scheduler/scheduler.js';
import type { Monitor } from '../../src/domain/types.js';
import { sleep } from '../../src/utils/clock.js';

function buildScheduler(stack: ServiceStack, tickMs = 10): { scheduler: Scheduler } {
  const queue = new BoundedQueue(4);
  const scheduler = new Scheduler({
    monitorRepo: stack.repos.monitors,
    checkRunRepo: stack.repos.checkRuns,
    checkService: stack.checkService,
    queue,
    clock: stack.clock,
    logger: silentLogger(),
    tickMs,
  } as SchedulerDeps);
  return { scheduler };
}

describe('Scheduler', () => {
  it('isDue: monitors that never ran are immediately due', () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor();
      expect(scheduler.isDue(monitor)).toBe(true);
    } finally {
      cleanupStack(stack);
    }
  });

  it('isDue: interval is measured from the last run start (injected clock)', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor({ checkIntervalSeconds: 300 });
      stack.setExtraction(constantExtraction('content'));

      await scheduler.tickNow(); // dispatches the first check
      await scheduler.stop();

      // just after the first run: not due yet
      stack.clock.advance(299_000);
      expect(scheduler.isDue(monitor)).toBe(false);

      stack.clock.advance(2_000); // past 300s
      expect(scheduler.isDue(monitor)).toBe(true);
    } finally {
      cleanupStack(stack);
    }
  });

  it('failed runs also count toward the interval (no error storms)', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor({ checkIntervalSeconds: 60 });
      stack.setExtraction(() => Promise.reject(new Error('SELECTOR gone')));
      await scheduler.tickNow();
      await scheduler.stop();

      stack.clock.advance(30_000);
      expect(scheduler.isDue(monitor)).toBe(false);
      stack.clock.advance(31_000);
      expect(scheduler.isDue(monitor)).toBe(true);
    } finally {
      cleanupStack(stack);
    }
  });

  it('tick dispatches due enabled monitors only', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const active = stack.createMonitor({ url: 'https://example.com/active' });
      const disabled = stack.createMonitor({
        url: 'https://example.com/disabled',
        enabled: false,
      });
      stack.setExtraction((request) =>
        Promise.resolve({ content: `content for ${request.url}`, durationMs: 1 }),
      );

      await scheduler.tickNow();
      await scheduler.stop();

      expect(stack.repos.checkRuns.listByMonitor(active.id, 10)).toHaveLength(1);
      expect(stack.repos.checkRuns.listByMonitor(disabled.id, 10)).toHaveLength(0);
    } finally {
      cleanupStack(stack);
    }
  });

  it('a monitor is never dispatched twice in parallel (duplicate execution prevention)', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor({ checkIntervalSeconds: 60 });

      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stack.setExtraction(() => gate.then(() => ({ content: 'slow', durationMs: 1 })));

      await scheduler.tickNow(); // dispatch #1 (in flight, gated)
      stack.clock.advance(10 * 60_000); // make it due again
      await scheduler.tickNow(); // must NOT dispatch a second run

      // stop() drains: it must still be waiting on the gated check
      const stopping = scheduler.stop();
      await sleep(20);
      const status = scheduler.status();
      expect(status.activeChecks + status.queuedChecks).toBeLessThanOrEqual(1);
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(0); // still running

      release?.();
      await stopping;
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(1);
    } finally {
      cleanupStack(stack);
    }
  });

  it('one failing monitor does not affect other monitors', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const bad = stack.createMonitor({ url: 'https://example.com/bad' });
      const good = stack.createMonitor({ url: 'https://example.com/good' });
      stack.setExtraction((request) =>
        request.url.endsWith('/bad')
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ content: 'fine', durationMs: 1 }),
      );

      await scheduler.tickNow();
      await scheduler.stop();

      const badRuns = stack.repos.checkRuns.listByMonitor(bad.id, 10);
      const goodRuns = stack.repos.checkRuns.listByMonitor(good.id, 10);
      expect(badRuns).toHaveLength(1);
      expect(badRuns[0]?.status).toBe('error');
      expect(goodRuns).toHaveLength(1);
      expect(goodRuns[0]?.status).toBe('baseline');
    } finally {
      cleanupStack(stack);
    }
  });

  it('runNow checks immediately (even for disabled monitors) and returns the outcome', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor: Monitor = stack.createMonitor({ enabled: false });
      stack.setExtraction(constantExtraction('manual content'));

      const outcome = await scheduler.runNow(monitor);
      expect(outcome.run.status).toBe('baseline');
      expect(outcome.run.triggeredBy).toBe('manual');
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(1);
    } finally {
      cleanupStack(stack);
    }
  });

  it('runNow surfaces MONITOR_BUSY while a check is already running', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor();
      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stack.setExtraction(() => gate.then(() => ({ content: 'slow', durationMs: 1 })));

      const scheduled = scheduler.runNow(monitor);
      await sleep(5);
      await expect(scheduler.runNow(monitor)).rejects.toMatchObject({ code: 'MONITOR_BUSY' });
      release?.();
      await scheduled;
    } finally {
      cleanupStack(stack);
    }
  });

  it('stop() drains in-flight checks before resolving', async () => {
    const stack = buildStack();
    try {
      const { scheduler } = buildScheduler(stack);
      const monitor = stack.createMonitor();
      stack.setExtraction(async () => {
        await sleep(30);
        return { content: 'late content', durationMs: 30 };
      });

      await scheduler.tickNow();
      const stopped = scheduler.stop();
      // runCheck may still be in flight; stop must wait for it
      await stopped;
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(1);
    } finally {
      cleanupStack(stack);
    }
  });
});
