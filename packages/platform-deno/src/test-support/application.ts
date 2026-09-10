// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { DenoHttpApplicationAdapter, type DenoAdapterOptions } from '../adapter.js';
import { createDenoShutdownSignalRegistration, type DenoShutdownSignal } from '../shutdown.js';

export type DenoTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & DenoAdapterOptions & {
  shutdownSignals?: false | readonly DenoShutdownSignal[];
};

export function createDenoTestApplication(
  rootModule: ModuleType,
  options: DenoTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: DenoHttpApplicationAdapter.create(options),
  });
}

export async function startDenoTestApplication(
  rootModule: ModuleType,
  options: DenoTestApplicationOptions = {},
) {
  const app = await createDenoTestApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createDenoShutdownSignalRegistration(options.shutdownSignals),
  });
  await app.listen();
  return app;
}
