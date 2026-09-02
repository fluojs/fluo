import { Module, type Constructor } from '@fluojs/core';

/**
 * Module class accepted by the Fluo runtime module graph.
 */
export type PrismaModuleType = Constructor;

/**
 * Defines the lifecycle hook invoked after module initialization.
 */
export interface OnModuleInit {
  onModuleInit(): Promise<void> | void;
}

/**
 * Defines the lifecycle hook invoked during application shutdown.
 */
export interface OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> | void;
}

/**
 * Defines one active request transaction.
 */
export type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

/**
 * Defines one active request transaction registration.
 */
export type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

/**
 * Creates a module class with metadata consumed by the runtime module graph.
 *
 * @param definition Module composition metadata.
 * @returns A new module class carrying the supplied metadata.
 */
export function definePrismaModule(
  definition: Parameters<typeof Module>[0],
): PrismaModuleType {
  @Module(definition)
  class PrismaModuleDefinition {}

  return PrismaModuleDefinition;
}

/**
 * Races an operation against an abort signal.
 *
 * @param fn Async operation to execute while observing the abort signal.
 * @param signal Abort signal that can cancel the operation.
 * @returns The resolved value from `fn` when no abort happens first.
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
 * Normalizes an abort reason into an AbortError.
 *
 * @param reason Abort reason attached to the triggering signal.
 * @returns A normalized abort error.
 */
export function createAbortError(reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : 'Request aborted before response commit.';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Creates an abort context that forwards an optional caller signal.
 *
 * @param signal Optional caller-owned abort signal.
 * @returns The owned controller, signal, and listener cleanup.
 */
export function createRequestAbortContext(signal?: AbortSignal): {
  controller: AbortController;
  cleanup(): void;
  signal: AbortSignal;
} {
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
 * Tracks a request transaction until its caller settles it.
 *
 * @param activeRequestTransactions Active request transaction set.
 * @param controller Controller used to abort the transaction.
 * @returns The tracked transaction and its settlement function.
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
 * Stops tracking a settled request transaction.
 *
 * @param activeRequestTransactions Active request transaction set.
 * @param handle Transaction registration to remove.
 */
export function untrackActiveRequestTransaction(
  activeRequestTransactions: Set<ActiveRequestTransaction>,
  handle: ActiveRequestTransactionHandle,
): void {
  activeRequestTransactions.delete(handle.active);
  handle.settle();
}
