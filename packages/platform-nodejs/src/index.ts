import type { NodeHttpAdapterOptions, NodeHttpApplicationAdapter } from '@konekti/runtime/node';
import { createNodeHttpAdapter } from '@konekti/runtime/node';

export {
  bootstrapNodeApplication as bootstrapNodejsApplication,
  runNodeApplication as runNodejsApplication,
} from '@konekti/runtime/node';

export type {
  BootstrapNodeApplicationOptions as BootstrapNodejsApplicationOptions,
  NodeApplicationSignal as NodejsApplicationSignal,
  NodeHttpAdapterOptions as NodejsAdapterOptions,
  NodeHttpApplicationAdapter as NodejsHttpApplicationAdapter,
  RunNodeApplicationOptions as RunNodejsApplicationOptions,
} from '@konekti/runtime/node';

export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodeHttpApplicationAdapter {
  return createNodeHttpAdapter(options) as NodeHttpApplicationAdapter;
}
