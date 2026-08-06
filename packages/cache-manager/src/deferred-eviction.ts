import type { InterceptorContext } from '@fluojs/http';

type RequestAbortState = Pick<
  InterceptorContext['requestContext']['request'],
  'isAborted' | 'signal'
>;

/**
 * Defers cache eviction until the response sender confirms a successful commit.
 *
 * @param response Active framework response whose send path owns commit-aware cleanup.
 * @param request Request cancellation surfaces used to discard eviction during shutdown or disconnect.
 * @param evict Cache eviction work to run after a successful commit.
 * @returns A cancellation function that restores the original response sender.
 */
export function installDeferredEviction(
  response: InterceptorContext['requestContext']['response'],
  request: RequestAbortState,
  evict: () => Promise<void>,
): () => void {
  const originalSend = response.send;
  const signal = request.signal;
  let restored = false;
  let completed = false;
  let abortListenerInstalled = false;

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
    response.send = originalSend;
    restored = true;
  };

  const cancel = () => {
    completed = true;
    restore();
  };

  response.send = async (body: unknown) => {
    try {
      await originalSend.call(response, body);
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

  if (signal) {
    signal.addEventListener('abort', cancel, { once: true });
    abortListenerInstalled = true;
  }

  if (requestAborted()) {
    cancel();
  }

  return cancel;
}
