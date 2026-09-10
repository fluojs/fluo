// Private test setup: exercise Factory and concrete Node adapter APIs, never ship old helpers.
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '@fluojs/platform-nodejs';
import { FluoFactory, type CreateApplicationOptions, type ModuleType } from '@fluojs/runtime';

export type GraphqlTestApplicationOptions = Omit<CreateApplicationOptions, 'adapter'> & NodeHttpAdapterOptions;

export function createNodeTestApplication(
  rootModule: ModuleType,
  options: GraphqlTestApplicationOptions = {},
) {
  return FluoFactory.create(rootModule, {
    ...options,
    adapter: NodeHttpApplicationAdapter.create(options),
  });
}
