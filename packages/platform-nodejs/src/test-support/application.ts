// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '../index.js';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration, type NodeShutdownSignal } from '../index.js';

export type NodeTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions & {
  shutdownSignals?: false | readonly NodeShutdownSignal[];
};

export function createNodeTestApplication(
  rootModule: ModuleType,
  options: NodeTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: NodeHttpApplicationAdapter.create(options),
    logger: options.logger ?? createConsoleApplicationLogger(),
  });
}

export async function startNodeTestApplication(
  rootModule: ModuleType,
  options: NodeTestApplicationOptions = {},
) {
  const app = await createNodeTestApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createNodeShutdownSignalRegistration(options.shutdownSignals),
  });
  await app.listen();
  return app;
}
