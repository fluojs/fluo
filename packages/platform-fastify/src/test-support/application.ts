// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { FastifyHttpApplicationAdapter, type FastifyAdapterOptions } from '../adapter.js';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';

type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

export type FastifyTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & FastifyAdapterOptions & {
  shutdownSignals?: false | readonly NodeShutdownSignal[];
};

export function createFastifyTestApplication(
  rootModule: ModuleType,
  options: FastifyTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: FastifyHttpApplicationAdapter.create(options),
    logger: options.logger ?? createConsoleApplicationLogger(),
  });
}

export async function startFastifyTestApplication(
  rootModule: ModuleType,
  options: FastifyTestApplicationOptions = {},
) {
  const app = await createFastifyTestApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createNodeShutdownSignalRegistration(options.shutdownSignals),
  });
  await app.listen();
  return app;
}
