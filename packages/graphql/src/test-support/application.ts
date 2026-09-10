// Private test setup: exercise Factory and concrete Node adapter APIs, never ship old helpers.
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '@fluojs/platform-nodejs';
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';

/** Application and transport options used only by package-local tests. */
export type GraphqlTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions;

/**
 * Creates a test application through the canonical Factory and concrete adapter.
 * @param rootModule Root module for the test application.
 * @param options Application and transport configuration.
 * @returns The initialized application without implicit listening.
 */
export function createNodeTestApplication(
  rootModule: ModuleType,
  options: GraphqlTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: NodeHttpApplicationAdapter.create(options),
  });
}
