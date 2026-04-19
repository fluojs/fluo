import type { NodeHttpAdapterOptions } from '@fluojs/runtime/node';
import { createNodeHttpAdapter, NodeHttpApplicationAdapter } from '@fluojs/runtime/node';

export {
  bootstrapNodeApplication as bootstrapNodejsApplication,
  runNodeApplication as runNodejsApplication,
} from '@fluojs/runtime/node';

export type {
  BootstrapNodeApplicationOptions as BootstrapNodejsApplicationOptions,
  NodeApplicationSignal as NodejsApplicationSignal,
  NodeHttpAdapterOptions as NodejsAdapterOptions,
  NodeHttpApplicationAdapter as NodejsHttpApplicationAdapter,
  RunNodeApplicationOptions as RunNodejsApplicationOptions,
} from '@fluojs/runtime/node';

/**
 * Create the stable raw Node.js adapter without exposing runtime-internal imports.
 *
 * @param options Transport-level Node.js adapter settings such as host, port, and body limits.
 * @returns The public Node.js HTTP adapter contract exposed by `@fluojs/platform-nodejs`.
 */
export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodeHttpApplicationAdapter {
  const adapter = createNodeHttpAdapter(options);

  if (!(adapter instanceof NodeHttpApplicationAdapter)) {
    throw new TypeError('Expected createNodeHttpAdapter() to return the stable Node.js adapter contract.');
  }

  return adapter;
}
