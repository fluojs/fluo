/**
 * Races a promise-returning function against an AbortSignal.
 * Rejects immediately if the signal is already aborted, or rejects as soon
 * as the signal fires while `fn` is still pending.
 *
 * @param fn Async operation to execute while observing the abort signal.
 * @param signal Abort signal that can cancel the in-flight operation.
 * @returns The resolved value from `fn` when no abort happens first.
 * @throws {Error} An `AbortError` when the signal is already aborted or aborts before `fn` settles.
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

    Promise.resolve(fn()).then(resolve, reject).finally(() => {
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
