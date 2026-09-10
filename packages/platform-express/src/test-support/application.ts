// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { ExpressHttpApplicationAdapter, type ExpressAdapterOptions } from '../adapter.js';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';

type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

export type ExpressTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & ExpressAdapterOptions & {
  shutdownSignals?: false | readonly NodeShutdownSignal[];
};

export function createExpressTestApplication(
  rootModule: ModuleType,
  options: ExpressTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: ExpressHttpApplicationAdapter.create(options),
    logger: options.logger ?? createConsoleApplicationLogger(),
  });
}

export async function startExpressTestApplication(
  rootModule: ModuleType,
  options: ExpressTestApplicationOptions = {},
) {
  const app = await createExpressTestApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createNodeShutdownSignalRegistration(options.shutdownSignals),
  });
  await app.listen();
  return app;
}
