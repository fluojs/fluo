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
 * Creates an independently cancellable request context that forwards caller cancellation.
 *
 * @param signal Optional caller signal whose cancellation is forwarded with the same reason object.
 * @returns A local controller and its signal, plus idempotent cleanup that stops further caller forwarding.
 * @remarks Earlier caller listeners cannot suppress forwarding by stopping event propagation.
 * Local cancellation never aborts the caller signal, and cleanup does not abort either signal.
 */
export function createRequestAbortContext(signal?: AbortSignal): RequestAbortContext {
  const controller = new AbortController();
  // Observe a private dependent signal so caller listeners cannot suppress our abort event.
  const forwardingSignal = signal && AbortSignal.any([signal]);
  const forwardAbort = () => controller.abort(forwardingSignal?.reason);

  if (forwardingSignal?.aborted) {
    forwardAbort();
  } else {
    forwardingSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      forwardingSignal?.removeEventListener('abort', forwardAbort);
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
