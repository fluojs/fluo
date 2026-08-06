import type { InterceptorContext } from '@fluojs/http';

const EVICTION_FALLBACK_TIMEOUT_MS = 5_000;

type RequestAbortState = Pick<
  InterceptorContext['requestContext']['request'],
  'isAborted' | 'signal'
>;

/**
 * Defers cache eviction until a response writer or bounded fallback confirms commit.
 *
 * @param response Active framework response whose writers and committed flag own cleanup.
 * @param request Request cancellation surfaces used to discard eviction during shutdown or disconnect.
 * @param evict Cache eviction work to run after a confirmed successful commit.
 * @returns A cancellation function that restores the response writers and clears the fallback timer.
 */
export function installDeferredEviction(
  response: InterceptorContext['requestContext']['response'],
  request: RequestAbortState,
  evict: () => Promise<void>,
): () => void {
  const originalSend = response.send;
  const originalSimpleJsonSend: unknown = Reflect.get(response, 'sendSimpleJson');
  const signal = request.signal;
  let restored = false;
  let completed = false;
  let abortListenerInstalled = false;
  let responseWriteStarted = false;

  const requestAborted = () => signal?.aborted === true || request.isAborted?.() === true;

  const runEviction = () => {
    if (completed) {
      return;
    }

    completed = true;
    void evict().catch(() => {
    });
  };

  const restore = () => {
    if (restored) {
      return;
    }

    if (abortListenerInstalled) {
      signal?.removeEventListener('abort', cancel);
    }
    clearTimeout(fallbackTimer);
    response.send = originalSend;
    if (typeof originalSimpleJsonSend === 'function') {
      Reflect.set(response, 'sendSimpleJson', originalSimpleJsonSend);
    }
    restored = true;
  };

  const cancel = () => {
    completed = true;
    restore();
  };

  const runResponseWrite = async (write: () => unknown) => {
    responseWriteStarted = true;
    try {
      await write();
      if (requestAborted()) {
        cancel();
      } else if (response.committed) {
        runEviction();
      } else {
        cancel();
      }
    } catch (error) {
      cancel();
      throw error;
    } finally {
      restore();
    }
  };

  response.send = (body: unknown) => runResponseWrite(() => originalSend.call(response, body));

  if (typeof originalSimpleJsonSend === 'function') {
    Reflect.set(response, 'sendSimpleJson', (body: unknown) => {
      return runResponseWrite(() => Reflect.apply(originalSimpleJsonSend, response, [body]));
    });
  }

  const fallbackTimer = setTimeout(() => {
    if (!responseWriteStarted && !requestAborted() && response.committed) {
      runEviction();
    }

    restore();
  }, EVICTION_FALLBACK_TIMEOUT_MS);
  fallbackTimer.unref();

  if (signal) {
    signal.addEventListener('abort', cancel, { once: true });
    abortListenerInstalled = true;
  }

  if (requestAborted()) {
    cancel();
  }

  return cancel;
}
