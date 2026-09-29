import { describe, expect, it } from 'vitest';
import {
  buildStack,
  cleanupStack,
  constantExtraction,
} from '../helpers/test-stack.js';

describe('snapshot retention', () => {
  it('prunes oldest snapshots beyond the configured limit, keeping the newest', () => {
    const stack = buildStack();
    try {
      const monitor = stack.createMonitor();
      const insert = (id: string, checkedAt: string): void => {
        stack.repos.snapshots.insert({
          id,
          monitorId: monitor.id,
          contentHash: `hash-${id}`,
          content: `content ${id}`,
          checkedAt,
        });
      };
      insert('s1', '2026-09-30T10:00:00.000Z');
      insert('s2', '2026-09-30T10:01:00.000Z');
      insert('s3', '2026-09-30T10:02:00.000Z');
      insert('s4', '2026-09-30T10:03:00.000Z');
      insert('s5', '2026-09-30T10:04:00.000Z');

      const pruned = stack.repos.snapshots.pruneToLimit(monitor.id, 3);
      expect(pruned).toBe(2);

      const remaining = stack.repos.snapshots.listByMonitor(monitor.id, 10);
      expect(remaining.map((snapshot) => snapshot.id)).toEqual(['s5', 's4', 's3']);
      expect(stack.repos.snapshots.latestByMonitor(monitor.id)?.id).toBe('s5');
      expect(stack.repos.snapshots.countByMonitor(monitor.id)).toBe(3);
    } finally {
      cleanupStack(stack);
    }
  });

  it('keeps everything when under the limit and treats keep <= 0 as a no-op', () => {
    const stack = buildStack();
    try {
      const monitor = stack.createMonitor();
      stack.repos.snapshots.insert({
        id: 's1',
        monitorId: monitor.id,
        contentHash: 'h1',
        content: 'c1',
        checkedAt: '2026-09-30T10:00:00.000Z',
      });
      expect(stack.repos.snapshots.pruneToLimit(monitor.id, 5)).toBe(0);
      expect(stack.repos.snapshots.pruneToLimit(monitor.id, 0)).toBe(0);
      expect(stack.repos.snapshots.countByMonitor(monitor.id)).toBe(1);
    } finally {
      cleanupStack(stack);
    }
  });

  it('check pipeline applies retention while change events stay intact', async () => {
    const stack = buildStack({ maxSnapshotsPerMonitor: 3 });
    try {
      const monitor = stack.createMonitor();
      const runWith = async (content: string): Promise<void> => {
        stack.setExtraction(constantExtraction(content));
        const outcome = await stack.checkService.runCheck(monitor, 'schedule');
        if (outcome.notification !== null) {
          await outcome.notification;
        }
      };

      // 6 successful checks — A→B→A→B→C→D keeps 6 events but only 3 snapshots
      await runWith('A');
      await runWith('B');
      await runWith('A');
      await runWith('B');
      await runWith('C');
      await runWith('D');

      expect(stack.repos.snapshots.countByMonitor(monitor.id)).toBe(3);
      expect(stack.repos.snapshots.latestByMonitor(monitor.id)?.content).toBe('D');
      // the full change history is untouched by pruning
      expect(stack.repos.changeEvents.countByMonitor(monitor.id)).toBe(5);
      const firstEvent = stack.repos.changeEvents
        .listByMonitor(monitor.id, 10)
        .find((event) => event.currentContent === 'B' && event.previousContent === 'A');
      expect(firstEvent?.previousContent).toBe('A');
    } finally {
      cleanupStack(stack);
    }
  });
});
