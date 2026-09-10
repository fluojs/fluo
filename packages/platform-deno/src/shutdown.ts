import type { Application, ApplicationLogger, HttpAdapterShutdownRegistration } from '@fluojs/runtime';

/** Signals accepted by the Deno host shutdown registration. */
export type DenoShutdownSignal = 'SIGINT' | 'SIGTERM';

type SignalHost = {
  addSignalListener(signal: DenoShutdownSignal, handler: () => void): void;
  removeSignalListener(signal: DenoShutdownSignal, handler: () => void): void;
};

/**
 * Creates Deno-owned signal registration for `FluoFactory.create(...)`.
 *
 * @param signals Signals to register, or false to leave shutdown to the caller.
 * @returns A registration callback that deduplicates signals and owns rollback and removal.
 */
export function createDenoShutdownSignalRegistration(
  signals: false | readonly DenoShutdownSignal[] = ['SIGINT', 'SIGTERM'],
): HttpAdapterShutdownRegistration {
  return (app, logger) => {
    if (signals === false) return () => {};
    const host = resolveSignalHost();
    if (!host) return () => {};
    const bindings: Array<{ signal: DenoShutdownSignal; handler: () => void }> = [];
    const seen = new Set<DenoShutdownSignal>();
    try {
      for (const signal of signals) {
        if (seen.has(signal)) continue;
        seen.add(signal);
        const handler = () => { void closeFromSignal(app, logger, signal); };
        host.addSignalListener(signal, handler);
        bindings.push({ signal, handler });
      }
    } catch (error) {
      try {
        removeBindings(host, bindings);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Failed to register Deno shutdown signals and roll back registered listeners.');
      }
      throw error;
    }
    return () => removeBindings(host, bindings);
  };
}

function removeBindings(
  host: SignalHost,
  bindings: readonly { signal: DenoShutdownSignal; handler: () => void }[],
): void {
  const errors: unknown[] = [];
  for (const { signal, handler } of bindings) {
    try {
      host.removeSignalListener(signal, handler);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Failed to remove Deno shutdown signal listeners.');
}

function resolveSignalHost(): SignalHost | undefined {
  const host: unknown = Reflect.get(globalThis, 'Deno');
  if (typeof host !== 'object' || host === null) return undefined;
  const add = Reflect.get(host, 'addSignalListener');
  const remove = Reflect.get(host, 'removeSignalListener');
  if (typeof add !== 'function' || typeof remove !== 'function') return undefined;
  return {
    addSignalListener(signal, handler) { Reflect.apply(add, host, [signal, handler]); },
    removeSignalListener(signal, handler) { Reflect.apply(remove, host, [signal, handler]); },
  };
}

async function closeFromSignal(
  app: Application,
  logger: ApplicationLogger,
  signal: DenoShutdownSignal,
): Promise<void> {
  if (app.state === 'closed') return;
  try {
    await app.close(signal);
    logger.log(`Application closed after receiving ${signal}.`, 'FluoFactory');
  } catch (error) {
    logger.error('Failed to shut down the application cleanly.', error, 'FluoFactory');
  }
}
