// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { DenoHttpApplicationAdapter, type DenoAdapterOptions } from '../adapter.js';
import { createDenoShutdownSignalRegistration, type DenoShutdownSignal } from '../shutdown.js';

/** Application and transport options used only by package-local tests. */
export type DenoTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & DenoAdapterOptions & {
  shutdownSignals?: false | readonly DenoShutdownSignal[];
};

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
export function createDenoTestApplication(
  rootModule: ModuleType,
  options: DenoTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: DenoHttpApplicationAdapter.create(options),
  });
}

/**
 * Starts a test application with explicitly selected host shutdown registration.
 * @param rootModule Root module for the test application.
 * @param options Application, transport, and host signal configuration.
 * @returns The application after listening and host registration complete.
 */
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
