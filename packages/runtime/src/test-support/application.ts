// Private test setup: exercise Factory and concrete Node adapter APIs, never ship old helpers.
import {
  createNodeShutdownSignalRegistration,
  NodeHttpApplicationAdapter,
  type NodeHttpAdapterOptions,
} from '@fluojs/platform-nodejs';

import { FluoFactory } from '../bootstrap.js';
import type { CreateApplicationOptions, HttpAdapterShutdownRegistration, ModuleType } from '../types.js';

export type RuntimeNodeTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions & {
  shutdownSignals?: false | readonly ('SIGINT' | 'SIGTERM')[];
};

export function createNodeTestApplication(
  rootModule: ModuleType,
  options: RuntimeNodeTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: NodeHttpApplicationAdapter.create(options),
  });
}

export async function startNodeTestApplication(
  rootModule: ModuleType,
  options: RuntimeNodeTestApplicationOptions = {},
) {
  const app = await createNodeTestApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createNodeShutdownSignalRegistration(options.shutdownSignals) as unknown as HttpAdapterShutdownRegistration,
  });
  await app.listen();
  return app;
}
