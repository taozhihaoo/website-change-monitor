interface QueuedTask {
  execute: () => Promise<unknown>;
  priority: number;
  seq: number;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * A small FIFO queue with a hard concurrency limit. Manual runs can pass a
 * higher priority to jump ahead of scheduled work. Exactly `limit` tasks run
 * at any moment; everything else waits.
 */
export class BoundedQueue {
  private active = 0;
  private waiting: QueuedTask[] = [];
  private seqCounter = 0;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    public readonly limit: number,
    private readonly onError?: (err: unknown) => void,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  submit<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueuedTask = {
        execute: task as () => Promise<unknown>,
        priority,
        seq: this.seqCounter,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.seqCounter += 1;

      // Higher priority first; stable FIFO within the same priority.
      const insertAt = this.waiting.findIndex((existing) => existing.priority < priority);
      if (insertAt === -1) {
        this.waiting.push(entry);
      } else {
        this.waiting.splice(insertAt, 0, entry);
      }
      this.pump();
    });
  }

  /**
   * Resolves when every accepted task has settled. Used for graceful
   * shutdown and for deterministic tests.
   */
  async drain(): Promise<void> {
    while (this.active > 0 || this.waiting.length > 0) {
      const snapshot = [...this.inFlight];
      if (snapshot.length === 0) {
        return;
      }
      await Promise.allSettled(snapshot);
    }
  }

  private pump(): void {
    while (this.active < this.limit && this.waiting.length > 0) {
      const entry = this.waiting.shift();
      if (!entry) {
        return;
      }
      this.active += 1;
      const running: Promise<void> = entry
        .execute()
        .then(
          (value) => entry.resolve(value),
          (err: unknown) => {
            this.onError?.(err);
            entry.reject(err);
          },
        )
        .finally(() => {
          this.active -= 1;
          this.inFlight.delete(running);
          this.pump();
        });
      this.inFlight.add(running);
    }
  }
}
