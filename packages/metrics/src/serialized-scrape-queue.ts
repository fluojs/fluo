/** Observable state for package-internal serialized scrape scheduling. */
export interface SerializedScrapeQueueState {
  readonly isRunning: boolean;
  readonly queued: number;
}

/**
 * Serializes refresh-and-render scrape work while preserving individual results.
 *
 * Failed work does not poison later queue entries.
 */
export class SerializedScrapeQueue {
  private isRunning = false;
  private queued = 0;
  private tail: Promise<void> = Promise.resolve();

  get state(): SerializedScrapeQueueState {
    return {
      isRunning: this.isRunning,
      queued: this.queued,
    };
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const scrape = this.tail.then(async () => {
      this.queued -= 1;
      this.isRunning = true;

      try {
        return await task();
      } finally {
        this.isRunning = false;
      }
    });

    this.tail = scrape.then(
      () => undefined,
      () => undefined,
    );

    return scrape;
  }
}
