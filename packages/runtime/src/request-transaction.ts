export type RequestAbortContext = {
  controller: AbortController;
  cleanup(): void;
  signal: AbortSignal;
};

export type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

export type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

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

export function untrackActiveRequestTransaction(
  activeRequestTransactions: Set<ActiveRequestTransaction>,
  handle: ActiveRequestTransactionHandle,
): void {
  activeRequestTransactions.delete(handle.active);
  handle.settle();
}
