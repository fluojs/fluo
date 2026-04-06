import type { Application, ApplicationLogger } from './types.js';
import type { HttpAdapterShutdownRegistration } from './http-adapter-shared.js';

type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 30_000;

export function defaultNodeShutdownSignals(): readonly NodeShutdownSignal[] {
  return ['SIGINT', 'SIGTERM'];
}

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

  for (const signal of signals) {
    const handler = () => {
      void closeFromSignal(app, logger, signal, forceExitTimeoutMs);
    };

    bindings.push({ signal, handler });
    process.once(signal, handler);
  }

  return () => {
    for (const binding of bindings) {
      process.off(binding.signal, binding.handler);
    }
  };
}

async function closeFromSignal(app: Application, logger: ApplicationLogger, signal: NodeShutdownSignal, forceExitTimeoutMs: number): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }

  const forceExitTimer = setTimeout(() => {
    logger.error(`Forced exit after ${String(forceExitTimeoutMs)}ms shutdown timeout.`, undefined, 'KonektiFactory');
    process.exit(1);
  }, forceExitTimeoutMs);

  if (forceExitTimer.unref) {
    forceExitTimer.unref();
  }

  try {
    await app.close(signal);
    clearTimeout(forceExitTimer);
    process.exitCode = 0;
  } catch (error: unknown) {
    clearTimeout(forceExitTimer);
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exitCode = 1;
  }
}
