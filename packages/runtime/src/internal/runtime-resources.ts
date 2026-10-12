import type { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http/portable';

import { createLifecycleCloseError, type RetryableShutdownState } from '../retryable-shutdown.js';
import type { ApplicationLogger, CompiledModule, RuntimeCleanupRegistration } from '../types.js';
import { hasMethod, resetReadinessState, runShutdownHooks } from './lifecycle.js';

/**
 * An awaited runtime-owned cleanup registration.
 *
 * @internal
 */
export type RuntimeCleanupCallback = Parameters<RuntimeCleanupRegistration>[0];

// Factory owns partial acquisition until assembly succeeds. The returned shell
// owns this resource set; its admission and retry state stay shell-local.
/**
 * Acquired runtime resources transferred from Factory to the returned shell.
 *
 * @internal
 */
export interface RuntimeResources {
  readonly container: Container;
  readonly modules: CompiledModule[];
  readonly lifecycleInstances: unknown[];
  readonly runtimeCleanup: RuntimeCleanupCallback[];
}

async function disposeContainer(container: Container): Promise<void> {
  if (!hasMethod(container, 'dispose')) {
    return;
  }

  await container.dispose();
}

async function runCleanupCallbacks(cleanups: readonly RuntimeCleanupCallback[]): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}

/**
 * Registers awaited cleanup callbacks owned by one runtime shell.
 *
 * @internal
 * @param cleanups Runtime-owned registrations in declaration order.
 * @returns Registration and removal for this runtime resource set.
 */
export function createRuntimeCleanupRegistration(cleanups: RuntimeCleanupCallback[]): RuntimeCleanupRegistration {
  return (cleanup) => {
    cleanups.push(cleanup);

    return () => {
      const index = cleanups.indexOf(cleanup);

      if (index >= 0) {
        cleanups.splice(index, 1);
      }
    };
  };
}

/**
 * Independently retryable phases of runtime teardown.
 *
 * @internal
 */
export type RuntimeShutdownPhase = 'adapter' | 'container' | 'hooks' | 'readiness' | 'runtime-cleanup';

/**
 * Retries only incomplete runtime teardown phases in contract order.
 *
 * @internal
 * @param options Acquired resources and phase-specific cleanup inputs.
 * @returns Settlement of the runtime-owned operation.
 */
export async function closeRuntimeResources(options: {
  adapter?: HttpApplicationAdapter;
  container: Container;
  lifecycleInstances: readonly unknown[];
  modules: CompiledModule[];
  runtimeCleanup: readonly RuntimeCleanupCallback[];
  shutdownState: RetryableShutdownState<RuntimeShutdownPhase>;
  signal?: string;
}): Promise<void> {
  const errors: unknown[] = [];

  if (!options.shutdownState.isComplete('readiness')) {
    resetReadinessState(options.modules);
    options.shutdownState.complete('readiness');
  }

  if (!options.shutdownState.isComplete('runtime-cleanup')) {
    const cleanupErrors = await runCleanupCallbacks(options.runtimeCleanup);

    if (cleanupErrors.length === 0) {
      options.shutdownState.complete('runtime-cleanup');
    } else {
      errors.push(...cleanupErrors);
    }
  }

  if (!options.shutdownState.isComplete('hooks')) {
    try {
      await runShutdownHooks(options.lifecycleInstances, options.signal);
      options.shutdownState.complete('hooks');
    } catch (error) {
      errors.push(error);
    }
  }

  if (!options.shutdownState.isComplete('adapter')) {
    try {
      await options.adapter?.close(options.signal);
      options.shutdownState.complete('adapter');
    } catch (error) {
      errors.push(error);
    }
  }

  if (!options.shutdownState.isComplete('container')) {
    try {
      await disposeContainer(options.container);
      options.shutdownState.complete('container');
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw createLifecycleCloseError(errors);
  }
}

/**
 * Attempts acquired-resource cleanup while reporting failures separately.
 *
 * @internal
 * @param options Acquired resources and phase-specific cleanup inputs.
 * @returns Settlement of the runtime-owned operation.
 */
export async function runBootstrapFailureCleanup(options: {
  adapter?: HttpApplicationAdapter;
  container?: Container;
  lifecycleInstances: readonly unknown[];
  logger: ApplicationLogger;
  modules: CompiledModule[];
  runtimeCleanup: readonly RuntimeCleanupCallback[];
  scope: 'application' | 'application context';
}): Promise<void> {
  const errors: unknown[] = [];

  resetReadinessState(options.modules);

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  if (options.lifecycleInstances.length > 0) {
    try {
      await runShutdownHooks(options.lifecycleInstances, 'bootstrap-failed');
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await options.adapter?.close('bootstrap-failed');
  } catch (error) {
    errors.push(error);
  }

  if (options.container) {
    try {
      await disposeContainer(options.container);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const error of errors) {
    options.logger.error(
      `Failed to clean up after ${options.scope} bootstrap failure.`,
      error,
      'FluoFactory',
    );
  }
}
