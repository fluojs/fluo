/**
 * Shared event-barrier helpers for the async-work package-guide fixtures.
 *
 * Tests must not use fixed sleeps or polling delays: handlers, workers, and
 * tasks signal through deferred promises, and every wait is bounded by a
 * reject timer so a stalled signal fails the test instead of hanging it.
 */

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Awaits `promise` but rejects with a descriptive error if it has not
 * settled within `budgetMs`. This bounds the wait; it does not poll or sleep.
 */
export async function boundedWait<T>(promise: Promise<T>, label: string, budgetMs = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`bounded wait exceeded ${String(budgetMs)}ms: ${label}`)), budgetMs);
    timer.unref();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
