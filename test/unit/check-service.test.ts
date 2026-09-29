import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors.js';
import { mapExtractionError } from '../../src/services/extraction-service.js';
import {
  buildStack,
  cleanupStack,
  constantExtraction,
  type ServiceStack,
} from '../helpers/test-stack.js';

function makeStack(): ServiceStack {
  return buildStack({ defaultNotificationProvider: 'mock' });
}

describe('CheckService (core pipeline)', () => {
  it('first run stores the baseline without a change event or notification', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('Product Price: $99\nIn stock'));

      const outcome = await stack.checkService.runCheck(monitor, 'manual');

      expect(outcome.run.status).toBe('baseline');
      expect(outcome.changeEvent).toBeNull();
      expect(stack.repos.snapshots.countByMonitor(monitor.id)).toBe(1);
      expect(stack.mockPayloads).toHaveLength(0);
      expect(outcome.notification).toBeNull();
    } finally {
      cleanupStack(stack);
    }
  });

  it('second run with identical content is unchanged', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('price $99\nstock yes'));

      const first = await stack.checkService.runCheck(monitor, 'schedule');
      const second = await stack.checkService.runCheck(monitor, 'schedule');

      expect(first.run.status).toBe('baseline');
      expect(second.run.status).toBe('unchanged');
      expect(second.changeEvent).toBeNull();
      expect(stack.repos.changeEvents.countByMonitor(monitor.id)).toBe(0);
    } finally {
      cleanupStack(stack);
    }
  });

  it('content change creates a change event with a diff and notifies', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('price $99'));
      await stack.checkService.runCheck(monitor, 'schedule');

      stack.setExtraction(constantExtraction('price $89'));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      expect(outcome.run.status).toBe('changed');
      expect(outcome.changeEvent).not.toBeNull();
      expect(outcome.changeEvent?.previousContent).toBe('price $99');
      expect(outcome.changeEvent?.currentContent).toBe('price $89');
      expect(outcome.changeEvent?.diff.added).toBe(1);
      expect(outcome.changeEvent?.diff.removed).toBe(1);
      expect(stack.mockPayloads).toHaveLength(1);
      expect(stack.mockPayloads[0]).toMatchObject({
        event: 'content_changed',
        monitor_id: monitor.id,
        previous_hash: outcome.changeEvent?.previousHash,
        current_hash: outcome.changeEvent?.currentHash,
      });
    } finally {
      cleanupStack(stack);
    }
  });

  it('stays unchanged after a change settles (no duplicate events)', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('A'));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(constantExtraction('B'));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(constantExtraction('B'));
      const third = await stack.checkService.runCheck(monitor, 'schedule');

      expect(third.run.status).toBe('unchanged');
      expect(third.changeEvent).toBeNull();
      expect(stack.mockPayloads).toHaveLength(1);
    } finally {
      cleanupStack(stack);
    }
  });

  it('A→B→A→B produces only one event per content state (idempotency)', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      const runWith = async (content: string) => {
        stack.setExtraction(constantExtraction(content));
        return stack.checkService.runCheck(monitor, 'schedule');
      };

      await runWith('A'); // baseline
      const toB = await runWith('B'); // changed, event for B
      const backToA = await runWith('A'); // changed vs B; event for A created
      const toBAgain = await runWith('B'); // changed vs A, but B already has an event

      expect(toB.changeEvent).not.toBeNull();
      expect(backToA.run.status).toBe('changed');
      expect(toBAgain.run.status).toBe('changed');
      expect(toBAgain.changeEvent).toBeNull(); // duplicate content state suppressed
      expect(toBAgain.notification).toBeNull(); // and no duplicate notification
      expect(stack.repos.changeEvents.countByMonitor(monitor.id)).toBe(2); // A and B once each
      await toB.notification;
      await backToA.notification;
      expect(stack.mockPayloads).toHaveLength(2);
    } finally {
      cleanupStack(stack);
    }
  });

  it('selector failures record an error run without touching snapshots', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('price $99'));
      await stack.checkService.runCheck(monitor, 'schedule');

      stack.setExtraction(() =>
        Promise.reject(new AppError('SELECTOR_NOT_FOUND', 'No element matches the selector.')),
      );
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');

      expect(outcome.run.status).toBe('error');
      expect(outcome.run.errorCode).toBe('SELECTOR_NOT_FOUND');
      expect(outcome.run.errorMessage).toBe('No element matches the selector.');
      // previous snapshot is preserved as "latest"
      expect(stack.repos.snapshots.latestByMonitor(monitor.id)?.content).toBe('price $99');
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(2);
    } finally {
      cleanupStack(stack);
    }
  });

  it('blocks private targets at check time even if the monitor row contains one', async () => {
    const stack = buildStack({ urlGuardOptions: { allowPrivateTargets: false } });
    try {
      const monitor = stack.createMonitor({ url: 'http://169.254.169.254/latest/meta-data' });
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      expect(outcome.run.status).toBe('error');
      expect(outcome.run.errorCode).toBe('URL_NOT_ALLOWED');
    } finally {
      cleanupStack(stack);
    }
  });

  it('every failed attempt still produces exactly one check_run', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(() =>
        Promise.reject(mapExtractionError(new Error('net::ERR_CONNECTION_REFUSED'))),
      );
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      expect(outcome.run.status).toBe('error');
      expect(outcome.run.errorCode).toBe('NETWORK_ERROR');
      const runs = stack.repos.checkRuns.listByMonitor(monitor.id, 10);
      expect(runs).toHaveLength(1);
    } finally {
      cleanupStack(stack);
    }
  });

  it('rejects concurrent checks of the same monitor, allows different monitors', async () => {
    const stack = makeStack();
    try {
      const monitorA = stack.createMonitor({ name: 'A', url: 'https://example.com/a' });
      const monitorB = stack.createMonitor({ name: 'B', url: 'https://example.com/b' });

      // Slow extraction for A keeps it "busy" while B runs.
      let releaseA: (() => void) | null = null;
      const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      stack.setExtraction((request) =>
        request.url === monitorA.url
          ? gateA.then(() => ({ content: 'A content', durationMs: 1 }))
          : Promise.resolve({ content: 'B content', durationMs: 1 }),
      );

      const first = stack.checkService.runCheck(monitorA, 'schedule');
      await Promise.resolve(); // let runCheck mark A busy

      expect(stack.checkService.isBusy(monitorA.id)).toBe(true);
      await expect(stack.checkService.runCheck(monitorA, 'manual')).rejects.toMatchObject({
        code: 'MONITOR_BUSY',
      });

      const outcomeB = await stack.checkService.runCheck(monitorB, 'manual');
      expect(outcomeB.run.status).toBe('baseline');

      releaseA?.();
      const outcomeA = await first;
      expect(outcomeA.run.status).toBe('baseline');
      expect(stack.checkService.isBusy(monitorA.id)).toBe(false);
    } finally {
      cleanupStack(stack);
    }
  });

  it('a crashing notification pipeline does not fail the check', async () => {
    const stack = makeStack();
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(constantExtraction('v1'));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(constantExtraction('v2'));

      // Corrupt the delivery repo to force a throw inside notifyChange.
      const original = stack.repos.deliveries.create.bind(stack.repos.deliveries);
      stack.repos.deliveries.create = () => {
        throw new Error('db exploded');
      };

      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      expect(outcome.run.status).toBe('changed');
      expect(outcome.changeEvent).not.toBeNull();
      await outcome.notification; // swallowed
      stack.repos.deliveries.create = original;
    } finally {
      cleanupStack(stack);
    }
  });
});
