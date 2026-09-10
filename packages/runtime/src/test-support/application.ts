// Private test setup: exercise Factory and concrete Node adapter APIs, never ship old helpers.
import {
  createNodeShutdownSignalRegistration,
  NodeHttpApplicationAdapter,
  type NodeHttpAdapterOptions,
} from '@fluojs/platform-nodejs';

import { FluoFactory } from '../bootstrap.js';
import type { CreateApplicationOptions, ModuleType } from '../types.js';

/** Application and transport options used only by package-local tests. */
export type RuntimeNodeTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions & {
  shutdownSignals?: false | readonly ('SIGINT' | 'SIGTERM')[];
};

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
export function createNodeTestApplication(
  rootModule: ModuleType,
  options: RuntimeNodeTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: NodeHttpApplicationAdapter.create(options),
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
  options: RuntimeNodeTestApplicationOptions = {},
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
