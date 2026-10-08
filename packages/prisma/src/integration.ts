import { Module, type Constructor, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { MiddlewareLike } from '@fluojs/http';

type PrismaModuleDefinition = Parameters<typeof Module>[0] & {
  controllers?: Constructor[];
  exports?: Token[];
  imports?: PrismaModuleType[];
  middleware?: MiddlewareLike[];
  providers?: Provider[];
};

/**
 * Module class accepted by the Fluo runtime module graph.
 */
export type PrismaModuleType = Constructor & {
  definition?: PrismaModuleDefinition;
};

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
 * Creates a module class with metadata consumed by the runtime module graph.
 *
 * @param definition Module composition metadata.
 * @param moduleName Constructor name used by runtime diagnostics.
 * @returns A new module class carrying the supplied metadata.
 */
export function definePrismaModule(
  definition: Parameters<typeof Module>[0],
  moduleName: string,
): PrismaModuleType {
  const moduleType = {
    [moduleName]: class {},
  }[moduleName];

  Module(definition)(moduleType, {
    addInitializer() {},
    kind: 'class',
    metadata: {},
    name: moduleName,
  });

  return moduleType;
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

export {
  type ActiveRequestTransaction,
  type ActiveRequestTransactionHandle,
  createRequestAbortContext,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/persistence';
