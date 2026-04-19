import {
  createNodeHttpAdapter,
  type NodeHttpAdapterOptions,
  type NodeHttpApplicationAdapter,
} from '@fluojs/runtime/node';

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
 * Create the raw Node.js HTTP adapter exposed by `@fluojs/platform-nodejs`.
 *
 * @param options Transport-level Node.js settings such as port, retries, multipart, and HTTPS options.
 * @returns The Node.js HTTP adapter instance used by the Fluo runtime.
 */
export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodeHttpApplicationAdapter {
  return createNodeHttpAdapter(options) as NodeHttpApplicationAdapter;
}
