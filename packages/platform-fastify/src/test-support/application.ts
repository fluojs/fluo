// Private test setup: exercise Factory and static adapter APIs, never ship old helpers.
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';
import { FastifyHttpApplicationAdapter, type FastifyAdapterOptions } from '../adapter.js';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';

type NodeShutdownSignal = 'SIGINT' | 'SIGTERM';

/** Application and transport options used only by package-local tests. */
export type FastifyTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & FastifyAdapterOptions & {
  shutdownSignals?: false | readonly NodeShutdownSignal[];
};

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
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

/**
 * Starts a test application with explicitly selected host shutdown registration.
 * @param rootModule Root module for the test application.
 * @param options Application, transport, and host signal configuration.
 * @returns The application after listening and host registration complete.
 */
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
