import { describe, expect, it } from 'vitest';
import { BoundedQueue } from '../../src/scheduler/queue.js';
import { sleep } from '../../src/utils/clock.js';

describe('BoundedQueue (global concurrency limit)', () => {
  it('never exceeds the concurrency limit with many queued tasks', async () => {
    const queue = new BoundedQueue(5);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 20 }, () => () =>
      Promise.resolve().then(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await sleep(10);
        running -= 1;
      }),
    );
    await Promise.all(tasks.map((task) => queue.submit(task)));

    expect(maxRunning).toBe(5);
    expect(queue.activeCount).toBe(0);
    expect(queue.waitingCount).toBe(0);
  });

  it('runs higher-priority tasks first while keeping FIFO order within a priority', async () => {
    const queue = new BoundedQueue(1);
    const order: string[] = [];
    const releaseFirst = new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    const blocking = queue.submit(() => releaseFirst.then(() => undefined), 0);
    const low1 = queue.submit(async () => {
      order.push('low1');
    }, 0);
    const low2 = queue.submit(async () => {
      order.push('low2');
    }, 0);
    const urgent = queue.submit(async () => {
      order.push('urgent');
    }, 10);

    await Promise.all([blocking, low1, low2, urgent]);
    expect(order).toEqual(['urgent', 'low1', 'low2']);
  });

  it('a rejecting task does not stop other tasks', async () => {
    const errors: unknown[] = [];
    const queue = new BoundedQueue(2, (err) => errors.push(err));
    const results: string[] = [];

    await Promise.allSettled([
      queue.submit(async () => {
        throw new Error('task A failed');
      }),
      queue.submit(async () => {
        results.push('B');
      }),
      queue.submit(async () => {
        results.push('C');
      }),
    ]);

    expect(results.sort()).toEqual(['B', 'C']);
    expect(errors).toHaveLength(1);
  });

  it('drain() waits until everything settles', async () => {
    const queue = new BoundedQueue(3);
    const done: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const taskId = index;
      void queue.submit(async () => {
        await sleep(5);
        done.push(taskId);
      });
    }
    await queue.drain();
    expect(done).toHaveLength(9);
    expect(queue.activeCount).toBe(0);
    expect(queue.waitingCount).toBe(0);
  });

  it('submit returns the task result (used by run-now)', async () => {
    const queue = new BoundedQueue(2);
    const result = await queue.submit(async () => 'value', 10);
    expect(result).toBe('value');
  });
});
