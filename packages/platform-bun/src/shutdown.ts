import type { Application, ApplicationLogger, HttpAdapterShutdownRegistration } from '@fluojs/runtime';

/** Signals accepted by the Bun host shutdown registration. */
export type BunShutdownSignal = 'SIGINT' | 'SIGTERM';

/**
 * Creates Bun-owned signal registration for `FluoFactory.create(...)`.
 *
 * @param signals Signals to register, or false to leave shutdown to the caller.
 * @returns A registration callback with the former run helper's 30-second host bound.
 */
export function createBunShutdownSignalRegistration(
  signals: false | readonly BunShutdownSignal[] = ['SIGINT', 'SIGTERM'],
): HttpAdapterShutdownRegistration {
  return (app, logger, forceExitTimeoutMs = 30_000) => {
    if (!Number.isInteger(forceExitTimeoutMs) || forceExitTimeoutMs < 0) {
      const error = new Error(`Invalid forceExitTimeoutMs value: ${String(forceExitTimeoutMs)}. Expected a non-negative integer.`);
      Object.defineProperty(error, 'code', { enumerable: true, value: 'BUN_ADAPTER_INVALID_OPTION' });
      throw error;
    }
    if (signals === false) return () => {};

    const bindings: Array<{ signal: BunShutdownSignal; handler: () => void }> = [];
    const unregister = () => {
      const errors: unknown[] = [];
      for (const { signal, handler } of bindings) {
        try {
          process.off(signal, handler);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Failed to unregister Bun shutdown signals.');
    };
    try {
      for (const signal of signals) {
        const handler = () => { void closeFromSignal(app, logger, signal, forceExitTimeoutMs); };
        bindings.push({ signal, handler });
        process.once(signal, handler);
      }
    } catch (error) {
      try {
        unregister();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Failed to register Bun shutdown signals and roll back registered listeners.');
      }
      throw error;
    }
    return unregister;
  };
}

async function closeFromSignal(
  app: Application,
  logger: ApplicationLogger,
  signal: BunShutdownSignal,
  timeoutMs: number,
): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logger.error(
      `Shutdown timeout exceeded after ${String(timeoutMs)}ms; leaving process termination to the host.`,
      undefined,
      'FluoFactory',
    );
    process.exitCode = 1;
  }, timeoutMs);
  timer.unref?.();
  try {
    await app.close(signal);
    clearTimeout(timer);
    if (!timedOut) process.exitCode = 0;
  } catch (error) {
    clearTimeout(timer);
    logger.error('Failed to shut down the application cleanly.', error, 'FluoFactory');
    process.exitCode = 1;
  }
}
