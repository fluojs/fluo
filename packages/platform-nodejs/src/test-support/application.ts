// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '../index.js';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration, type NodeShutdownSignal } from '../index.js';

/** Application and transport options used only by package-local tests. */
export type NodeTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions & {
  shutdownSignals?: false | readonly NodeShutdownSignal[];
};

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
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

/**
 * Starts a test application with explicitly selected host shutdown registration.
 * @param rootModule Root module for the test application.
 * @param options Application, transport, and host signal configuration.
 * @returns The application after listening and host registration complete.
 */
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
