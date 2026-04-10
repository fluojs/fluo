import type { NodeHttpAdapterOptions, NodeHttpApplicationAdapter } from '@fluojs/runtime/internal-node';
import { createNodeHttpAdapter } from '@fluojs/runtime/internal-node';

export {
  bootstrapNodeApplication as bootstrapNodejsApplication,
  runNodeApplication as runNodejsApplication,
} from '@fluojs/runtime/internal-node';

export type {
  BootstrapNodeApplicationOptions as BootstrapNodejsApplicationOptions,
  NodeApplicationSignal as NodejsApplicationSignal,
  NodeHttpAdapterOptions as NodejsAdapterOptions,
  NodeHttpApplicationAdapter as NodejsHttpApplicationAdapter,
  RunNodeApplicationOptions as RunNodejsApplicationOptions,
} from '@fluojs/runtime/internal-node';

export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodeHttpApplicationAdapter {
  return createNodeHttpAdapter(options) as NodeHttpApplicationAdapter;
}
