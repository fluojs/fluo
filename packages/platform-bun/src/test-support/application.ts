// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { BunHttpApplicationAdapter, type BunAdapterOptions } from '../adapter.js';
import { createBunShutdownSignalRegistration, type BunShutdownSignal } from '../shutdown.js';

/** Application and transport options used only by package-local tests. */
export type BunTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & BunAdapterOptions & {
  shutdownSignals?: false | readonly BunShutdownSignal[];
};

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
export function createBunTestApplication(
  rootModule: ModuleType,
  options: BunTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: BunHttpApplicationAdapter.create(options),
  });
}

/**
 * Starts a test application with explicitly selected host shutdown registration.
 * @param rootModule Root module for the test application.
 * @param options Application, transport, and host signal configuration.
 * @returns The application after listening and host registration complete.
 */
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
