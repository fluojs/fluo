import type { InterceptorContext } from '@fluojs/http';

const EVICTION_FALLBACK_TIMEOUT_MS = 5_000;

/**
 * Defers cache eviction until response commit while bounding adapter paths that never send.
 *
 * @param response Active framework response whose send path owns commit-aware cleanup.
 * @param evict Cache eviction work to run after a successful commit or fallback timeout.
 * @returns A cleanup function that restores the original response sender and clears the fallback timer.
 */
export function installDeferredEviction(
  response: InterceptorContext['requestContext']['response'],
  evict: () => Promise<void>,
): () => void {
  const originalSend = response.send.bind(response);
  let restored = false;
  let completed = false;
  let sendInvoked = false;

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

    clearTimeout(fallbackTimer);
    response.send = originalSend;
    restored = true;
  };

  const fallbackTimer = setTimeout(() => {
    // Run fallback eviction only when no response commit path was invoked.
    // If response.send(...) is still pending or already completed, the send
    // path owns eviction (on success) or cancellation (on failure), so the
    // fallback timer must not evict under a pending send.
    if (!sendInvoked) {
      runEviction();
    }

    restore();
  }, EVICTION_FALLBACK_TIMEOUT_MS);
  fallbackTimer.unref();

  response.send = async (body: unknown) => {
    sendInvoked = true;
    try {
      await originalSend(body);
      runEviction();
    } catch (error) {
      completed = true;
      throw error;
    } finally {
      restore();
    }
  };

  return restore;
}
