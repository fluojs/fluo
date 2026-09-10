import type { Application, ApplicationLogger } from '@fluojs/runtime';
import type { HttpAdapterShutdownRegistration } from '@fluojs/runtime/internal/http-adapter';

/** Signals accepted by the Node host shutdown registration. */
export type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 30_000;

/**
 * Returns the default POSIX shutdown signals used by Node-hosted runtime helpers.
 *
 * @returns The ordered list of signals that trigger graceful shutdown registration.
 */
export function defaultNodeShutdownSignals(): readonly NodeShutdownSignal[] {
  return ['SIGINT', 'SIGTERM'];
}

/**
 * Creates shutdown registration logic for Node-hosted adapters.
 *
 * The returned registration preserves graceful shutdown semantics while leaving
 * final process termination ownership to the surrounding host/runtime.
 *
 * @param signals Signals to register, or `false` to disable signal handling.
 * @returns Registration callback supplied to `FluoFactory.create(..., { shutdownRegistration })`.
 */
export function createNodeShutdownSignalRegistration(
  signals: false | readonly NodeShutdownSignal[] = defaultNodeShutdownSignals(),
): HttpAdapterShutdownRegistration {
  return (app, logger, forceExitTimeoutMs) => registerShutdownSignals(
    app,
    logger,
    signals,
    forceExitTimeoutMs,
  );
}

/**
 * Registers process signal handlers that attempt graceful shutdown.
 *
 * When the shutdown timeout elapses, the helper records failure via logging and
 * `process.exitCode` but does not terminate the host process directly.
 *
 * @param app Application instance to close when a signal arrives.
 * @param logger Logger used for shutdown diagnostics.
 * @param signals Signals to bind, or `false` to skip registration.
 * @param forceExitTimeoutMs Timeout window used to mark shutdown as failed.
 * @returns Unregister callback that removes the installed signal handlers.
 */
export function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly NodeShutdownSignal[],
  forceExitTimeoutMs: number = DEFAULT_FORCE_EXIT_TIMEOUT_MS,
): () => void {
  if (signals === false) {
    return () => {};
  }

  const bindings: Array<{ signal: NodeShutdownSignal; handler: () => void }> = [];
  const unregister = () => {
    const errors: unknown[] = [];
    for (const binding of bindings) {
      try {
        process.off(binding.signal, binding.handler);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Failed to unregister Node shutdown signals.');
  };

  try {
    for (const signal of signals) {
      const handler = () => {
        void closeFromSignal(app, logger, signal, forceExitTimeoutMs);
      };
      bindings.push({ signal, handler });
      process.once(signal, handler);
    }
  } catch (error) {
    try {
      unregister();
    } catch (cleanupError) {
      try {
        logger.error('Failed to roll back Node shutdown signal registration.', cleanupError, 'FluoFactory');
      } catch {
        throw error;
      }
    }
    throw error;
  }

  return unregister;
}

async function closeFromSignal(app: Application, logger: ApplicationLogger, signal: NodeShutdownSignal, forceExitTimeoutMs: number): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }

  let timedOut = false;
  const forceExitTimer = setTimeout(() => {
    timedOut = true;
    logger.error(
      `Shutdown timeout exceeded after ${String(forceExitTimeoutMs)}ms; leaving process termination to the host.`,
      undefined,
      'FluoFactory',
    );
    process.exitCode = 1;
  }, forceExitTimeoutMs);

  if (forceExitTimer.unref) {
    forceExitTimer.unref();
  }

  try {
    await app.close(signal);
    clearTimeout(forceExitTimer);

    if (!timedOut) {
      process.exitCode = 0;
    }
  } catch (error: unknown) {
    clearTimeout(forceExitTimer);
    logger.error('Failed to shut down the application cleanly.', error, 'FluoFactory');
    process.exitCode = 1;
  }
}
