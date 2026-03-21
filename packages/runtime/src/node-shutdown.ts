import type { Application, ApplicationLogger } from './types.js';

type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

export function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly NodeShutdownSignal[],
): void {
  if (signals === false) {
    return;
  }

  for (const signal of signals) {
    process.once(signal, () => {
      void closeFromSignal(app, logger, signal);
    });
  }
}

async function closeFromSignal(app: Application, logger: ApplicationLogger, signal: NodeShutdownSignal): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }

  try {
    await app.close(signal);
    process.exitCode = 0;
  } catch (error: unknown) {
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exitCode = 1;
  }
}
