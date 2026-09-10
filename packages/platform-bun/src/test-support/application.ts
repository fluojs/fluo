// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { BunHttpApplicationAdapter, type BunAdapterOptions } from '../adapter.js';
import { createBunShutdownSignalRegistration, type BunShutdownSignal } from '../shutdown.js';

export type BunTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & BunAdapterOptions & {
  shutdownSignals?: false | readonly BunShutdownSignal[];
};

export function createBunTestApplication(
  rootModule: ModuleType,
  options: BunTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: BunHttpApplicationAdapter.create(options),
  });
}

export async function startBunTestApplication(
  rootModule: ModuleType,
  options: BunTestApplicationOptions = {},
) {
  const app = await createBunTestApplication(rootModule, {
    ...options,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? options.forceExitTimeoutMs ?? 30_000,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createBunShutdownSignalRegistration(options.shutdownSignals),
  });
  await app.listen();
  return app;
}
