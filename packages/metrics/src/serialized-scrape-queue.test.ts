import { describe, expect, it } from 'vitest';

import { SerializedScrapeQueue } from './serialized-scrape-queue.js';

type Deferred<T> = {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let rejectPromise: (reason?: unknown) => void = () => {
    throw new Error('Deferred rejection was not initialized.');
  };
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('Deferred resolution was not initialized.');
  };
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject(reason: unknown) {
      rejectPromise(reason);
    },
    resolve(value: T) {
      resolvePromise(value);
    },
  };
}

describe('SerializedScrapeQueue', () => {
  it('does not enter a queued scrape until the active scrape releases', async () => {
    const queue = new SerializedScrapeQueue();
    const firstEntered = createDeferred<void>();
    const firstReleased = createDeferred<void>();
    const secondEntered = createDeferred<void>();
    const order: string[] = [];

    const firstScrape = queue.enqueue(async () => {
      order.push('first:entered');
      firstEntered.resolve();
      await firstReleased.promise;
      order.push('first:completed');
      return 'first';
    });

    await firstEntered.promise;

    const secondScrape = queue.enqueue(async () => {
      order.push('second:entered');
      secondEntered.resolve();
      return 'second';
    });

    expect(order).toEqual(['first:entered']);
    expect(queue.state).toEqual({ isRunning: true, queued: 1 });

    firstReleased.resolve();
    await secondEntered.promise;

    expect(order).toEqual(['first:entered', 'first:completed', 'second:entered']);
    await expect(firstScrape).resolves.toBe('first');
    await expect(secondScrape).resolves.toBe('second');
    expect(queue.state).toEqual({ isRunning: false, queued: 0 });
  });

  it('continues with later scrapes after a rejected scrape', async () => {
    const queue = new SerializedScrapeQueue();
    const failure = new Error('refresh failed');

    await expect(queue.enqueue(async () => {
      throw failure;
    })).rejects.toBe(failure);

    await expect(queue.enqueue(async () => 'retry')).resolves.toBe('retry');
    expect(queue.state).toEqual({ isRunning: false, queued: 0 });
  });

  it('drains work appended after the observed tail before finalizing', async () => {
    const queue = new SerializedScrapeQueue();
    const firstEntered = createDeferred<void>();
    const firstReleased = createDeferred<void>();
    const secondEntered = createDeferred<void>();
    const secondReleased = createDeferred<void>();
    const finalized = createDeferred<void>();

    const first = queue.enqueue(async () => {
      firstEntered.resolve();
      await firstReleased.promise;
    });
    await firstEntered.promise;

    const draining = queue.drain(() => {
      finalized.resolve();
    });
    const second = queue.enqueue(async () => {
      secondEntered.resolve();
      await secondReleased.promise;
    });

    firstReleased.resolve();
    await secondEntered.promise;
    expect(queue.state).toEqual({ isRunning: true, queued: 0 });

    secondReleased.resolve();
    await Promise.all([first, second, draining, finalized.promise]);
    expect(queue.state).toEqual({ isRunning: false, queued: 0 });
  });

  it('drains queued recovery work after a rejected scrape before finalizing', async () => {
    const queue = new SerializedScrapeQueue();
    const firstEntered = createDeferred<void>();
    const firstReleased = createDeferred<void>();
    const retryEntered = createDeferred<void>();
    const retryReleased = createDeferred<void>();
    const failure = new Error('refresh failed');
    let finalized = false;

    const first = queue.enqueue(async () => {
      firstEntered.resolve();
      await firstReleased.promise;
      throw failure;
    });
    await firstEntered.promise;

    const draining = queue.drain(() => {
      finalized = true;
    });
    const retry = queue.enqueue(async () => {
      retryEntered.resolve();
      await retryReleased.promise;
      return 'retry';
    });

    firstReleased.resolve();
    await retryEntered.promise;
    expect(finalized).toBe(false);

    retryReleased.resolve();
    await expect(first).rejects.toBe(failure);
    await expect(retry).resolves.toBe('retry');
    await draining;
    expect(finalized).toBe(true);
  });
});
