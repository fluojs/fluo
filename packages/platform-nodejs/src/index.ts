import type { HttpApplicationAdapter } from '@fluojs/http';
import { createNodeHttpAdapter, type NodeHttpAdapterOptions } from '@fluojs/runtime/node';

export {
  bootstrapNodeApplication as bootstrapNodejsApplication,
  runNodeApplication as runNodejsApplication,
} from '@fluojs/runtime/node';

export type {
  BootstrapNodeApplicationOptions as BootstrapNodejsApplicationOptions,
  NodeApplicationSignal as NodejsApplicationSignal,
  NodeHttpAdapterOptions as NodejsAdapterOptions,
  RunNodeApplicationOptions as RunNodejsApplicationOptions,
} from '@fluojs/runtime/node';

/**
 * Type-only alias for the adapter instances returned by `createNodejsAdapter(...)`.
 */
export interface NodejsHttpApplicationAdapter extends HttpApplicationAdapter {
  getListenTarget(): { bindTarget: string; url: string };
  getRealtimeCapability(): { kind: 'server-backed'; server: unknown };
  getServer(): unknown;
}

/**
 * Create the raw Node.js HTTP adapter exposed by `@fluojs/platform-nodejs`.
 *
 * @param options Transport-level Node.js settings such as port, retries, multipart, and HTTPS options.
 * @returns The Node.js HTTP adapter instance used by the Fluo runtime.
 */
export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodejsHttpApplicationAdapter {
  const adapter = createNodeHttpAdapter(options);

  if (!isNodejsHttpApplicationAdapter(adapter)) {
    throw new TypeError('Expected createNodeHttpAdapter() to return a Node.js-compatible HTTP adapter.');
  }

  return adapter;
}

function isNodejsHttpApplicationAdapter(
  adapter: ReturnType<typeof createNodeHttpAdapter>,
): adapter is NodejsHttpApplicationAdapter {
  return typeof (adapter as { getListenTarget?: unknown }).getListenTarget === 'function'
    && typeof (adapter as { getRealtimeCapability?: unknown }).getRealtimeCapability === 'function'
    && typeof (adapter as { getServer?: unknown }).getServer === 'function';
}
