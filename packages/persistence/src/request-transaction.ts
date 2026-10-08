/**
 * Defines the request abort context type.
 */
export type RequestAbortContext = {
  controller: AbortController;
  cleanup(): void;
  signal: AbortSignal;
};

/**
 * Defines the active request transaction type.
 */
export type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

/**
 * Defines the active request transaction handle type.
 */
export type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

/**
 * Create request abort context.
 *
 * @param signal The signal.
 * @returns The create request abort context result.
 */
export function createRequestAbortContext(signal?: AbortSignal): RequestAbortContext {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    forwardAbort();
  } else {
    signal?.addEventListener('abort', forwardAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      signal?.removeEventListener('abort', forwardAbort);
    },
    signal: controller.signal,
  };
}

/**
 * Track active request transaction.
 *
 * @param activeRequestTransactions The active request transactions.
 * @param controller The controller.
 * @returns The track active request transaction result.
 */
export function trackActiveRequestTransaction(
  activeRequestTransactions: Set<ActiveRequestTransaction>,
  controller: AbortController,
): ActiveRequestTransactionHandle {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const active: ActiveRequestTransaction = {
    abort(reason?: unknown) {
      controller.abort(reason);
    },
    settled,
  };

  activeRequestTransactions.add(active);

  return { active, settle };
}

/**
 * Untrack active request transaction.
 *
 * @param activeRequestTransactions The active request transactions.
 * @param handle The handle.
 */
export function untrackActiveRequestTransaction(
  activeRequestTransactions: Set<ActiveRequestTransaction>,
  handle: ActiveRequestTransactionHandle,
): void {
  activeRequestTransactions.delete(handle.active);
  handle.settle();
}
