/**
 * Races a promise-returning function against an AbortSignal.
 * Rejects immediately if the signal is already aborted, or rejects as soon
 * as the signal fires while `fn` is still pending.
 *
 * The abort listener is always removed once `fn` settles, including when
 * `fn` throws synchronously before returning a promise. The synchronous
 * throw is converted into a settled rejection so the cleanup-dependent
 * `finally` flow still runs.
 *
 * @param fn Async operation to execute while observing the abort signal.
 * @param signal Abort signal that can cancel the in-flight operation.
 * @returns The resolved value from `fn` when no abort happens first.
 * @throws {Error} An `AbortError` when the signal is already aborted or aborts before `fn` settles. Re-throws the original error when `fn` throws synchronously.
 */
export async function raceWithAbort<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw createAbortError(signal.reason);
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError(signal.reason));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    // Convert `fn()` invocation into a settled promise so a synchronous
    // throw still flows through the `finally` cleanup that removes the
    // abort listener. `Promise.resolve()` only wraps an already-produced
    // value; it does not catch a throw emitted while `fn()` is invoked.
    let fnResultPromise: Promise<T>;
    try {
      fnResultPromise = Promise.resolve(fn());
    } catch (syncError) {
      fnResultPromise = Promise.reject(syncError);
    }

    fnResultPromise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/**
 * Normalises an abort reason into an `Error` with `name = 'AbortError'`.
 *
 * @param reason Abort reason attached to the triggering `AbortSignal`.
 * @returns A normalized `Error` instance with `name` set to `AbortError`.
 */
export function createAbortError(reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : 'Request aborted before response commit.';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
